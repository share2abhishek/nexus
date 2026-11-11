const { makeTestKnex } = require('./helpers/db');

describe('content_items migration', () => {
  let knex;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
  });
  afterAll(async () => { await knex.destroy(); });

  test('creates content_items with the expected columns', async () => {
    expect(await knex.schema.hasTable('content_items')).toBe(true);
    for (const col of [
      'id', 'workspace_id', 'title', 'body', 'platforms', 'image_url',
      'social_account_ids', 'status', 'scheduled_at', 'published_at',
      'submitted_by', 'reviewed_by', 'approved_by', 'error_message',
      'created_at', 'updated_at',
    ]) {
      expect(await knex.schema.hasColumn('content_items', col)).toBe(true);
    }
  });

  test('creates content_item_comments with the expected columns', async () => {
    expect(await knex.schema.hasTable('content_item_comments')).toBe(true);
    for (const col of ['id', 'content_item_id', 'workspace_id', 'user_id', 'body', 'created_at']) {
      expect(await knex.schema.hasColumn('content_item_comments', col)).toBe(true);
    }
  });

  test('content_items defaults status to draft', async () => {
    const orgRows = await knex('organizations').insert({ name: 'T', owner_user_id: 1 }).returning('id');
    const orgId = orgRows[0]?.id ?? orgRows[0];
    const wsRows = await knex('workspaces').insert({ org_id: orgId, name: 'WS', slug: 'ws' }).returning('id');
    const workspaceId = wsRows[0]?.id ?? wsRows[0];

    const rows = await knex('content_items').insert({ workspace_id: workspaceId, body: 'Hello' }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    const row = await knex('content_items').where({ id }).first();
    expect(row.status).toBe('draft');
    expect(row.created_at).toBeGreaterThan(0);
    expect(row.updated_at).toBeGreaterThan(0);
  });
});
