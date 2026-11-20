// GET /api/me/access (A0) and the engine's entitlement steps through services/accessHost.js.
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { makeTestKnex } = require('../helpers/db');

const mockKnex = makeTestKnex();
jest.mock('../../services/knex', () => mockKnex);

const access = require('../../modules/access');
const accessHost = require('../../services/accessHost');
const { makeWithWorkspace } = require('../../middleware/tenancy');

let ids;
const now = () => Math.floor(Date.now() / 1000);
beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await mockKnex.migrate.latest();
  const one = async (q) => { const [r] = await q.returning('id'); return r?.id ?? r; };
  const owner = await one(mockKnex('users').insert({ email: 'owner@a.test', password_hash: 'h', role: 'user', email_verified_at: 1 }));
  const creator = await one(mockKnex('users').insert({ email: 'creator@a.test', password_hash: 'h', role: 'user', email_verified_at: 1 }));
  const org = await one(mockKnex('organizations').insert({ name: 'A', owner_user_id: owner, plan: 'trial', trial_ends_at: now() + 10 * 86400 }));
  const ws = await one(mockKnex('workspaces').insert({ org_id: org, name: 'A main', slug: 'a-main' }));
  await mockKnex('memberships').insert([{ user_id: owner, workspace_id: ws, role: 'manager' }, { user_id: creator, workspace_id: ws, role: 'creator' }]);
  ids = { owner, creator, org, ws };
});
afterAll(async () => { console.log.mockRestore(); await mockKnex.destroy(); });
beforeEach(() => { process.env.NEXUS_MODE = 'server'; accessHost.forgetOrg(); require('../../services/entitlements').forget(); });
afterEach(() => { delete process.env.NEXUS_MODE; });

function app(userId) {
  const a = express();
  a.use(session({ secret: 'test-secret-test-secret-test-secret', resave: false, saveUninitialized: true }));
  a.use((req, res, next) => { req.session.userId = userId; next(); });
  const withWorkspace = makeWithWorkspace(require('../../repos/membershipsRepo')(mockKnex), { loadOrg: accessHost.workspaceOrg });
  a.get('/api/me/access', withWorkspace, async (req, res) => res.json(await access.explain(access.context(req))));
  a.post('/publish', withWorkspace, access.middleware('content.publish'), (req, res) => res.json({ ok: true }));
  return a;
}

test('the creator sees their role, what they may do, the trial and the three plan limits', async () => {
  const res = await request(app(ids.creator)).get('/api/me/access');
  expect(res.status).toBe(200);
  expect(res.body.org).toEqual({ id: ids.org, status: 'active' });
  expect(res.body.workspace).toEqual({ id: ids.ws, role: 'creator' });
  expect(res.body.permissions).toEqual(expect.arrayContaining(['content.create', 'content.view', 'analytics.view']));
  expect(res.body.permissions).not.toContain('content.publish');
  expect(res.body.subscription).toMatchObject({ state: 'active', can_publish: true, plan: 'trial' });
  expect(res.body.subscription.trial_days_left).toBeGreaterThan(8);
  expect(res.body.limits.map((l) => [l.key, l.limit, l.used])).toEqual([['workspaces', 3, 1], ['users', 5, 2], ['seo_sites', 1, 0]]);
  expect(res.body.features.whatsapp_bot_ai).toBe('on');
});

test('the manager may publish; the creator is refused with the old answer', async () => {
  expect((await request(app(ids.owner)).post('/publish')).status).toBe(200);
  const res = await request(app(ids.creator)).post('/publish');
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ error: 'Forbidden', code: 'forbidden', requiredPermission: 'content.publish' });
});

test('an organisation the platform suspended can still read, but not publish (within 5 seconds)', async () => {
  await mockKnex('organizations').where({ id: ids.org }).update({ status: 'suspended' });
  accessHost.forgetOrg();
  try {
    const res = await request(app(ids.owner)).post('/publish');
    expect([res.status, res.body.code]).toEqual([403, 'orgsuspended']);
    const me = await request(app(ids.owner)).get('/api/me/access');
    expect(me.body.permissions).toContain('content.view');
    expect(me.body.permissions).not.toContain('content.publish');
  } finally {
    await mockKnex('organizations').where({ id: ids.org }).update({ status: 'active' });
  }
});

test('check() with entitlements: an expired trial refuses publishing (402); reading still allowed', async () => {
  await mockKnex('organizations').where({ id: ids.org }).update({ trial_ends_at: now() - 86400 });
  try {
    const ctx = { actor: { kind: 'user', userId: ids.owner, staff: false }, orgId: ids.org, orgStatus: 'active', workspaceId: ids.ws, workspaceRole: 'manager', edition: 'server' };
    const d = await access.check(ctx, 'content.publish', { entitlements: true });
    expect([d.allow, d.http, d.code]).toEqual([false, 402, 'subscriptionexpired']);
    expect((await access.check(ctx, 'content.view', { entitlements: true })).allow).toBe(true);
    // Without the option (what the routes use in A0) nothing changes
    expect((await access.check(ctx, 'content.publish')).allow).toBe(true);
    await expect(access.assert(ctx, 'content.publish', { entitlements: true })).rejects.toMatchObject({ status: 402 });
  } finally {
    await mockKnex('organizations').where({ id: ids.org }).update({ trial_ends_at: now() + 10 * 86400 });
  }
});

test('check() with entitlements: a read error allows (entitlements fail open)', async () => {
  const ctx = { actor: { kind: 'user', userId: ids.owner, staff: false }, orgId: ids.org, orgStatus: 'active', workspaceId: ids.ws, workspaceRole: 'manager', edition: 'server' };
  access._setHost({ subscription: async () => { throw new Error('db down'); }, limitProblem: async () => { throw new Error('db down'); } });
  try {
    expect((await access.check(ctx, 'content.publish', { entitlements: true })).allow).toBe(true);
  } finally { access._setHost(null); }
});

test('decide() is fast: well under the 5 ms budget per check', () => {
  const ctx = access.context({ session: { userId: 1 }, workspaceId: 2, role: 'creator', orgStatus: 'active' });
  const keys = ['content.view', 'content.publish', 'analytics.view', 'members.manage'];
  const times = [];
  for (let i = 0; i < 2000; i++) {
    const t = process.hrtime.bigint();
    for (const k of keys) access.decide(ctx, k);
    times.push(Number(process.hrtime.bigint() - t) / 1e6 / keys.length);
  }
  times.sort((a, b) => a - b);
  expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(5);
});
