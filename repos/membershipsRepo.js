module.exports = (knex) => ({
  add({ userId, workspaceId, role }) {
    return knex('memberships')
      .insert({ user_id: userId, workspace_id: workspaceId, role })
      .onConflict(['user_id', 'workspace_id']).merge({ role });
  },
  roleFor(userId, workspaceId) {
    return knex('memberships')
      .where({ user_id: userId, workspace_id: workspaceId, status: 'active' })
      .first('role')
      .then(r => (r ? r.role : null));
  },
  listForUser(userId) {
    return knex('memberships as m')
      .join('workspaces as w', 'w.id', 'm.workspace_id')
      .where('m.user_id', userId)
      .select('w.id as workspace_id', 'w.name as workspace_name', 'w.name', 'w.slug', 'w.org_id', 'm.role', 'm.status');
  },
  listMembers(workspaceId) {
    return knex('memberships').where({ workspace_id: workspaceId });
  },
  remove(userId, workspaceId) {
    return knex('memberships').where({ user_id: userId, workspace_id: workspaceId }).del();
  },
});
