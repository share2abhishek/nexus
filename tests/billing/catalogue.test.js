// B0: seeder, plan designer rules, price book, tax, coupons, import, and the staff routes (role matrix, switch, edition).
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { makeTestKnex } = require('../helpers/db');

const mockKnex = makeTestKnex();
jest.mock('../../services/knex', () => mockKnex);

const host = require('../../services/billingHost');
const { init } = require('../../modules/billing');

let b;
let ids;
const day = 86400;
const at = (date) => Date.parse(`${date}T12:00:00+05:30`) / 1000;

beforeAll(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await mockKnex.migrate.latest();
  const one = async (q) => { const [r] = await q.returning('id'); return r?.id ?? r; };
  const staff = await one(mockKnex('users').insert({ email: 'staff@radixile.test', password_hash: 'h', role: 'superadmin', email_verified_at: 1 }));
  const owner = await one(mockKnex('users').insert({ email: 'owner@a.test', password_hash: 'h', role: 'user', email_verified_at: 1 }));
  const orgTrial = await one(mockKnex('organizations').insert({ name: 'Avinash-like', owner_user_id: owner, plan: 'trial', trial_ends_at: at('2027-01-01') }));
  const orgPaid = await one(mockKnex('organizations').insert({ name: 'Paying', owner_user_id: owner, plan: 'agency', plan_status: 'active', paid_until: at('2026-12-31') }));
  const orgOdd = await one(mockKnex('organizations').insert({ name: 'Odd plan', owner_user_id: owner, plan: 'legacy_gold' }));
  const ws = await one(mockKnex('workspaces').insert({ org_id: orgTrial, name: 'A', slug: 'a' }));
  await mockKnex('memberships').insert([{ user_id: staff, workspace_id: ws, role: 'manager' }, { user_id: owner, workspace_id: ws, role: 'manager' }]);
  ids = { staff, owner, orgTrial, orgPaid, orgOdd, ws };
  process.env.BILLING_TODAY = '2026-11-21';
  b = init({ knex: mockKnex, ports: host.ports });
  await b.seed();
});
afterAll(async () => { console.error.mockRestore(); delete process.env.BILLING_TODAY; await mockKnex.destroy(); });

describe('seed', () => {
  test('today\'s plans with every feature on, today\'s limits, new limits unlimited, today\'s prices, GST 0%', async () => {
    const plans = await b.catalogue.listPlans();
    expect(plans.map((p) => p.code)).toEqual(['free', 'trial', 'individual', 'agency', 'full']);
    const agency = plans.find((p) => p.code === 'agency');
    expect(Object.values(agency.features).every(Boolean)).toBe(true);
    expect(agency.limits).toMatchObject({ workspaces: 25, users: 10, seo_sites: 10, storage: -1, ai_credits: -1 });
    expect(agency.prices).toEqual([expect.objectContaining({ pricing_model: 'PER_ACCOUNT', unit_price_minor: 1020000 })]);
    expect(plans.find((p) => p.code === 'full').prices).toEqual([]); // by quote
    expect([agency.public, plans.find((p) => p.code === 'trial').public]).toEqual([true, false]);
    expect(agency.revision).toBe(1);
    expect(await b.catalogue.listTaxRates()).toEqual([expect.objectContaining({ tax_name: 'GST', rate_hundredths: 0 })]);
    expect(Number((await mockKnex('bill_subscription').count('* as c').first()).c)).toBe(0); // never creates subscriptions
  });

  test('running it again changes nothing, and staff edits survive', async () => {
    await b.catalogue.updatePlan('staff', 'individual', { name: 'Solo', limits: { users: 3 }, features: { ai_video: false } }, 'rename');
    const again = await b.seed();
    expect(again).toEqual({ plans: 0, features: 0, limits: 0, prices: 0 });
    const p = await b.catalogue.getPlan('individual');
    expect([p.name, p.limits.users, p.features.ai_video]).toEqual(['Solo', 3, false]);
  });
});

describe('plan designer rules', () => {
  test('"Ads only": a new plan starts off the price list, with only the ticked features', async () => {
    const p = await b.catalogue.createPlan('staff', { code: 'ads_only', name: 'Ads only', rank: 25, features: { ad_copy: true, meta_lead_ads: true, meta_reports: true }, limits: { workspaces: 1, users: 2 } });
    expect(p.public).toBe(false);
    expect(Object.entries(p.features).filter(([, on]) => on).map(([k]) => k).sort()).toEqual(['ad_copy', 'meta_lead_ads', 'meta_reports']);
    expect(p.limits.workspaces).toBe(1);
    expect(p.limits.storage).toBe(-1);
    expect((await b.catalogue.revisions('ads_only'))[0]).toMatchObject({ revision: 1, reason: 'created' });
  });

  test('a plan can never be saved in an impossible state (dependencies)', async () => {
    await expect(b.catalogue.createPlan('staff', { code: 'bad_ai', name: 'x', features: { web_chat_ai: true } }))
      .rejects.toMatchObject({ status: 400, code: 'featuredependency' });
    await expect(b.catalogue.updatePlan('staff', 'ads_only', { features: { whatsapp_bot: true } }))
      .rejects.toMatchObject({ code: 'featuredependency' });
    const ok = await b.catalogue.createPlan('staff', { code: 'web_ai', name: 'Website AI chat', features: { web_chat: true, web_chat_ai: true, ai_knowledge_base: true } });
    expect(ok.features.whatsapp_bot).toBe(false);
  });

  test('unknown features and limits, bad codes and bad numbers are refused', async () => {
    await expect(b.catalogue.createPlan('staff', { code: 'x1', name: 'x', features: { teleport: true } })).rejects.toMatchObject({ code: 'unknownfeature' });
    await expect(b.catalogue.createPlan('staff', { code: 'x2', name: 'x', limits: { users: 1.5 } })).rejects.toMatchObject({ code: 'invalidlimit' });
    await expect(b.catalogue.createPlan('staff', { code: 'x3', name: 'x', limits: { users: -2 } })).rejects.toMatchObject({ code: 'invalidlimit' });
    await expect(b.catalogue.createPlan('staff', { code: 'Bad Code', name: 'x' })).rejects.toMatchObject({ code: 'invalidcode' });
    await expect(b.catalogue.createPlan('staff', { code: 'ads_only', name: 'x' })).rejects.toMatchObject({ status: 409, code: 'planexists' });
    await expect(b.catalogue.updatePlan('staff', 'ads_only', { code: 'other' })).rejects.toMatchObject({ code: 'codeimmutable' });
  });

  test('changing a plan organisations are on needs a reason; every save writes a revision and an audit row', async () => {
    await expect(b.catalogue.updatePlan('staff', 'agency', { limits: { users: 12 } })).rejects.toMatchObject({ code: 'reasonrequired' });
    await b.catalogue.updatePlan('staff', 'agency', { limits: { users: 12 } }, 'more seats for agencies');
    const revs = await b.catalogue.revisions('agency');
    expect(revs[0]).toMatchObject({ revision: 2, reason: 'more seats for agencies' });
    expect(revs[0].snapshot.limits.users).toBe(12);
    expect(revs[1].snapshot.limits.users).toBe(10);
    const audit = await mockKnex('bill_audit').where({ entity: 'plan', entity_id: 'agency', action: 'plan.update' }).first();
    expect(JSON.parse(audit.old_value).limits.users).toBe(10);
    expect(audit.reason).toBe('more seats for agencies');
  });

  test('clone keeps features, limits and today\'s price; deactivate instead of delete', async () => {
    const c = await b.catalogue.clonePlan('staff', 'agency', { code: 'agency_plus', name: 'Agency Plus' });
    expect([c.public, c.limits.users, c.features.ai_video]).toEqual([false, 12, true]);
    expect(c.prices[0]).toMatchObject({ unit_price_minor: 1020000, effective_from: '2026-11-21' });
    const off = await b.catalogue.updatePlan('staff', 'agency_plus', { active: false });
    expect(off.active).toBe(false);
  });

  test('a private plan for one organisation can never go on the price list', async () => {
    const p = await b.catalogue.createPlan('staff', { code: 'avinash_custom', name: 'Avinash custom', owner_org_id: ids.orgTrial, public: true });
    expect([p.public, p.owner_org_id]).toEqual([false, ids.orgTrial]);
    await expect(b.catalogue.updatePlan('staff', 'avinash_custom', { public: true })).rejects.toMatchObject({ code: 'privateplan' });
    await expect(b.catalogue.createPlan('staff', { code: 'ghost_custom', name: 'x', owner_org_id: 999999 })).rejects.toMatchObject({ code: 'invalidaccount' });
  });
});

describe('prices, tax, cycle discounts, coupons, quote', () => {
  test('a new price starts today or later; the price for a period is read at its start', async () => {
    await expect(b.catalogue.addPrice('staff', { plan_code: 'individual', pricing_model: 'PER_ACCOUNT', unit_price_minor: 149900, effective_from: '2026-11-01' })).rejects.toMatchObject({ code: 'pastdate' });
    await b.catalogue.addPrice('staff', { plan_code: 'individual', pricing_model: 'PER_ACCOUNT', unit_price_minor: 149900, effective_from: '2026-12-01' });
    expect(Number((await b.catalogue.priceOn('individual', 'PER_ACCOUNT', '2026-11-30')).unit_price_minor)).toBe(127500);
    expect(Number((await b.catalogue.priceOn('individual', 'PER_ACCOUNT', '2026-12-01')).unit_price_minor)).toBe(149900);
    await expect(b.catalogue.addPrice('staff', { plan_code: 'individual', pricing_model: 'PER_ACCOUNT', unit_price_minor: 1.5 })).rejects.toMatchObject({ code: 'invalidamount' });
    await expect(b.catalogue.addPrice('staff', { plan_code: 'individual', pricing_model: 'PER_ACCOUNT', unit_price_minor: -100 })).rejects.toMatchObject({ code: 'invalidamount' });
  });

  test('tax rates are append-only and dated; GST 18% from a future date leaves today at 0%', async () => {
    await expect(b.catalogue.addTaxRate('staff', { tax_name: 'GST', rate_hundredths: 1800, effective_from: '2026-01-01' })).rejects.toMatchObject({ code: 'pastdate' });
    await b.catalogue.addTaxRate('staff', { tax_name: 'GST', rate_hundredths: 1800, effective_from: '2027-04-01' });
    expect(Number((await b.catalogue.taxOn('2026-11-21')).rate_hundredths)).toBe(0);
    expect(Number((await b.catalogue.taxOn('2027-04-01')).rate_hundredths)).toBe(1800);
  });

  test('quote preview with an annual discount and a coupon', async () => {
    await b.catalogue.setCycleDiscount('staff', 'ANNUAL', 1500, 'two months free, roughly');
    await b.catalogue.createCoupon('staff', { code: 'DIWALI10', discount_type: 'PERCENT', discount_value: 1000, valid_to: '2026-12-31' });
    const q = await b.catalogue.previewQuote({ plan_code: 'agency', billing_cycle: 'ANNUAL', coupon_code: 'diwali10' });
    expect(q.base).toBe(1020000 * 12);
    expect(q.discounts.map((d) => d.label)).toEqual(['Cycle discount', 'Coupon']);
    expect(q.total).toBe(q.taxable); // GST 0% today
    await expect(b.catalogue.previewQuote({ plan_code: 'agency', coupon_code: 'nope' })).rejects.toMatchObject({ code: 'invalidcoupon' });
    await expect(b.catalogue.previewQuote({ plan_code: 'full' })).rejects.toMatchObject({ code: 'noprice' });
  });

  test('coupons: unique case-insensitive code; the discount is fixed once used', async () => {
    await expect(b.catalogue.createCoupon('staff', { code: 'diwali10', discount_type: 'FIXED', discount_value: 100 })).rejects.toMatchObject({ code: 'couponexists' });
    await expect(b.catalogue.createCoupon('staff', { code: 'big', discount_type: 'PERCENT', discount_value: 10001 })).rejects.toMatchObject({ code: 'invalidpercent' });
    const c = (await b.catalogue.listCoupons()).find((x) => x.code === 'diwali10');
    await b.catalogue.updateCoupon('staff', c.id, { discount_value: 1200 });
    await mockKnex('bill_coupon').where({ id: c.id }).update({ redemptions: 1 });
    await expect(b.catalogue.updateCoupon('staff', c.id, { discount_value: 1500 })).rejects.toMatchObject({ code: 'couponused' });
    expect((await b.catalogue.updateCoupon('staff', c.id, { active: false })).active).toBe(false);
  });
});

describe('import of today\'s organisations', () => {
  test('the dry run writes nothing and explains every organisation', async () => {
    const p = await b.importer.preview();
    expect(p.counts).toEqual({ create: 2, exists: 0, skip: 1 });
    const trial = p.rows.find((r) => r.account_id === ids.orgTrial);
    expect(trial.proposed).toMatchObject({ plan_code: 'trial', status: 'TRIAL', trial_end_date: '2027-01-01' });
    expect(p.rows.find((r) => r.account_id === ids.orgPaid).proposed).toMatchObject({ status: 'ACTIVE', current_period_end: '2026-12-31' });
    expect(p.rows.find((r) => r.account_id === ids.orgOdd)).toMatchObject({ action: 'skip', reason: 'plan "legacy_gold" is not in the catalogue' });
    expect(Number((await mockKnex('bill_subscription').count('* as c').first()).c)).toBe(0);
  });

  test('apply creates each missing row once, with automatic invoicing off, and is audited', async () => {
    const first = await b.importer.apply('staff');
    expect(first.created).toBe(2);
    const again = await b.importer.apply('staff');
    expect(again.created).toBe(0);
    const rows = await mockKnex('bill_subscription');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.auto_invoice || r.auto_invoice === 0)).toBe(true);
    expect(Number((await mockKnex('bill_audit').where({ action: 'subscription.import' }).count('* as c').first()).c)).toBe(2);
    expect((await mockKnex('organizations').where({ id: ids.orgTrial }).first()).plan).toBe('trial'); // the mirror is not touched
  });
});

describe('staff routes', () => {
  function app(userId) {
    const a = express();
    a.use(session({ secret: 'test-secret-test-secret-test-secret', resave: false, saveUninitialized: true }));
    a.use((req, res, next) => { req.session.userId = userId; next(); });
    const { makeWithWorkspace } = require('../../middleware/tenancy');
    const platformAdmin = require('../../services/platformAdmin');
    const withWorkspace = makeWithWorkspace(require('../../repos/membershipsRepo')(mockKnex), { loadUser: platformAdmin.loadUser });
    a.use('/api/billing/admin', withWorkspace, require('../../modules/access').middleware('platform.billing.manage'), b.adminRouter());
    return a;
  }
  beforeEach(() => { process.env.NEXUS_MODE = 'server'; process.env.BILLING_ENABLED = 'true'; require('../../services/platformAdmin').forget(); });
  afterEach(() => { delete process.env.NEXUS_MODE; delete process.env.BILLING_ENABLED; });

  test('Radixile staff can use them; a customer owner cannot', async () => {
    const ok = await request(app(ids.staff)).get('/api/billing/admin/plans');
    expect(ok.status).toBe(200);
    expect(ok.body.length).toBeGreaterThan(4);
    const no = await request(app(ids.owner)).get('/api/billing/admin/plans');
    expect([no.status, no.body.code]).toEqual([403, 'forbidden']);
    const noWrite = await request(app(ids.owner)).post('/api/billing/admin/plans').send({ code: 'hack', name: 'x' });
    expect(noWrite.status).toBe(403);
    expect(await mockKnex('bill_plan').where({ code: 'hack' }).first()).toBeUndefined();
  });

  test('404 while billing is off, and on the desktop edition', async () => {
    delete process.env.BILLING_ENABLED;
    expect((await request(app(ids.staff)).get('/api/billing/admin/plans')).status).toBe(404);
    process.env.BILLING_ENABLED = 'true';
    delete process.env.NEXUS_MODE;
    expect((await request(app(ids.staff)).get('/api/billing/admin/plans')).status).toBe(404);
  });

  test('errors carry a stable code and field; the actor is recorded from the session', async () => {
    const res = await request(app(ids.staff)).put('/api/billing/admin/plans/agency').send({ limits: { users: 15 } });
    expect([res.status, res.body.code, res.body.field]).toEqual([400, 'reasonrequired', 'reason']);
    const ok = await request(app(ids.staff)).put('/api/billing/admin/plans/agency').send({ limits: { users: 15 }, reason: 'test' });
    expect(ok.body.limits.users).toBe(15);
    expect((await b.catalogue.revisions('agency'))[0].created_by).toBe(`staff@radixile.test (#${ids.staff})`);
    const bad = await request(app(ids.staff)).post('/api/billing/admin/plans').set('Content-Type', 'application/json').send('{oops');
    expect([bad.status, bad.body.code]).toEqual([400, 'invalidjson']);
  });

  test('the import preview is available; nothing in the routes applies it', async () => {
    const res = await request(app(ids.staff)).get('/api/billing/admin/import/preview');
    expect(res.status).toBe(200);
    expect(res.body.counts.exists).toBe(2);
    expect((await request(app(ids.staff)).post('/api/billing/admin/import/apply')).status).toBe(404);
  });
});
