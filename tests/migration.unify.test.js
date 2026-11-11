// 20261028000001_unify_schedule: old Compose queue rows move to content_items
const { makeTestKnex } = require('./helpers/db');
const migration = require('../db/migrations/20261028000001_unify_schedule');

test('pending and failed scheduled_posts move to content_items; published stay', async () => {
  const knex = makeTestKnex();
  try {
    await knex.migrate.latest();
    const org = await knex('organizations').insert({ name: 'Org', owner_user_id: 1 }).returning('id');
    const ws = await knex('workspaces').insert({ org_id: org[0]?.id ?? org[0], name: 'WS', slug: 'ws-mig' }).returning('id');
    const wsId = ws[0]?.id ?? ws[0];
    const t = Math.floor(Date.now() / 1000) + 3600;
    await knex('scheduled_posts').insert([
      { workspace_id: wsId, user_id: 1, content: 'pending one', platforms: '["linkedin"]', scheduled_at: t, status: 'pending' },
      { workspace_id: wsId, user_id: 1, content: 'failed one', platforms: '["facebook"]', scheduled_at: t, status: 'failed', result: JSON.stringify([{ platform: 'facebook', success: false, error: 'Token expired' }]) },
      { workspace_id: wsId, user_id: 1, content: 'done one', platforms: '["x"]', scheduled_at: t, status: 'published' },
    ]);

    await migration.up(knex); // run again over the new rows

    const items = await knex('content_items').where({ workspace_id: wsId }).orderBy('id');
    expect(items.map(i => [i.body, i.status])).toEqual([['pending one', 'scheduled'], ['failed one', 'failed']]);
    expect(items[1].error_message).toBe('Token expired');
    expect((await knex('scheduled_posts').where({ status: 'moved' })).length).toBe(2);
    expect(await knex.schema.hasColumn('user_settings', 'ui_mode')).toBe(true);
  } finally { await knex.destroy(); }
});
