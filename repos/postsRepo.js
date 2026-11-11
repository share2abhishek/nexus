module.exports = (knex) => ({
  async save(workspaceId, userId, data) {
    const rows = await knex('posts').insert({
      workspace_id: workspaceId, user_id: userId, content: data.content,
      platforms: JSON.stringify(data.platforms), image_url: data.image_url || null,
      results: data.results ? JSON.stringify(data.results) : null, status: data.status || 'published',
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },
  async history(workspaceId, limit = 50) {
    const rows = await knex('posts').where({ workspace_id: workspaceId }).orderBy('created_at', 'desc').limit(limit);
    return rows.map(p => ({ ...p, platforms: safe(p.platforms), results: safe(p.results) }));
  },
});
function safe(v){ if(!v) return v; try { return JSON.parse(v); } catch { return v; } }
