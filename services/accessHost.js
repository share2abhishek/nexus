// Host glue for modules/access (A0): the database lookups the engine needs, so modules/access stays data and rules.
// Steps 5 and 8 read TODAY's services/entitlements.js (its own 30 s cache) until billing B1 replaces it.
const knex = require('./knex');

// A workspace's organisation and its platform status (5.2 step 4). Cached 5 s, like user status: a suspension
// takes effect almost at once. A workspace without an organisation (desktop) counts as active.
const TTL = 5000;
const orgCache = new Map();
async function workspaceOrg(workspaceId) {
  if (!workspaceId) return { orgId: null, status: 'active' };
  const hit = orgCache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const row = await knex('workspaces as w').leftJoin('organizations as o', 'o.id', 'w.org_id')
    .where('w.id', workspaceId).first('w.org_id', 'o.status');
  const value = { orgId: row?.org_id ?? null, status: row?.status || 'active' };
  orgCache.set(workspaceId, { at: Date.now(), value });
  if (orgCache.size > 5000) orgCache.clear();
  return value;
}
function forgetOrg(workspaceId) { if (workspaceId == null) orgCache.clear(); else orgCache.delete(workspaceId); }

const ent = () => require('./entitlements');

// { can_publish, state, message, limits, plan, plan_name, trial_days_left } (desktop: the install's licence)
async function subscription(ctx) {
  if (ctx.edition !== 'server') return ent().forWorkspace(ctx.workspaceId);
  if (!ctx.orgId) return null;
  return ent().forOrg(ctx.orgId);
}

async function usage(ctx, key) {
  if (!ctx.orgId || ctx.edition !== 'server') return null;
  return ent().usage(ctx.orgId, key);
}

// null when allowed, else the customer message
async function limitProblem(ctx, key, adding = 1) {
  if (ctx.edition !== 'server') return ent().limitProblem(ctx.workspaceId, key, { adding });
  return ent().limitProblemForOrg(ctx.orgId, key, { adding });
}

module.exports = { workspaceOrg, forgetOrg, subscription, usage, limitProblem };
