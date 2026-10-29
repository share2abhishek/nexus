// repos/appsRepo.js — workspace-scoped ASO apps
module.exports = (knex) => ({
  async list(workspaceId) {
    return knex('apps').where({ workspace_id: workspaceId }).orderBy('created_at', 'desc');
  },

  async save(workspaceId, data) {
    const rows = await knex('apps').insert({
      workspace_id:  workspaceId,
      name:          data.name,
      description:   data.description    || null,
      website:       data.website        || null,
      app_store_url: data.app_store_url  || null,
      play_store_url:data.play_store_url || null,
      category:      data.category       || null,
      logo_url:      data.logo_url       || null,
      color:         data.color          || '#7c3aed',
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },

  async update(workspaceId, id, data) {
    return knex('apps').where({ workspace_id: workspaceId, id }).update({
      name:          data.name,
      description:   data.description    || null,
      website:       data.website        || null,
      app_store_url: data.app_store_url  || null,
      play_store_url:data.play_store_url || null,
      category:      data.category       || null,
      logo_url:      data.logo_url       || null,
      color:         data.color          || '#7c3aed',
    });
  },

  async remove(workspaceId, id) {
    return knex('apps').where({ workspace_id: workspaceId, id }).delete();
  },
});
