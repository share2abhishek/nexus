function nowEpoch() { return Math.floor(Date.now() / 1000); }
function safe(v) { if (!v) return v; try { return JSON.parse(v); } catch { return v; } }

function deserialize(row) {
  if (!row) return row;
  return {
    ...row,
    platforms: safe(row.platforms) || [],
    social_account_ids: safe(row.social_account_ids) || [],
    options: safe(row.options) || null,
  };
}

const TRANSITIONS = {
  draft: {
    in_review: () => ({ reviewed_by: null }),
    // One step for people who may approve their own work (solo users, managers)
    scheduled: (userId, fields) => ({ approved_by: userId, scheduled_at: fields.scheduled_at }),
  },
  in_review: {
    draft: () => ({ reviewed_by: null, approved_by: null }),
    approved: (userId) => ({ approved_by: userId }),
  },
  approved: {
    draft: () => ({ reviewed_by: null, approved_by: null }),
    scheduled: (_userId, fields) => ({ scheduled_at: fields.scheduled_at }),
  },
  scheduled: {
    approved: () => ({ scheduled_at: null }),
  },
  // Retry a failed or missed post: back in the queue, error cleared
  failed: {
    scheduled: (_userId, fields) => ({ scheduled_at: fields.scheduled_at, error_message: null }),
  },
};

module.exports = (knex) => ({
  async create(workspaceId, userId, data) {
    const rows = await knex('content_items').insert({
      workspace_id: workspaceId,
      title: data.title || null,
      body: data.body,
      platforms: JSON.stringify(data.platforms || []),
      image_url: data.image_url || null,
      social_account_ids: JSON.stringify(data.social_account_ids || []),
      options: data.options ? JSON.stringify(data.options) : null,
      status: 'draft',
      scheduled_at: data.scheduled_at || null,
      submitted_by: userId,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },

  async list(workspaceId, { status, from, to, limit, offset } = {}) {
    let query = knex('content_items').where({ workspace_id: workspaceId });
    if (status) query = query.where({ status });
    if (from != null && to != null) {
      query = query.where((qb) => {
        qb.whereBetween('scheduled_at', [from, to]).orWhereBetween('created_at', [from, to]);
      });
    }
    query = query.orderBy('created_at', 'desc');
    if (limit != null) query = query.limit(limit);
    if (offset != null) query = query.offset(offset);
    const rows = await query;
    return rows.map(deserialize);
  },

  async getById(workspaceId, id) {
    const row = await knex('content_items').where({ workspace_id: workspaceId, id }).first();
    return row ? deserialize(row) : null;
  },

  async update(workspaceId, id, data) {
    const existing = await knex('content_items').where({ workspace_id: workspaceId, id }).first();
    if (!existing) return null;

    const patch = { updated_at: nowEpoch() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.body !== undefined) patch.body = data.body;
    if (data.platforms !== undefined) patch.platforms = JSON.stringify(data.platforms);
    if (data.image_url !== undefined) patch.image_url = data.image_url;
    if (data.social_account_ids !== undefined) patch.social_account_ids = JSON.stringify(data.social_account_ids);
    if (data.options !== undefined) patch.options = data.options ? JSON.stringify(data.options) : null;
    if (data.scheduled_at !== undefined) patch.scheduled_at = data.scheduled_at;

    if (existing.status === 'failed') {
      patch.status = 'draft';
      patch.error_message = null;
    }

    await knex('content_items').where({ workspace_id: workspaceId, id }).update(patch);
    return this.getById(workspaceId, id);
  },

  async transition(workspaceId, id, { toStatus, userId, fields = {} }) {
    const item = await knex('content_items').where({ workspace_id: workspaceId, id }).first();
    if (!item) return { ok: false, error: 'not_found' };

    const edges = TRANSITIONS[item.status];
    const buildPatch = edges && edges[toStatus];
    if (!buildPatch) return { ok: false, error: 'invalid_transition' };

    const patch = { status: toStatus, updated_at: nowEpoch(), ...buildPatch(userId, fields) };
    await knex('content_items').where({ workspace_id: workspaceId, id }).update(patch);
    return { ok: true, item: await this.getById(workspaceId, id) };
  },

  remove(workspaceId, id) {
    return knex('content_items').where({ workspace_id: workspaceId, id }).del();
  },

  async getDueForPublish(now) {
    const rows = await knex('content_items').where({ status: 'scheduled' }).where('scheduled_at', '<=', now);
    return rows.map(deserialize);
  },

  // scheduled -> publishing, atomically. Only the caller that wins may publish,
  // so a restart mid-run or a second app instance can't post the same item twice.
  async claimForPublish(id) {
    const n = await knex('content_items').where({ id, status: 'scheduled' })
      .update({ status: 'publishing', updated_at: nowEpoch() });
    return n > 0;
  },

  markPublished(id) {
    return knex('content_items').where({ id }).update({
      status: 'published',
      published_at: nowEpoch(),
      error_message: null,
      updated_at: nowEpoch(),
    });
  },

  markFailed(id, errorMessage) {
    return knex('content_items').where({ id }).update({
      status: 'failed',
      error_message: errorMessage,
      updated_at: nowEpoch(),
    });
  },
});
