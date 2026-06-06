const { makeTestKnex } = require('./helpers/db');

describe('tenancy_core migration', () => {
  let knex;
  beforeAll(async () => {
    knex = makeTestKnex();
    // create the posts table to simulate an existing install before migration
    await knex.schema.createTable('posts', (t) => {
      t.increments('id');
      t.text('content');
      t.text('platforms');
      t.string('status');
    });
    await knex.migrate.latest();
  });
  afterAll(async () => { await knex.destroy(); });

  test('creates core tenancy tables', async () => {
    expect(await knex.schema.hasTable('organizations')).toBe(true);
    expect(await knex.schema.hasTable('workspaces')).toBe(true);
    expect(await knex.schema.hasTable('memberships')).toBe(true);
    expect(await knex.schema.hasTable('org_members')).toBe(true);
    expect(await knex.schema.hasTable('invitations')).toBe(true);
    expect(await knex.schema.hasTable('social_accounts')).toBe(true);
  });

  test('posts has workspace_id', async () => {
    expect(await knex.schema.hasColumn('posts', 'workspace_id')).toBe(true);
  });
});
