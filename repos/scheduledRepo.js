// The Compose "scheduled queue", stored as content_items so it is the same data
// the Content Calendar shows (one schedule for the whole app). Keeps the shape the
// /api/post/schedule and /api/posts/scheduled routes always returned.
//
// Accounts are not fixed at scheduling time: the scheduler looks up the
// workspace's connected account for each platform when it publishes, so
// connecting a platform after scheduling still works.
const parse = (v, fallback) => { if (!v) return fallback; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return fallback; } };

function toQueueItem(row) {
  return {
    id: row.id,
    content: row.body,
    platforms: parse(row.platforms, []),
    image_url: row.image_url,
    scheduled_at: row.scheduled_at,
    status: row.status === 'scheduled' ? 'pending' : row.status,
    user_id: row.submitted_by,
    series_id: row.series_id || null,
    series_index: row.series_index || null,
    series_total: row.series_total || null,
    series_every: row.series_every || null,
    result: row.status === 'failed' ? [{ platform: 'all', success: false, error: row.error_message || 'Failed' }] : null,
  };
}

module.exports = (knex) => ({
  async save(workspaceId, userId, data) {
    const rows = await knex('content_items').insert({
      workspace_id: workspaceId,
      body: data.content,
      platforms: JSON.stringify(data.platforms || []),
      image_url: data.image_url || null,
      social_account_ids: '[]',
      status: 'scheduled',
      scheduled_at: data.scheduled_at,
      submitted_by: userId || null,
      approved_by: userId || null, // scheduled straight from Compose by someone allowed to publish
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },
  // A repeating schedule: one post per date, all in one transaction
  async saveSeries(workspaceId, userId, data, dates, every) {
    const seriesId = require('crypto').randomUUID();
    const base = {
      workspace_id: workspaceId,
      body: data.content,
      platforms: JSON.stringify(data.platforms || []),
      image_url: data.image_url || null,
      social_account_ids: '[]',
      status: 'scheduled',
      submitted_by: userId || null,
      approved_by: userId || null,
      series_id: seriesId,
      series_total: dates.length,
      series_every: every,
    };
    await knex.transaction(async (trx) => {
      const rows = dates.map((d, i) => ({ ...base, scheduled_at: Math.floor(d.getTime() / 1000), series_index: i + 1 }));
      for (let i = 0; i < rows.length; i += 100) await trx('content_items').insert(rows.slice(i, i + 100));
    });
    return seriesId;
  },
  // Stop a repeating schedule: removes the posts that haven't gone out yet.
  // Published and failed posts stay (they are history).
  stopSeries(workspaceId, seriesId) {
    return knex('content_items').where({ workspace_id: workspaceId, series_id: seriesId, status: 'scheduled' }).del();
  },
  async listPending(workspaceId) {
    const rows = await knex('content_items').where({ workspace_id: workspaceId, status: 'scheduled' }).orderBy('scheduled_at', 'asc');
    return rows.map(toQueueItem);
  },
  // Failed posts from the last N days, so the user can see why and retry
  async listRecentFailed(workspaceId, days = 14) {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = await knex('content_items')
      .where({ workspace_id: workspaceId, status: 'failed' })
      .where((q) => q.where('scheduled_at', '>=', since).orWhere('updated_at', '>=', since))
      .orderBy('updated_at', 'desc');
    return rows.map(toQueueItem);
  },
  retry(workspaceId, id, runAt) {
    return knex('content_items').where({ workspace_id: workspaceId, id, status: 'failed' })
      .update({ status: 'scheduled', scheduled_at: runAt, error_message: null, updated_at: Math.floor(Date.now() / 1000) });
  },
  // Only queue items (scheduled/failed) can be removed from here; drafts and
  // published posts are managed on the calendar
  remove(workspaceId, id) {
    return knex('content_items').where({ workspace_id: workspaceId, id }).whereIn('status', ['scheduled', 'failed']).del();
  },
});
