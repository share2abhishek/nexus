const { makeTestKnex } = require('./helpers/db');
const runLegacyMigration = require('../services/legacyMigration');

async function seedLegacy(knex) {
  // emulate pre-tenancy data
  await knex('platform_config').insert({ key: 'x', value: '1' }).catch(()=>{});
  await knex('users').insert({ id: 1, email: 'a@b.c', password_hash: 'h', name: 'Admin', role: 'admin' });
  await knex('tokens').insert({ platform: 'x', access_token: 'tok', external_id: null });
  await knex('posts').insert({ content: 'hi', platforms: '["x"]', status: 'published' });
}

describe('legacy migration', () => {
  let knex;
  beforeAll(async () => {
    knex = makeTestKnex();
    // create legacy tables the app already had
    await knex.schema.createTable('users', t => { t.increments('id'); t.string('email'); t.string('password_hash'); t.string('name'); t.string('role'); });
    await knex.schema.createTable('platform_config', t => { t.string('key').primary(); t.string('value'); });
    await knex.schema.createTable('tokens', t => { t.string('platform'); t.string('access_token'); t.string('external_id'); });
    await knex.schema.createTable('posts', t => { t.increments('id'); t.text('content'); t.text('platforms'); t.string('status'); });
    await knex.migrate.latest(); // adds tenancy tables + workspace_id columns
    await seedLegacy(knex);
  });
  afterAll(async () => { await knex.destroy(); });

  test('creates org/workspace/membership, migrates tokens, stamps rows, idempotent', async () => {
    await runLegacyMigration(knex);
    const org = await knex('organizations').first();
    const wsp = await knex('workspaces').first();
    expect(org).toBeTruthy();
    expect(wsp.org_id).toBe(org.id);
    expect(await knex('memberships').where({ user_id: 1, workspace_id: wsp.id }).first()).toBeTruthy();
    expect((await knex('social_accounts').where({ workspace_id: wsp.id })).length).toBe(1);
    const post = await knex('posts').first();
    expect(post.workspace_id).toBe(wsp.id);
    const flag = await knex('platform_config').where({ key: 'tenancy_migrated' }).first();
    expect(flag.value).toBe('1');

    // idempotent: second run creates nothing new
    await runLegacyMigration(knex);
    expect((await knex('organizations')).length).toBe(1);
  });
});
