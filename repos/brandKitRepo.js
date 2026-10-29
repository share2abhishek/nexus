// repos/brandKitRepo.js — workspace-scoped brand kit
module.exports = (knex) => ({
  async get(workspaceId) {
    return (await knex('brand_kit').where({ workspace_id: workspaceId }).orderBy('id', 'desc').first()) || {};
  },

  async upsert(workspaceId, data) {
    const existing = await knex('brand_kit').where({ workspace_id: workspaceId }).first();
    const epochNow = knex.client.config.client === 'pg'
      ? knex.raw("extract(epoch from now())::bigint")
      : knex.raw("strftime('%s','now')");

    if (existing) {
      await knex('brand_kit').where({ id: existing.id }).update({ ...data, updated_at: epochNow });
    } else {
      await knex('brand_kit').insert({ workspace_id: workspaceId, ...data, updated_at: epochNow });
    }
  },
});
