module.exports = (knex) => ({
  async save(workspaceId, userId, data) {
    const rows = await knex('scheduled_posts').insert({
      workspace_id: workspaceId, user_id: userId || null,
      content: data.content, platforms: JSON.stringify(data.platforms),
      image_url: data.image_url || null, scheduled_at: data.scheduled_at,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },
  async listPending(workspaceId) {
    const rows = await knex('scheduled_posts').where({ workspace_id: workspaceId, status: 'pending' }).orderBy('scheduled_at', 'asc');
    return rows.map(p => ({ ...p, platforms: safe(p.platforms) }));
  },
  async getDue(workspaceId) {
    const now = Math.floor(Date.now() / 1000);
    const rows = await knex('scheduled_posts').where({ workspace_id: workspaceId, status: 'pending' }).where('scheduled_at', '<=', now);
    return rows.map(p => ({ ...p, platforms: safe(p.platforms) }));
  },
  updateStatus(id, status, result) {
    return knex('scheduled_posts').where({ id }).update({ status, result: result ? JSON.stringify(result) : null });
  },
  remove(workspaceId, id) {
    return knex('scheduled_posts').where({ workspace_id: workspaceId, id }).del();
  },
});
function safe(v){ if(!v) return v; try { return JSON.parse(v); } catch { return v; } }
