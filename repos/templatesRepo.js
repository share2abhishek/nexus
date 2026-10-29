// repos/templatesRepo.js — workspace-scoped content templates
module.exports = (knex) => ({
  async list(workspaceId, type) {
    const q = knex('templates').where({ workspace_id: workspaceId }).orderBy('created_at', 'desc');
    if (type) q.where({ type });
    const rows = await q;
    return rows.map(r => ({ ...r, platforms: safe(r.platforms) }));
  },

  async save(workspaceId, data) {
    const rows = await knex('templates').insert({
      workspace_id: workspaceId,
      name:      data.name,
      content:   data.content,
      type:      data.type      || 'social_post',
      platforms: data.platforms ? JSON.stringify(data.platforms) : null,
      tags:      data.tags      || null,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },

  async remove(workspaceId, id) {
    return knex('templates').where({ workspace_id: workspaceId, id }).delete();
  },
});

function safe(v) { if (!v) return v; try { return JSON.parse(v); } catch { return v; } }
