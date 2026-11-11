// repos/utmRepo.js — workspace-scoped UTM links
module.exports = (knex) => ({
  async list(workspaceId) {
    return knex('utm_links').where({ workspace_id: workspaceId }).orderBy('created_at', 'desc');
  },

  async save(workspaceId, data) {
    const rows = await knex('utm_links').insert({
      workspace_id:  workspaceId,
      original_url:  data.original_url,
      utm_source:    data.utm_source   || null,
      utm_medium:    data.utm_medium   || null,
      utm_campaign:  data.utm_campaign || null,
      utm_term:      data.utm_term     || null,
      utm_content:   data.utm_content  || null,
      full_url:      data.full_url,
      label:         data.label        || null,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },

  async remove(workspaceId, id) {
    return knex('utm_links').where({ workspace_id: workspaceId, id }).delete();
  },
});
