// repos/seoRepo.js — workspace-scoped SEO keywords
module.exports = (knex) => ({
  async list(workspaceId) {
    return knex('seo_keywords').where({ workspace_id: workspaceId }).orderBy('created_at', 'desc');
  },

  async save(workspaceId, data) {
    const rows = await knex('seo_keywords').insert({
      workspace_id: workspaceId,
      keyword:  data.keyword,
      url:      data.url      || null,
      position: data.position || null,
      notes:    data.notes    || null,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },

  async remove(workspaceId, id) {
    return knex('seo_keywords').where({ workspace_id: workspaceId, id }).delete();
  },
});
