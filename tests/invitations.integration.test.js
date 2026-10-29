const { makeTestKnex } = require('./helpers/db');
const { can } = require('../services/rbac');

describe('invitations + role-gated actions', () => {
  let knex, invites, members, ws;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    invites = require('../repos/invitationsRepo')(knex);
    members = require('../repos/membershipsRepo')(knex);
    ws = require('../repos/workspacesRepo')(knex);
  });
  afterAll(async () => { await knex.destroy(); });

  test('invited creator can submit but not publish', async () => {
    const orgRows = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const orgId = orgRows[0]?.id ?? orgRows[0];
    const w = await ws.create({ orgId, name: 'W', slug: 'w' });
    const inv = await invites.create({ orgId, workspaceId: w.id, email: 'c@x.com', role: 'creator', invitedBy: 1 });
    expect(inv.token).toBeTruthy();

    const accepted = await invites.accept(inv.token, 42); // user 42 accepts
    expect(accepted).toEqual({ role: 'creator' });
    expect(await members.roleFor(42, w.id)).toBe('creator');

    expect(can('creator', 'content.submit')).toBe(true);
    expect(can('creator', 'content.publish')).toBe(false);
  });

  test('expired invite rejected', async () => {
    const inv = await invites.create({ orgId: 1, workspaceId: 1, email: 'e@x.com', role: 'client', invitedBy: 1, expiresInHours: -1 });
    expect(await invites.accept(inv.token, 7)).toBe(false);
  });
});

describe('invitation acceptance rules', () => {
  let knex, invites, members, ws;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    invites = require('../repos/invitationsRepo')(knex);
    members = require('../repos/membershipsRepo')(knex);
    ws = require('../repos/workspacesRepo')(knex);
  });
  afterAll(async () => { await knex.destroy(); });

  test('accepting does not change an existing member\'s role', async () => {
    const orgRows = await knex('organizations').insert({ name: 'O2', owner_user_id: 1 }).returning('id');
    const orgId = orgRows[0]?.id ?? orgRows[0];
    const w = await ws.create({ orgId, name: 'W2', slug: 'w2' });
    await knex('memberships').insert({ user_id: 5, workspace_id: w.id, role: 'manager' });
    const inv = await invites.create({ orgId, workspaceId: w.id, email: 'm@x.com', role: 'client', invitedBy: 1 });
    expect(await invites.accept(inv.token, 5)).toEqual({ role: 'manager' });
    expect(await invites.accept(inv.token, 5)).toBe(false); // single use
    expect(await members.roleFor(5, w.id)).toBe('manager');
  });
});
