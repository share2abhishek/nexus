const knex = require('./knex');

// Several requests fire at once on page load (status, workspaces, tenancy middleware),
// and each used to see "no membership yet" and create its own default workspace.
// Single-flight per user: concurrent callers share one creation.
const inFlight = new Map();

async function ensureDefaultWorkspace(userId) {
  if (!userId) return null;
  if (inFlight.has(userId)) return inFlight.get(userId);

  const run = (async () => {
    const existing = await knex('memberships').where({ user_id: userId }).first();
    if (existing) return existing.workspace_id;

    const user = await knex('users').where({ id: userId }).first();
    if (!user) return null;

    const displayName = user.name || user.email.split('@')[0];
    const baseSlug = `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my'}-workspace`;

    try {
      return await createDefault(userId, displayName, baseSlug);
    } catch (err) {
      // Most likely a slug clash with another user's workspace — retry with a suffix
      console.error(`[WorkspaceHelper] Default workspace for user ${userId} failed:`, err.message);
      try {
        return await createDefault(userId, displayName, `${baseSlug}-${Date.now().toString(36)}`);
      } catch (fallbackErr) {
        console.error('[WorkspaceHelper] Fallback also failed:', fallbackErr.message);
        return null;
      }
    }
  })();

  inFlight.set(userId, run);
  try {
    return await run;
  } finally {
    inFlight.delete(userId);
  }
}

function createDefault(userId, displayName, slug) {
  return knex.transaction(async (trx) => {
    // Re-check inside the transaction in case another process created it meanwhile
    const existing = await trx('memberships').where({ user_id: userId }).first();
    if (existing) return existing.workspace_id;

    const orgRows = await trx('organizations')
      .insert({ name: `${displayName}'s Org`, owner_user_id: userId, plan: 'free' })
      .returning('id');
    const orgId = orgRows[0]?.id ?? orgRows[0];
    await trx('org_members').insert({ org_id: orgId, user_id: userId, role: 'owner' }).onConflict(['org_id', 'user_id']).ignore();

    // India is the target market — default to IST rather than UTC
    const wsRows = await trx('workspaces')
      .insert({ org_id: orgId, name: `${displayName}'s Workspace`, slug, timezone: 'Asia/Kolkata' })
      .returning('id');
    const wsId = wsRows[0]?.id ?? wsRows[0];

    await trx('memberships').insert({ user_id: userId, workspace_id: wsId, role: 'manager' }).onConflict(['user_id', 'workspace_id']).ignore();
    return wsId;
  });
}

module.exports = { ensureDefaultWorkspace };
