// Server edition: paying for a business's plan through Radixile's billing service.
// A stand-in billing service checks the app's signatures and answers like the
// real one (license-server/src/saas.js).
const http = require('http');
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { makeTestKnex } = require('./helpers/db');

const mockKnex = makeTestKnex();
const knex = mockKnex;
jest.mock('../services/knex', () => mockKnex);

const SECRET = 'billing-test-secret';
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const env = { ...process.env };
let stub, calls = [], subs = {};

const { sign } = require('../services/billing');

beforeAll(async () => {
  // Stand-in billing service
  const s = express();
  s.use(express.raw({ type: '*/*' }));
  s.use((req, res, next) => {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const ok = req.get('x-snx-signature') === sign(SECRET, req.get('x-snx-time'), req.method, req.originalUrl, body);
    calls.push({ method: req.method, url: req.originalUrl, body: body ? JSON.parse(body) : null, ok });
    if (!ok) return res.status(401).json({ ok: false, error: 'Bad signature.' });
    req.json = body ? JSON.parse(body) : {};
    next();
  });
  s.get('/v1/saas/plans', (req, res) => res.json({ ok: true, mode: 'mock', plans: [
    { code: 'saas_individual_monthly', plan_code: 'individual', plan_name: 'Individual', interval: 'monthly', base: 99900, gst: 17982, total: 117882, limits: { workspaces: 2, users: 3, seo_sites: 1, seats: 1 }, ready: true },
    { code: 'saas_agency_yearly', plan_code: 'agency', plan_name: 'Agency', interval: 'yearly', base: 2999900, gst: 539982, total: 3539882, limits: { workspaces: 30, users: 12, seo_sites: 10 }, ready: true },
  ] }));
  s.get('/v1/saas/status', (req, res) => res.json({ ok: true, ...(subs[req.query.org_ref] || { status: 'none' }) }));
  s.get('/v1/saas/invoices', (req, res) => res.json({ ok: true, invoices: [{ invoice_no: 'SNX/2026-27/00001', amount_paise: 117882, url: 'https://license.test/invoice/1?t=x' }] }));
  s.post('/v1/saas/checkout', (req, res) => {
    if (subs[req.json.org_ref]?.status === 'active') return res.status(409).json({ ok: false, code: 'ALREADY_SUBSCRIBED', error: 'This business already has an active plan.' });
    res.json({ ok: true, order_id: 7, pay_url: 'https://license.test/saas/pay/7?t=tok' });
  });
  s.post('/v1/saas/cancel', (req, res) => {
    const sub = subs[req.json.org_ref];
    sub.cancel_at_period_end = true;
    res.json({ ok: true, ...sub });
  });
  stub = s.listen(0);
  await new Promise((r) => stub.once('listening', r));

  process.env.NEXUS_MODE = 'server';
  process.env.BILLING_URL = `http://127.0.0.1:${stub.address().port}`;
  process.env.BILLING_SECRET = SECRET;
  process.env.APP_URL = 'https://app.example.test';
  await knex.migrate.latest();
});
afterAll(async () => { process.env = env; stub.close(); await knex.destroy(); });

async function user(email, role = 'user') {
  const [u] = await knex('users').insert({ email, password_hash: 'x', role, name: email.split('@')[0] }).returning('id');
  return u?.id ?? u;
}
async function business(name, ownerId, fields = {}) {
  const [o] = await knex('organizations').insert({ name, owner_user_id: ownerId, plan: 'trial', trial_ends_at: now() + 5 * DAY, ...fields }).returning('id');
  const orgId = o?.id ?? o;
  await knex('org_members').insert({ org_id: orgId, user_id: ownerId, role: 'owner' });
  const [w] = await knex('workspaces').insert({ org_id: orgId, name, slug: name.toLowerCase().replace(/\W+/g, '-') }).returning('id');
  const wsId = w?.id ?? w;
  await knex('memberships').insert({ user_id: ownerId, workspace_id: wsId, role: 'manager' });
  return { orgId, wsId };
}

function app() {
  const a = express();
  a.use(express.json({ verify: (req, res, buf) => { if (req.url.startsWith('/billing/webhook')) req.rawBody = buf; } }));
  a.use(session({ secret: 't', resave: false, saveUninitialized: false }));
  a.post('/as/:id', (req, res) => { req.session.userId = Number(req.params.id); res.json({}); });
  a.use((req, res, next) => { req.workspaceId = Number(req.get('x-ws')) || null; next(); });
  const routes = require('../routes/billing');
  a.use('/billing', routes.pub);
  a.use('/api/billing', (req, res, next) => (req.session.userId ? next() : res.status(401).end()), routes.api);
  return a;
}
async function as(userId) {
  const agent = request.agent(app());
  await agent.post(`/as/${userId}`);
  return agent;
}

const entitlements = () => require('../services/entitlements');
const orgRow = (id) => knex('organizations').where({ id }).first();

describe('plan rules after billing', () => {
  test('paid, payment failing (grace), cancelled until the paid end, then stopped; a paused business stays paused', async () => {
    const owner = await user('rules@biz.test');
    const { orgId } = await business('Rules Co', owner);
    const billing = require('../services/billing');
    const ent = entitlements();

    await billing.apply(orgId, { status: 'active', plan_code: 'individual', paid_until: now() + 20 * DAY });
    expect(await ent.forOrg(orgId)).toMatchObject({ can_publish: true, plan: 'individual', message: null });

    await billing.apply(orgId, { status: 'past_due', plan_code: 'individual', paid_until: now() - DAY });
    let s = await ent.forOrg(orgId);
    expect(s.can_publish).toBe(true);
    expect(s.message).toMatch(/didn’t go through.*within 2 days/);

    await billing.apply(orgId, { status: 'past_due', plan_code: 'individual', paid_until: now() - 4 * DAY });
    expect((await ent.forOrg(orgId)).can_publish).toBe(false);

    await billing.apply(orgId, { status: 'cancelled', plan_code: 'individual', paid_until: now() + 10 * DAY });
    s = await ent.forOrg(orgId);
    expect(s.can_publish).toBe(true);
    expect(s.message).toMatch(/is cancelled and ends on/);

    await billing.apply(orgId, { status: 'cancelled', plan_code: 'individual', paid_until: now() - 60 });
    s = await ent.forOrg(orgId);
    expect(s.can_publish).toBe(false);
    expect(s.message).toMatch(/was cancelled/);

    await knex('organizations').where({ id: orgId }).update({ plan_status: 'suspended' });
    expect(await billing.apply(orgId, { status: 'active', plan_code: 'agency', paid_until: now() + 30 * DAY })).toBe(false);
    expect((await orgRow(orgId)).plan_status).toBe('suspended');

    // Nothing paid yet: the trial stays
    const t = await business('Trial Co', owner);
    expect(await billing.apply(t.orgId, { status: 'pending' })).toBe(false);
    expect((await orgRow(t.orgId)).plan).toBe('trial');
  });
});

describe('Settings → Plan', () => {
  test('the owner sees plans, subscription and invoices; plan limits from billing become the app’s limits', async () => {
    const owner = await user('owner@shop.test');
    const { orgId, wsId } = await business('Shop Co', owner);
    const agent = await as(owner);
    const r = await agent.get('/api/billing').set('x-ws', String(wsId));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configured: true, can_manage: true, business: 'Shop Co', email: 'owner@shop.test' });
    expect(r.body.plans.map((p) => p.code)).toEqual(['saas_individual_monthly', 'saas_agency_yearly']);
    expect(r.body.subscription.status).toBe('none');
    expect(r.body.invoices).toHaveLength(1);
    expect(calls.every((c) => c.ok)).toBe(true);
    expect(calls.find((c) => c.url.startsWith('/v1/saas/status')).url).toBe(`/v1/saas/status?org_ref=nexus%3A${orgId}`);

    const saved = JSON.parse(await require('../repos/configRepo')(knex).get('saas_plans'));
    expect(saved.individual).toEqual({ name: 'Individual', limits: { workspaces: 2, users: 3, seo_sites: 1 } });
    expect(saved.agency.limits.workspaces).toBe(30);
  });

  test('the owner starts a checkout and is sent to the payment page; the way back is the app’s own address', async () => {
    const owner = await user('owner@pay.test');
    const { orgId, wsId } = await business('Pay Co', owner);
    const agent = await as(owner);
    calls = [];
    const r = await agent.post('/api/billing/checkout').set('x-ws', String(wsId)).send({ product_code: 'saas_individual_monthly', state_code: '27', gstin: '' });
    expect(r.status).toBe(200);
    expect(r.body.pay_url).toBe('https://license.test/saas/pay/7?t=tok');
    const sent = calls.find((c) => c.url === '/v1/saas/checkout').body;
    expect(sent).toMatchObject({ org_ref: `nexus:${orgId}`, product_code: 'saas_individual_monthly', email: 'owner@pay.test', company: 'Pay Co', state_code: '27', return_url: 'https://app.example.test/billing/return' });
  });

  test('team members can see the plan but not pay or cancel', async () => {
    const owner = await user('owner@team.test');
    const creator = await user('creator@team.test');
    const { wsId } = await business('Team Co', owner);
    await knex('memberships').insert({ user_id: creator, workspace_id: wsId, role: 'manager' });
    const agent = await as(creator);
    const r = await agent.get('/api/billing').set('x-ws', String(wsId));
    expect(r.body.can_manage).toBe(false);
    expect(r.body.invoices).toEqual([]);
    expect((await agent.post('/api/billing/checkout').set('x-ws', String(wsId)).send({ product_code: 'saas_individual_monthly' })).status).toBe(403);
    expect((await agent.post('/api/billing/cancel').set('x-ws', String(wsId))).status).toBe(403);
  });

  test('an active plan: the screen shows it, a second checkout is refused plainly, cancel keeps the plan to the end', async () => {
    const owner = await user('owner@active.test');
    const { orgId, wsId } = await business('Active Co', owner);
    subs[`nexus:${orgId}`] = { org_ref: `nexus:${orgId}`, status: 'active', plan_code: 'agency', product_name: 'Agency — yearly', interval: 'yearly', paid_until: now() + 300 * DAY, cancel_at_period_end: false };
    const agent = await as(owner);
    const r = await agent.get('/api/billing').set('x-ws', String(wsId));
    expect(r.body.subscription).toMatchObject({ status: 'active', plan_code: 'agency' });
    expect(await orgRow(orgId)).toMatchObject({ plan: 'agency', plan_status: 'active' });

    const again = await agent.post('/api/billing/checkout').set('x-ws', String(wsId)).send({ product_code: 'saas_individual_monthly', state_code: '27' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already has an active plan/);

    const c = await agent.post('/api/billing/cancel').set('x-ws', String(wsId));
    expect(c.body.subscription.cancel_at_period_end).toBe(true);
    expect((await entitlements().forOrg(orgId)).can_publish).toBe(true);
  });
});

describe('notices from the billing service', () => {
  const notice = (body, { secret = SECRET, time = now(), path = '/billing/webhook' } = {}) => {
    const raw = JSON.stringify(body);
    return request(app()).post(path).set('Content-Type', 'application/json')
      .set('X-SNX-Time', String(time)).set('X-SNX-Signature', sign(secret, time, 'POST', '/billing/webhook', raw)).send(raw);
  };

  test('a signed notice updates the business; wrong signature, old notice or another app’s business is ignored', async () => {
    const owner = await user('owner@notice.test');
    const { orgId } = await business('Notice Co', owner);
    const paidUntil = now() + 30 * DAY;

    const ok = await notice({ org_ref: `nexus:${orgId}`, status: 'active', plan_code: 'individual', paid_until: paidUntil });
    expect(ok.status).toBe(200);
    expect(await orgRow(orgId)).toMatchObject({ plan: 'individual', plan_status: 'active', paid_until: paidUntil });

    expect((await notice({ org_ref: `nexus:${orgId}`, status: 'cancelled' }, { secret: 'wrong' })).status).toBe(401);
    expect((await notice({ org_ref: `nexus:${orgId}`, status: 'cancelled' }, { time: now() - 900 })).status).toBe(401);
    const other = await notice({ org_ref: `otherapp:${orgId}`, status: 'cancelled', paid_until: 1 });
    expect(other.body.updated).toBe(false);
    expect((await orgRow(orgId)).plan_status).toBe('active');
  });

  test('after paying, the customer lands back in the app with the plan re-read', async () => {
    const owner = await user('owner@return.test');
    const { orgId } = await business('Return Co', owner);
    subs[`nexus:${orgId}`] = { org_ref: `nexus:${orgId}`, status: 'active', plan_code: 'individual', paid_until: now() + 30 * DAY };
    const agent = await as(owner);
    const r = await agent.get('/billing/return');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/?billing=done');
    expect((await orgRow(orgId)).plan).toBe('individual');
  });
});

test('without the billing service set up, the screen says so and nothing is called', async () => {
  const owner = await user('owner@noconf.test');
  const { wsId } = await business('NoConf Co', owner);
  const saved = process.env.BILLING_URL;
  delete process.env.BILLING_URL;
  try {
    const agent = await as(owner);
    const r = await agent.get('/api/billing').set('x-ws', String(wsId));
    expect(r.body).toMatchObject({ configured: false, can_manage: true });
    const c = await agent.post('/api/billing/checkout').set('x-ws', String(wsId)).send({ product_code: 'x' });
    expect(c.status).toBe(503);
    expect(c.body.error).toMatch(/isn’t set up yet/);
  } finally { process.env.BILLING_URL = saved; }
});

describe('review fixes', () => {
  test('a business that started paying is re-checked even if the "paid" notice never arrived', async () => {
    const owner = await user('owner@missed.test');
    const { orgId, wsId } = await business('Missed Co', owner);
    const agent = await as(owner);
    await agent.post('/api/billing/checkout').set('x-ws', String(wsId)).send({ product_code: 'saas_individual_monthly', state_code: '27' });
    expect((await orgRow(orgId)).billing_checkout_at).toBeGreaterThan(now() - 60);
    // Paid on the billing side, but the app was never told
    subs[`nexus:${orgId}`] = { org_ref: `nexus:${orgId}`, status: 'active', plan_code: 'individual', paid_until: now() + 30 * DAY };
    await require('../services/billing').syncAll();
    expect(await orgRow(orgId)).toMatchObject({ plan: 'individual', plan_status: 'active' });
  });

  test('without APP_URL no checkout starts (the way back is never taken from the request)', async () => {
    const owner = await user('owner@noapp.test');
    const { wsId } = await business('NoApp Co', owner);
    const saved = process.env.APP_URL;
    delete process.env.APP_URL;
    try {
      const agent = await as(owner);
      const r = await agent.post('/api/billing/checkout').set('x-ws', String(wsId)).set('Host', 'evil.example').send({ product_code: 'saas_individual_monthly', state_code: '27' });
      expect(r.status).toBe(503);
      expect(r.body.error).toMatch(/APP_URL/);
    } finally { process.env.APP_URL = saved; }
  });

  test('Radixile staff (by email) may manage billing; an old desktop "admin" role alone may not', async () => {
    const owner = await user('owner@staff.test');
    const { wsId } = await business('Staff Co', owner);
    const staff = await user('ops@radixile.test', 'admin');
    const oldAdmin = await user('migrated@desk.test', 'admin');
    process.env.PLATFORM_ADMIN_EMAILS = 'ops@radixile.test';
    try {
      expect((await (await as(staff)).get('/api/billing').set('x-ws', String(wsId))).body.can_manage).toBe(true);
      expect((await (await as(oldAdmin)).get('/api/billing').set('x-ws', String(wsId))).body.can_manage).toBe(false);
    } finally { delete process.env.PLATFORM_ADMIN_EMAILS; }
  });
});
