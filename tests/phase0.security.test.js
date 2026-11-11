const express = require('express');
const session = require('express-session');
const request = require('supertest');
const { makeTestKnex } = require('./helpers/db');

jest.mock('../services/social', () => ({ postToPlatform: jest.fn() }));
const { postToPlatform } = require('../services/social');

async function makeWorkspace(knex, name, slug) {
  const orgRows = await knex('organizations').insert({ name: `${name} Org`, owner_user_id: 1 }).returning('id');
  const orgId = orgRows[0]?.id ?? orgRows[0];
  const wsRows = await knex('workspaces').insert({ org_id: orgId, name, slug }).returning('id');
  return wsRows[0]?.id ?? wsRows[0];
}

describe('core tables migration', () => {
  let knex;
  beforeAll(async () => { knex = makeTestKnex(); await knex.migrate.latest(); });
  afterAll(async () => { await knex.destroy(); });

  test('a fresh database gets users/user_settings/invite_codes/platform_config', async () => {
    for (const t of ['users', 'user_settings', 'invite_codes', 'platform_config', 'scheduled_posts', 'history']) {
      expect(await knex.schema.hasTable(t)).toBe(true);
    }
    expect(await knex.schema.hasColumn('user_settings', 'groq_key')).toBe(true);
    expect(await knex.schema.hasColumn('scheduled_posts', 'workspace_id')).toBe(true);
  });
});

describe('usersRepo', () => {
  let knex, usersRepo;
  beforeAll(async () => {
    knex = makeTestKnex(); await knex.migrate.latest();
    usersRepo = require('../repos/usersRepo')(knex);
  });
  afterAll(async () => { await knex.destroy(); });

  test('getSettings returns {} (not undefined) when the user has no settings row', async () => {
    expect(await usersRepo.getSettings(999)).toEqual({});
  });

  test('only the first user becomes admin', async () => {
    const a = await usersRepo.create('first@example.com', 'h', 'A');
    const b = await usersRepo.create('second@example.com', 'h', 'B');
    expect(a.role).toBe('admin');
    expect(b.role).toBe('user');
  });

  test('invite codes are 12 unambiguous characters and use count increments', async () => {
    const { id: userId } = await usersRepo.create('inviter@example.com', 'h', 'I');
    const { code } = await usersRepo.createInviteCode(userId, 'n', 24, 2);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(await usersRepo.claimInviteCode(code)).toBe(true);
    await usersRepo.useInviteCode(code, userId);
    expect((await usersRepo.getInviteCode(code)).use_count).toBe(1);
    expect(await usersRepo.claimInviteCode(code)).toBe(true);   // max_uses = 2
    expect(await usersRepo.claimInviteCode(code)).toBe(false);  // used up
  });
});

describe('scheduler never publishes through another workspace\'s accounts', () => {
  let knex, wsA, wsB, processDueScheduled, processDueContent, contentRepo;

  beforeAll(async () => {
    knex = makeTestKnex(); await knex.migrate.latest();
    wsA = await makeWorkspace(knex, 'Tenant A', 'tenant-a');
    wsB = await makeWorkspace(knex, 'Tenant B', 'tenant-b');
    ({ processDueScheduled, processDueContent } = require('../services/scheduler'));
    contentRepo = require('../repos/contentRepo')(knex);
  });
  afterAll(async () => { await knex.destroy(); });
  beforeEach(() => { postToPlatform.mockReset(); postToPlatform.mockResolvedValue({ success: true }); });

  async function accountIn(ws, platform) {
    const rows = await knex('social_accounts').insert({
      workspace_id: ws, platform, external_id: `${platform}-${ws}`, access_token: `tok-${ws}`,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  }

  test('legacy scheduled post in A is not sent with B\'s token', async () => {
    await accountIn(wsB, 'linkedin');
    const rows = await knex('scheduled_posts').insert({
      workspace_id: wsA, content: 'hello', platforms: JSON.stringify(['linkedin']),
      scheduled_at: Math.floor(Date.now() / 1000) - 5,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];

    await processDueScheduled(knex);

    expect(postToPlatform).not.toHaveBeenCalled();
    expect((await knex('scheduled_posts').where({ id }).first()).status).toBe('failed');
  });

  test('legacy scheduled post publishes with its own workspace token', async () => {
    await accountIn(wsA, 'twitter');
    await knex('scheduled_posts').insert({
      workspace_id: wsA, content: 'own', platforms: JSON.stringify(['twitter']),
      scheduled_at: Math.floor(Date.now() / 1000) - 5,
    });

    await processDueScheduled(knex);

    expect(postToPlatform).toHaveBeenCalledWith('twitter', expect.objectContaining({ access_token: `tok-${wsA}` }), 'own', null);
  });

  test('content item in A referencing B\'s account id is not published', async () => {
    const foreignId = await accountIn(wsB, 'pinterest');
    const id = await contentRepo.create(wsA, 1, { body: 'x', platforms: ['pinterest'], social_account_ids: [foreignId] });
    await knex('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: Math.floor(Date.now() / 1000) - 5 });

    await processDueContent(knex, contentRepo);

    expect(postToPlatform).not.toHaveBeenCalled();
    expect((await contentRepo.getById(wsA, id)).status).toBe('failed');
  });
});

describe('OAuth state + workspace permission', () => {
  // routes/auth.js uses the shared knex instance — point it at a test database,
  // and stub the token exchange so nothing goes to LinkedIn.
  let app, knex, axios, managerId, outsiderId, wsId;
  beforeAll(async () => {
    jest.resetModules();
    jest.doMock('../services/knex', () => require('./helpers/db').makeTestKnex());
    jest.doMock('axios', () => ({ post: jest.fn().mockRejectedValue(new Error('no network in tests')), get: jest.fn() }));
    knex = require('../services/knex');
    axios = require('axios');
    await knex.migrate.latest();
    const ins = async (t, row) => { const r = await knex(t).insert(row).returning('id'); return r[0]?.id ?? r[0]; };
    managerId = await ins('users', { email: 'mgr@example.test', password_hash: 'h' });
    outsiderId = await ins('users', { email: 'out@example.test', password_hash: 'h' });
    const orgId = await ins('organizations', { name: 'O', owner_user_id: managerId });
    wsId = await ins('workspaces', { org_id: orgId, name: 'W', slug: 'w-oauth' });
    await knex('memberships').insert({ user_id: managerId, workspace_id: wsId, role: 'manager' });

    process.env.LINKEDIN_CLIENT_ID = 'test-client';
    process.env.LINKEDIN_CALLBACK_URL = 'http://localhost:3000/auth/linkedin/callback';
    app = express();
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    // Test-only sign-in: ?as=<userId>&ws=<workspaceId>
    app.get('/test-login', (req, res) => {
      req.session.userId = Number(req.query.as);
      if (req.query.ws) req.session.activeWorkspaceId = Number(req.query.ws);
      res.json({ ok: true });
    });
    app.use('/auth', require('../routes/auth'));
  });
  afterAll(async () => { await knex.destroy(); jest.dontMock('../services/knex'); jest.dontMock('axios'); });

  test('authorize redirect carries a random state, not a fixed string', async () => {
    const agent = request.agent(app);
    await agent.get(`/test-login?as=${managerId}&ws=${wsId}`);
    const res = await agent.get('/auth/linkedin');
    const state = new URL(res.headers.location).searchParams.get('state');
    expect(state).toMatch(/^[0-9a-f]{48}$/);
  });

  test('callback with a forged state is rejected before any token exchange', async () => {
    const res = await request(app).get('/auth/linkedin/callback?code=abc&state=nexus-linkedin');
    expect(res.headers.location).toBe('/?error=oauth_state_invalid');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('callback with the issued state passes the state and workspace checks', async () => {
    const agent = request.agent(app);
    await agent.get(`/test-login?as=${managerId}&ws=${wsId}`);
    const start = await agent.get('/auth/linkedin');
    const state = new URL(start.headers.location).searchParams.get('state');
    const res = await agent.get(`/auth/linkedin/callback?code=abc&state=${state}`);
    // Got as far as the (stubbed) token exchange
    expect(res.headers.location).toBe('/?error=linkedin_failed');
  });

  test('a user cannot act on a workspace they are not a member of', async () => {
    const agent = request.agent(app);
    await agent.get(`/test-login?as=${outsiderId}&ws=${wsId}`); // forged active workspace
    const start = await agent.get('/auth/linkedin');
    expect(start.headers.location).toBe('/?error=not_allowed');
    // The victim workspace's connected account must be untouched
    await knex('social_accounts').insert({ workspace_id: wsId, platform: 'linkedin', external_id: 'victim', access_token: 'victim-token' });
    await agent.post('/auth/disconnect/linkedin');
    const still = await knex('social_accounts').where({ workspace_id: wsId, platform: 'linkedin' }).first();
    expect(still?.access_token).toBe('victim-token');
  });
});
