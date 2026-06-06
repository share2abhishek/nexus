const crypto = require('crypto');

module.exports = (knex) => ({
  async create({ orgId, workspaceId, email, role, invitedBy, expiresInHours = 168 }) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires_at = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
    await knex('invitations').insert({ org_id: orgId, workspace_id: workspaceId, email, role, token, invited_by: invitedBy, expires_at });
    return { token, email, role };
  },
  get(token) { return knex('invitations').where({ token }).first(); },
  async accept(token, userId) {
    const inv = await knex('invitations').where({ token }).first();
    if (!inv || inv.accepted_at) return false;
    if (inv.expires_at && inv.expires_at < Math.floor(Date.now() / 1000)) return false;
    await knex('memberships')
      .insert({ user_id: userId, workspace_id: inv.workspace_id, role: inv.role })
      .onConflict(['user_id', 'workspace_id']).merge({ role: inv.role });
    await knex('invitations').where({ token }).update({ accepted_at: Math.floor(Date.now() / 1000) });
    return true;
  },
});
