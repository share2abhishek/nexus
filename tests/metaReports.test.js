// Meta Reports: errors, money and dates, and that each business only ever
// sees its own ad accounts and WhatsApp numbers.
const express = require('express');
const request = require('supertest');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const mr = require('../services/metaReports');

const metaErr = (code, message, sub) => ({ response: { data: { error: { code, message, error_subcode: sub } } } });

describe('metaReports (unit)', () => {
  test('Meta errors become actionable codes', () => {
    expect(mr.mapError(metaErr(190, 'Invalid OAuth access token.')).code).toBe('token_expired');
    expect(mr.mapError(metaErr(10, '(#10) Application does not have permission')).code).toBe('missing_permission');
    expect(mr.mapError(metaErr(200, 'Requires ads_read')).code).toBe('missing_permission');
    expect(mr.mapError(metaErr(17, 'User request limit reached')).code).toBe('rate_limited');
    expect(mr.mapError({ code: 'ECONNABORTED' }).code).toBe('timeout');
    expect(mr.mapError(new Error('boom')).message).toBe('boom');
  });

  test('money comes back in whole units, with zero-decimal currencies left alone', () => {
    expect(mr.fromMinor('123456', 'INR')).toBe(1234.56);
    expect(mr.fromMinor('5000', 'JPY')).toBe(5000);
    expect(mr.fromMinor(null, 'INR')).toBeNull();
    expect(mr.fromMinor('abc', 'INR')).toBeNull();
  });

  test('date ranges: presets, custom, and limits', () => {
    const now = new Date('2026-11-17T10:00:00Z');
    expect(mr.resolveRange({ range: '7d' }, now)).toEqual({ since: '2026-11-11', until: '2026-11-17', days: 7 });
    expect(mr.resolveRange({ range: 'month' }, now)).toEqual({ since: '2026-11-01', until: '2026-11-17', days: 17 });
    expect(mr.resolveRange({ since: '2026-11-01', until: '2026-11-05' }, now).days).toBe(5);
    expect(() => mr.resolveRange({ since: '2026-11-10', until: '2026-11-01' }, now)).toThrow(/after/);
    expect(() => mr.resolveRange({ since: '2026-01-01', until: '2026-11-01' }, now)).toThrow(/at most/);
  });

  test('cache is per business and clears per business', async () => {
    let n = 0;
    const load = () => Promise.resolve(++n);
    expect(await mr.cached(1, 'k', false, load)).toBe(1);
    expect(await mr.cached(1, 'k', false, load)).toBe(1);   // reused
    expect(await mr.cached('1', 'k', false, load)).toBe(1); // 1 and '1' are the same business
    expect(await mr.cached(2, 'k', false, load)).toBe(2);   // another business: its own entry
    mr.clearCache(1);
    expect(await mr.cached(1, 'k', false, load)).toBe(3);
    expect(await mr.cached(2, 'k', false, load)).toBe(2);   // business two untouched
  });
});

describe('metaReports routes (two businesses)', () => {
  let knex, app, ws1, ws2, getSpy;
  const allow = () => (req, res, next) => next();

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'T', owner_user_id: 1 }).returning('id');
    const orgId = org?.id ?? org;
    const mk = async (slug) => { const [w] = await knex('workspaces').insert({ org_id: orgId, name: slug, slug }).returning('id'); return w?.id ?? w; };
    ws1 = await mk('one'); ws2 = await mk('two');
    const now = Math.floor(Date.now() / 1000);
    const acct = (w, tok) => knex('social_accounts').insert({ workspace_id: w, platform: 'facebook', external_id: `e${w}`, account_label: 'p', access_token: tok, status: 'active', created_at: now });
    await acct(ws1, 'TOKEN_ONE'); await acct(ws2, 'TOKEN_TWO');
    const cfg = (w, extra) => knex('meta_lead_configs').insert({ workspace_id: w, verify_token: `v${w}`, created_at: now, updated_at: now, ...extra });
    await cfg(ws1, { whatsapp_access_token: 'WA_ONE', whatsapp_business_account_id: 'WABA_ONE', whatsapp_phone_number_id: 'PN_ONE', meta_ad_account_ids: JSON.stringify(['act_111']) });
    await cfg(ws2, { meta_ad_account_ids: null });

    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = Number(req.headers['x-ws']); req.session = { userId: 1 }; next(); });
    app.use('/api/meta-reports', require('../routes/metaReports')(knex, allow));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });
  beforeEach(() => {
    mr.clearCache(ws1); mr.clearCache(ws2);
    getSpy = jest.spyOn(axios, 'get').mockImplementation(async (url, opts) => {
      const t = opts.params.access_token;
      if (url.endsWith('/me/permissions')) return { data: { data: [{ permission: 'ads_read', status: t === 'TOKEN_ONE' ? 'granted' : 'declined' }] } };
      if (url.endsWith('/me/adaccounts')) return { data: { data: t === 'TOKEN_ONE' ? [{ account_id: '111', name: 'One Ads', currency: 'INR', account_status: 1 }] : [{ account_id: '222', name: 'Two Ads', currency: 'USD', account_status: 1 }] } };
      if (/\/act_111$/.test(url)) return { data: { name: 'One Ads', currency: 'INR', account_status: 1, balance: '250000', amount_spent: '1000000', spend_cap: '0', funding_source_details: { display_string: 'Visa *4242' } } };
      if (/\/act_111\/insights$/.test(url)) return { data: { data: [{ date_start: '2026-11-10', spend: '100.50', impressions: '1000', clicks: '40', actions: [{ action_type: 'lead', value: '5' }, { action_type: 'onsite_conversion.lead_grouped', value: '5' }] }] } };
      if (/\/WABA_ONE$/.test(url)) {
        if (opts.params.fields === 'id,name,currency') return { data: { id: 'WABA_ONE', name: 'Biz', currency: 'INR' } };
        if (opts.params.fields.startsWith('analytics')) return { data: { analytics: { data_points: [{ start: 1794000000, end: 1794086400, sent: 10, delivered: 8 }] } } };
        return { data: { currency: 'INR', pricing_analytics: { data: [{ data_points: [{ pricing_category: 'MARKETING', volume: 4, cost: 3.2 }, { pricing_category: 'UTILITY', volume: 2, cost: 0.5 }] }] } } };
      }
      if (/\/PN_ONE$/.test(url)) return { data: { display_phone_number: '+91 1', verified_name: 'Biz', quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K', status: 'CONNECTED' } };
      throw metaErr(100, 'unsupported get request');
    });
  });
  afterEach(() => getSpy.mockRestore());

  test('status shows each business its own permission state', async () => {
    const a = await request(app).get('/api/meta-reports/status').set('x-ws', String(ws1));
    const b = await request(app).get('/api/meta-reports/status').set('x-ws', String(ws2));
    expect(a.body.ads.granted).toBe(true);
    expect(a.body.whatsapp.granted).toBe(true);
    expect(b.body.ads.granted).toBe(false);          // business two has not granted ads_read
    expect(b.body.whatsapp.connected).toBe(false);   // and has no WhatsApp set up
    expect(a.body.guide.ads.steps.length).toBeGreaterThan(2);
  });

  test('ad report converts money and counts leads once', async () => {
    const r = await request(app).get('/api/meta-reports/ads?range=7d').set('x-ws', String(ws1));
    expect(r.status).toBe(200);
    const a = r.body.accounts[0];
    expect(a.amount_due).toBe(2500);
    expect(a.total_spent).toBe(10000);
    expect(a.spend_cap).toBeNull();
    expect(a.funding_source).toBe('Visa *4242');
    expect(a.totals).toMatchObject({ spend: 100.5, leads: 5, clicks: 40 });
    expect(a.totals.cost_per_lead).toBe(20.1);
  });

  test('each ad account links to its own Meta billing page; an overdue account is warned about', async () => {
    const ok = (await request(app).get('/api/meta-reports/ads?range=7d').set('x-ws', String(ws1))).body.accounts[0];
    expect(ok.billing_url).toBe('https://business.facebook.com/billing_hub/payment_activity?asset_id=111');
    expect(ok.warning).toBeNull(); // active account: no warning
    expect(mr.billingUrl('act_222; drop')).toBe('https://business.facebook.com/billing_hub/payment_activity?asset_id=222'); // digits only

    mr.clearCache(ws1);
    const orig = getSpy.getMockImplementation();
    getSpy.mockImplementation(async (url, opts) => (/\/act_111$/.test(url) ? { data: { name: 'One Ads', currency: 'INR', account_status: 3, balance: '100', amount_spent: '100', spend_cap: '0' } } : orig(url, opts)));
    const late = (await request(app).get('/api/meta-reports/ads?range=7d').set('x-ws', String(ws1))).body.accounts[0];
    expect(late.status).toBe('Payment overdue');
    expect(late.warning).toMatch(/overdue/i);
  });

  test('a business with no chosen ad account never reads anyone else’s', async () => {
    const r = await request(app).get('/api/meta-reports/ads?range=7d').set('x-ws', String(ws2));
    expect(r.body).toEqual({ accounts: [], needs_selection: true });
    // business one's token / account never went out for business two
    expect(getSpy.mock.calls.every(([, o]) => o.params.access_token !== 'TOKEN_ONE')).toBe(true);
  });

  test('saving ad accounts: only ones this connection can see, only for this business', async () => {
    const bad = await request(app).post('/api/meta-reports/ad-accounts').set('x-ws', String(ws2)).send({ ids: ['act_111'] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('not_visible');
    const ok = await request(app).post('/api/meta-reports/ad-accounts').set('x-ws', String(ws2)).send({ ids: ['act_222'] });
    expect(ok.body.selected).toEqual(['act_222']);
    const one = await knex('meta_lead_configs').where({ workspace_id: ws1 }).first();
    expect(JSON.parse(one.meta_ad_account_ids)).toEqual(['act_111']); // business one unchanged
  });

  test('whatsapp report: number health, messages and cost', async () => {
    const r = await request(app).get('/api/meta-reports/whatsapp?range=7d').set('x-ws', String(ws1));
    expect(r.status).toBe(200);
    expect(r.body.phone).toMatchObject({ quality: 'GREEN', daily_limit: 'TIER_1K' });
    expect(r.body.messages).toMatchObject({ sent: 10, delivered: 8 });
    expect(r.body.cost.total).toBe(3.7);
    expect(r.body.cost.currency).toBe('INR');
    expect(r.body.cost.by_category.marketing).toEqual({ cost: 3.2, volume: 4 });
  });

  test('whatsapp report needs the business’s own token; no platform fallback', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'PLATFORM_TOKEN';
    try {
      const r = await request(app).get('/api/meta-reports/whatsapp?range=7d').set('x-ws', String(ws2));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('not_connected');
      expect(getSpy.mock.calls.some(([, o]) => o.params.access_token === 'PLATFORM_TOKEN')).toBe(false);
    } finally { delete process.env.WHATSAPP_ACCESS_TOKEN; }
  });

  test('a Meta permission error is reported clearly, not as a crash', async () => {
    getSpy.mockImplementation(async () => { throw metaErr(200, '(#200) Requires whatsapp_business_management permission'); });
    const r = await request(app).get('/api/meta-reports/status').set('x-ws', String(ws1));
    expect(r.status).toBe(200);
    expect(r.body.whatsapp.granted).toBe(false);
    expect(r.body.whatsapp.error.code).toBe('missing_permission');
  });

  test('a bad date range is a 400', async () => {
    const r = await request(app).get('/api/meta-reports/whatsapp?since=2026-11-10&until=2026-11-01').set('x-ws', String(ws1));
    expect(r.status).toBe(400);
  });
});
