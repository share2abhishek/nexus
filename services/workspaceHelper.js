const knex = require('./knex');

async function ensureDefaultWorkspace(userId) {
  if (!userId) return null;

  // 1. Check if user already has a workspace membership
  const existing = await knex('memberships').where({ user_id: userId }).first();
  if (existing) {
    return existing.workspace_id;
  }

  // 2. User has no workspace. Let's find/create one.
  const user = await knex('users').where({ id: userId }).first();
  if (!user) return null;

  const emailName = user.name || user.email.split('@')[0];
  const orgName = `${emailName}'s Org`;
  const wsName = `${emailName}'s Workspace`;
  const slug = `${emailName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-workspace`;

  try {
    return await knex.transaction(async (trx) => {
      // Create Organization
      const orgRows = await trx('organizations')
        .insert({ name: orgName, owner_user_id: userId, plan: 'free' })
        .returning('id');
      const orgId = Array.isArray(orgRows) ? (orgRows[0]?.id ?? orgRows[0]) : orgRows;
      
      await trx('org_members').insert({ org_id: orgId, user_id: userId, role: 'owner' }).onConflict(['org_id', 'user_id']).ignore();

      // Create Workspace
      const wsRows = await trx('workspaces')
        .insert({ org_id: orgId, name: wsName, slug, timezone: 'UTC' })
        .returning('id');
      const wsId = Array.isArray(wsRows) ? (wsRows[0]?.id ?? wsRows[0]) : wsRows;

      // Create Membership
      await trx('memberships').insert({ user_id: userId, workspace_id: wsId, role: 'manager' }).onConflict(['user_id', 'workspace_id']).ignore();

      return wsId;
    });
  } catch (err) {
    console.error(`[WorkspaceHelper] Failed to create default workspace for user ${userId}:`, err.message);
    // If transaction failed (e.g. unique constraint on slug), try fallback with timestamp/random
    try {
      const fallbackSlug = `${slug}-${Date.now().toString(36)}`;
      return await knex.transaction(async (trx) => {
        const orgRows = await trx('organizations')
          .insert({ name: orgName, owner_user_id: userId, plan: 'free' })
          .returning('id');
        const orgId = Array.isArray(orgRows) ? (orgRows[0]?.id ?? orgRows[0]) : orgRows;
        
        await trx('org_members').insert({ org_id: orgId, user_id: userId, role: 'owner' }).onConflict(['org_id', 'user_id']).ignore();

        const wsRows = await trx('workspaces')
          .insert({ org_id: orgId, name: wsName, slug: fallbackSlug, timezone: 'UTC' })
          .returning('id');
        const wsId = Array.isArray(wsRows) ? (wsRows[0]?.id ?? wsRows[0]) : wsRows;

        await trx('memberships').insert({ user_id: userId, workspace_id: wsId, role: 'manager' }).onConflict(['user_id', 'workspace_id']).ignore();

        return wsId;
      });
    } catch (fallbackErr) {
      console.error(`[WorkspaceHelper] Fallback also failed:`, fallbackErr.message);
      return null;
    }
  }
}

module.exports = { ensureDefaultWorkspace };
