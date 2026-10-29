// repos/emailRepo.js — workspace-scoped email subscribers & campaigns
module.exports = (knex) => ({
  // ── Subscribers ─────────────────────────────────────────────────────────────

  async listSubscribers(workspaceId) {
    return knex('email_subscribers').where({ workspace_id: workspaceId }).orderBy('created_at', 'desc');
  },

  async addSubscriber(workspaceId, data) {
    // One row per address per workspace (the same person may subscribe to two clients).
    const email = String(data.email).trim().toLowerCase();
    const existing = await knex('email_subscribers').where({ workspace_id: workspaceId }).whereRaw('lower(email) = ?', [email]).first();
    if (existing) {
      const err = new Error('UNIQUE: email already subscribed in this workspace');
      err.code = 'DUPLICATE_SUBSCRIBER';
      throw err;
    }
    const rows = await knex('email_subscribers').insert({
      workspace_id: workspaceId,
      email,
      name:  data.name  || null,
      tags:  data.tags  || null,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },

  async updateSubscriber(workspaceId, id, data) {
    return knex('email_subscribers').where({ workspace_id: workspaceId, id }).update({
      name:   data.name   || null,
      tags:   data.tags   || null,
      status: data.status || 'active',
    });
  },

  async removeSubscriber(workspaceId, id) {
    return knex('email_subscribers').where({ workspace_id: workspaceId, id }).delete();
  },

  // ── Campaigns ────────────────────────────────────────────────────────────────

  async listCampaigns(workspaceId) {
    return knex('email_campaigns').where({ workspace_id: workspaceId }).orderBy('created_at', 'desc');
  },

  async getCampaign(workspaceId, id) {
    return knex('email_campaigns').where({ workspace_id: workspaceId, id }).first();
  },

  async saveCampaign(workspaceId, data) {
    const rows = await knex('email_campaigns').insert({
      workspace_id:  workspaceId,
      name:          data.name,
      subject:       data.subject,
      html_content:  data.html_content  || null,
      text_content:  data.text_content  || null,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },

  // Editing never changes the status — a sent campaign stays "sent" and can't be
  // sent again by just saving it. Only drafts/failed campaigns can be edited.
  async updateCampaign(workspaceId, id, data) {
    const current = await knex('email_campaigns').where({ workspace_id: workspaceId, id }).first();
    if (current && !['draft', 'failed'].includes(current.status)) {
      const err = new Error('This campaign has already been sent and can no longer be edited. Duplicate it to send a new version.');
      err.status = 409;
      throw err;
    }
    return knex('email_campaigns').where({ workspace_id: workspaceId, id }).update({
      name:         data.name,
      subject:      data.subject,
      html_content: data.html_content || null,
      text_content: data.text_content || null,
    });
  },

  // Only one send at a time, and never twice: draft/failed -> sending
  async claimForSending(workspaceId, id) {
    return knex('email_campaigns').where({ workspace_id: workspaceId, id }).whereIn('status', ['draft', 'failed'])
      .update({ status: 'sending' });
  },

  async markFailed(workspaceId, id) {
    return knex('email_campaigns').where({ workspace_id: workspaceId, id, status: 'sending' }).update({ status: 'failed' });
  },

  async markSent(workspaceId, id, sentCount) {
    const epochNow = knex.client.config.client === 'pg'
      ? knex.raw("extract(epoch from now())::bigint")
      : knex.raw("strftime('%s','now')");
    return knex('email_campaigns').where({ workspace_id: workspaceId, id }).update({
      status: 'sent', sent_count: sentCount, sent_at: epochNow,
    });
  },

  async removeCampaign(workspaceId, id) {
    return knex('email_campaigns').where({ workspace_id: workspaceId, id }).delete();
  },
});
