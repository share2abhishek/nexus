const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

// Build a test app with a fake withWorkspace that directly sets req.workspaceId
// (bypasses real membership DB check) and a fake requirePermission that checks
// req.role against the real RBAC matrix.
function makeApp(knex, wsId, role = 'manager') {
  const { requirePermission } = require('../middleware/tenancy');

  function fakeWithWorkspace(req, _res, next) {
    req.workspaceId = wsId;
    req.role = role;
    next();
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: 1, activeWorkspaceId: wsId };
    next();
  });
  app.use('/workspaces/:workspaceId/social-accounts',
    require('../routes/social-accounts')(knex, fakeWithWorkspace, requirePermission));
  return app;
}

describe('social-accounts route', () => {
  let knex;
  let workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();

    // Create org + workspace
    const orgRows = await knex('organizations')
      .insert({ name: 'Test Org', owner_user_id: 1 })
      .returning('id');
    const orgId = orgRows[0]?.id ?? orgRows[0];

    const wsRows = await knex('workspaces')
      .insert({ org_id: orgId, name: 'Test WS', slug: 'test-ws' })
      .returning('id');
    workspaceId = wsRows[0]?.id ?? wsRows[0];
  });

  afterAll(async () => {
    await knex.destroy();
  });

  test('GET / returns empty array when workspace has no accounts', async () => {
    const app = makeApp(knex, workspaceId);
    const res = await request(app)
      .get(`/workspaces/${workspaceId}/social-accounts`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('GET / returns accounts with profile parsed and access_token stripped', async () => {
    // Insert an account directly via knex
    await knex('social_accounts').insert({
      workspace_id: workspaceId,
      platform: 'linkedin',
      external_id: 'li-123',
      access_token: 'secret-token',
      refresh_token: 'secret-refresh',
      page_token: 'secret-page-token',
      profile_json: JSON.stringify({ id: 'li-123', name: 'Test User' }),
    });

    const app = makeApp(knex, workspaceId);
    const res = await request(app)
      .get(`/workspaces/${workspaceId}/social-accounts`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    const account = res.body.find(a => a.platform === 'linkedin');
    expect(account).toBeDefined();

    // Secrets must be stripped
    expect(account.access_token).toBeUndefined();
    expect(account.refresh_token).toBeUndefined();
    expect(account.page_token).toBeUndefined();

    // Profile must be parsed object
    expect(account.profile).toEqual({ id: 'li-123', name: 'Test User' });
    expect(account.external_id).toBe('li-123');
  });

  test('DELETE /:id removes the account and returns 200', async () => {
    // Insert a fresh account to delete
    await knex('social_accounts').insert({
      workspace_id: workspaceId,
      platform: 'pinterest',
      external_id: 'pin-abc',
      access_token: 'tok',
      profile_json: JSON.stringify({ id: 'pin-abc', name: 'Pinner' }),
    });

    const row = await knex('social_accounts')
      .where({ workspace_id: workspaceId, platform: 'pinterest', external_id: 'pin-abc' })
      .first();

    const app = makeApp(knex, workspaceId, 'manager');
    const res = await request(app)
      .delete(`/workspaces/${workspaceId}/social-accounts/${row.id}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Confirm it's gone
    const gone = await knex('social_accounts').where({ id: row.id }).first();
    expect(gone).toBeUndefined();
  });

  test('DELETE /:id for account in another workspace returns 404', async () => {
    // Create a second workspace
    const orgRows = await knex('organizations')
      .insert({ name: 'Other Org', owner_user_id: 2 })
      .returning('id');
    const otherOrgId = orgRows[0]?.id ?? orgRows[0];

    const wsRows = await knex('workspaces')
      .insert({ org_id: otherOrgId, name: 'Other WS', slug: 'other-ws' })
      .returning('id');
    const otherWsId = wsRows[0]?.id ?? wsRows[0];

    // Insert account in the OTHER workspace
    await knex('social_accounts').insert({
      workspace_id: otherWsId,
      platform: 'twitter',
      external_id: 'tw-999',
      access_token: 'tok',
      profile_json: JSON.stringify({ id: 'tw-999', name: 'Tweeter' }),
    });

    const otherRow = await knex('social_accounts')
      .where({ workspace_id: otherWsId, platform: 'twitter', external_id: 'tw-999' })
      .first();

    // Try to delete from our workspace (workspaceId) but the account belongs to otherWsId
    const app = makeApp(knex, workspaceId, 'manager');
    const res = await request(app)
      .delete(`/workspaces/${workspaceId}/social-accounts/${otherRow.id}`);

    expect(res.status).toBe(404);

    // Account in other workspace must still exist
    const still = await knex('social_accounts').where({ id: otherRow.id }).first();
    expect(still).toBeDefined();
  });
});
