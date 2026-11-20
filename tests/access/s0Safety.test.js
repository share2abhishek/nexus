// S0 safety fixes (docs/platform/ROADMAP.md):
//  - hosted edition: /admin (lists and changes people across every business) needs a Radixile platform admin;
//    a plain 'admin' role is not enough. The desktop app keeps its install admin.
//  - the workspace comes from the header, the route or the session, never from the request body.
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { makeTestKnex } = require('../helpers/db');

const mockKnex = makeTestKnex();
jest.mock('../../services/knex', () => mockKnex);

let ids;
beforeAll(async () => {
  await mockKnex.migrate.latest();
  const add = async (email, role) => {
    const [r] = await mockKnex('users').insert({ email, password_hash: 'h', role, email_verified_at: 1 }).returning('id');
    return r?.id ?? r;
  };
  ids = { admin: await add('owner@customer.test', 'admin'), staff: await add('staff@radixile.test', 'superadmin'), user: await add('member@customer.test', 'user') };
});
afterAll(() => mockKnex.destroy());

function adminApp(userId) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret-test-secret-test-secret', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => { req.session.userId = userId; next(); });
  app.use('/admin', require('../../routes/admin'));
  return app;
}

describe('/admin on the hosted edition', () => {
  beforeEach(() => { process.env.NEXUS_MODE = 'server'; require('../../services/platformAdmin').forget(); });
  afterEach(() => { delete process.env.NEXUS_MODE; });

  test("a customer with the 'admin' role cannot list or change people of every business", async () => {
    const app = adminApp(ids.admin);
    for (const [method, path] of [['get', '/admin/users'], ['get', `/admin/users/${ids.user}`], ['get', '/admin/stats'], ['get', '/admin/activity'], ['get', '/admin/invite-codes'], ['patch', `/admin/users/${ids.user}/status`], ['delete', `/admin/users/${ids.user}`]]) {
      const res = await request(app)[method](path).send({ status: 'suspended' });
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
    expect((await mockKnex('users').where({ id: ids.user }).first()).status).not.toBe('suspended');
  });

  test('a Radixile platform admin still can', async () => {
    const res = await request(adminApp(ids.staff)).get('/admin/users');
    expect(res.status).toBe(200);
  });
});

test("desktop app: the install admin keeps the Users screen", async () => {
  delete process.env.NEXUS_MODE;
  require('../../services/platformAdmin').forget();
  const res = await request(adminApp(ids.admin)).get('/admin/users');
  expect(res.status).toBe(200);
});

describe('the workspace never comes from the request body', () => {
  const { makeWithWorkspace } = require('../../middleware/tenancy');
  const repo = { roleFor: async (u, ws) => (ws === 5 ? 'manager' : ws === 9 ? 'manager' : null), listForUser: async () => [{ workspace_id: 5 }] };
  const run = async (req) => {
    const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; } };
    let called = false;
    await makeWithWorkspace(repo)(req, res, () => { called = true; });
    return { req, called, code: res.code };
  };

  test('a workspace id in the body is ignored; the session decides', async () => {
    const { req, called } = await run({ session: { userId: 1, activeWorkspaceId: 5 }, headers: {}, params: {}, body: { workspaceId: 9 } });
    expect(called).toBe(true);
    expect(req.workspaceId).toBe(5);
  });

  test('the header still selects among the person\'s own workspaces', async () => {
    const { req } = await run({ session: { userId: 1, activeWorkspaceId: 5 }, headers: { 'x-workspace-id': '9' }, params: {}, body: {} });
    expect(req.workspaceId).toBe(9);
  });
});
