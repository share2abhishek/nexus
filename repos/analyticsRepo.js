// repos/analyticsRepo.js — workspace-scoped analytics
module.exports = (knex) => ({
  async save(workspaceId, data) {
    await knex('analytics').insert({
      workspace_id: workspaceId,
      post_id:     data.post_id     || null,
      platform:    data.platform,
      likes:       data.likes       || 0,
      comments:    data.comments    || 0,
      shares:      data.shares      || 0,
      impressions: data.impressions || 0,
      clicks:      data.clicks      || 0,
    });
  },

  async list(workspaceId) {
    return knex('analytics as a')
      .leftJoin('posts as p', 'p.id', 'a.post_id')
      .where('a.workspace_id', workspaceId)
      .orderBy('a.recorded_at', 'desc')
      .select('a.*', 'p.content', 'p.created_at as posted_at');
  },

  async summary(workspaceId) {
    return knex('analytics')
      .where({ workspace_id: workspaceId })
      .groupBy('platform')
      .select(
        'platform',
        knex.raw('COUNT(*) as post_count'),
        knex.raw('SUM(likes) as total_likes'),
        knex.raw('SUM(comments) as total_comments'),
        knex.raw('SUM(shares) as total_shares'),
        knex.raw('SUM(impressions) as total_impressions'),
        knex.raw('SUM(clicks) as total_clicks'),
      );
  },
});
