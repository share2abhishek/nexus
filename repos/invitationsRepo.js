const crypto = require('crypto');

module.exports = (knex) => ({
  async create({ orgId, workspaceId, email, role, invitedBy, expiresInHours = 168 }) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires_at = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
    await knex('invitations').insert({ org_id: orgId, workspace_id: workspaceId, email, role, token, invited_by: invitedBy, expires_at });
    return { token, email, role };
  },
  get(token) { return knex('invitations').where({ token }).first(); },
  // Returns false, or { role } with the role the person now has in the workspace.
  async accept(token, userId) {
    const now = Math.floor(Date.now() / 1000);
    return knex.transaction(async (trx) => {
      const inv = await trx('invitations').where({ token }).first();
      if (!inv || inv.accepted_at) return false;
      if (inv.expires_at && inv.expires_at < now) return false;
      // Claim the invite first, so the same link can't be used twice at once
      const claimed = await trx('invitations').where({ token }).whereNull('accepted_at').update({ accepted_at: now });
      if (!claimed) return false;
      // Someone who is already a member keeps their current role — an invite link
      // must not be a way to demote (or promote) an existing member.
      await trx('memberships')
        .insert({ user_id: userId, workspace_id: inv.workspace_id, role: inv.role })
        .onConflict(['user_id', 'workspace_id']).ignore();
      const m = await trx('memberships').where({ user_id: userId, workspace_id: inv.workspace_id }).first();
      return { role: m?.role || inv.role };
    });
  },
});
