// The single decision point: "may this actor do this, here, now?"
// Spec: docs/platform/ACCESS-AND-ENTITLEMENTS.md 5 (interface 5.1, order 5.2). Skill: .claude/skills/access-control.
//
//   access.context(req)                 -> frozen ctx, built from what requireAuth + withWorkspace resolved
//   access.decide(ctx, key)             -> Decision, synchronous: steps 1-4 and 7 (no I/O)
//   access.check(ctx, key, opts)        -> Promise<Decision>: decide, then with { entitlements: true } steps 5, 6, 8
//   access.assert(ctx, key, opts)       -> throws AccessError on deny
//   access.middleware(key)              -> express middleware (replaces requirePermission)
//   access.explain(ctx)                 -> everything GET /api/me/access shows
//   access.roleGrants(role, key)        -> the role table alone (no staff bypass, plan or status)
//
// A0 keeps behaviour identical to before (tests/access/characterization.test.js):
//   - routes are guarded by decide() only; the routes' own entitlements calls (blockPublishing, limitProblem) stay
//     where they are until B1, which switches the middleware to check() with entitlements;
//   - steps 5, 6 and 8 read today's services/entitlements.js through services/accessHost.js; every feature is on
//     (no plan has feature values until billing B0/B1);
//   - Radixile staff (platform admins) still pass every role check. Each such pass that the role alone would
//     refuse is logged as legacy_staff_bypass (R1 replaces it with support sessions);
//   - step 9 (rate guard) stays in middleware/rateLimit.js and services/aiQuota.js, unchanged.
// Identity, tenancy, org status and role fail closed. Entitlement reads fail open (allow and log).
const permissions = require('./permissions');
const features = require('./features');
const limits = require('./limits');

let hostOverride = null;
const host = () => hostOverride || require('../../services/accessHost');
const edition = () => (require('../../services/edition').isServer() ? 'server' : 'desktop');

// Categories an organisation suspended by the platform keeps (5.2 step 4)
const SUSPENDED_ALLOWS = new Set(['read', 'export', 'billing', 'account']);
// Categories a lapsed subscription refuses (5.2 step 5)
const LOCKED_REFUSES = new Set(['publish', 'send', 'automate', 'ai', 'create', 'upload']);

class AccessError extends Error {
  constructor(decision) { super(decision.message); this.name = 'AccessError'; this.decision = decision; this.status = decision.http; }
}

const ALLOW = Object.freeze({ allow: true, code: 'ok', message: null, http: 200 });
const deny = (http, code, message, extra = {}) => Object.freeze({ allow: false, code, message, http, ...extra });

// ── Logging (ids only, rate-limited) ─────────────────────────────────────────
const lastLog = new Map();
function logOnce(tag, k, line, everyMs) {
  const now = Date.now();
  if (now - (lastLog.get(k) || 0) < everyMs) return;
  if (lastLog.size > 5000) lastLog.clear();
  lastLog.set(k, now);
  console.log(`[${tag}] ${line}`);
}
function logDeny(ctx, key, d) {
  logOnce('ACCESS_DENY', `d:${ctx.actor.userId}:${key}:${d.code}`,
    `code=${d.code} perm=${key} user=${ctx.actor.userId ?? '-'} org=${ctx.orgId ?? '-'} ws=${ctx.workspaceId ?? '-'}`, 60_000);
}
function logBypass(ctx, key) {
  logOnce('ACCESS', `b:${ctx.actor.userId}:${ctx.workspaceId}:${key}`,
    `legacy_staff_bypass perm=${key} user=${ctx.actor.userId} org=${ctx.orgId ?? '-'} ws=${ctx.workspaceId ?? '-'} role=${ctx.workspaceRole ?? '-'}`, 600_000);
}

// ── Context ──────────────────────────────────────────────────────────────────
function context(req) {
  const user = req.currentUser || null;
  return Object.freeze({
    actor: Object.freeze({
      kind: 'user',
      userId: req.session?.userId ?? null,
      status: user?.status ?? null,
      emailVerified: user ? !!user.email_verified_at : null,
      staff: !!req.isPlatformAdmin, // legacy: platform admin (R1: platform_staff)
    }),
    orgId: req.orgId ?? null,
    orgStatus: req.orgStatus || 'active',
    workspaceId: req.workspaceId ?? null,
    workspaceRole: req.role ?? null,
    edition: edition(),
    requestId: req.id || null,
  });
}

// ── Steps 1-4 and 7 ──────────────────────────────────────────────────────────
function decide(ctx, key) {
  const perm = permissions.get(key);
  if (!perm) throw new Error(`access: unknown permission "${key}" (add it to modules/access/permissions.js)`);

  // 1. Identity
  if (!ctx.actor.userId) return deny(401, 'unauthenticated', 'Not authenticated');
  if (ctx.actor.status === 'suspended') return deny(403, 'suspended', 'Your account has been suspended. Contact the admin.');

  // 2. Edition (no kill switches until B1)
  if (!perm.editions.includes(ctx.edition)) return deny(404, 'notavailable', 'Not available');

  // 3. Tenancy: a workspace permission needs the workspace withWorkspace resolved (membership already checked there)
  if (perm.scope === 'workspace' && !ctx.workspaceId) return deny(404, 'notfound', 'Not found');

  // 4. Org status
  if (ctx.orgStatus === 'suspended' && !SUSPENDED_ALLOWS.has(perm.category)) {
    return deny(403, 'orgsuspended', 'This business is paused by Radixile. Please contact support.');
  }

  // 7. Role
  if (permissions.roleGrants(ctx.workspaceRole, key)) return ALLOW;
  if (ctx.actor.staff) { logBypass(ctx, key); return ALLOW; }
  return deny(403, 'forbidden', 'Forbidden', { requiredPermission: key });
}

// ── Steps 5, 6, 8 through the host adapter (fail open) ───────────────────────
async function entitlementSteps(ctx, perm, { quantity = 1 } = {}) {
  if (ctx.actor.staff) return ALLOW; // legacy: staff are never stopped by a plan (as before A0)
  const h = host();
  // 5. Subscription state
  if (LOCKED_REFUSES.has(perm.category)) {
    try {
      const s = await h.subscription(ctx);
      if (s && s.can_publish === false) {
        return deny(402, 'subscriptionexpired', s.message || 'Your plan isn’t active. Choose a plan to continue.', { state: s.state });
      }
    } catch (e) { logOnce('ACCESS', `e5:${ctx.orgId}`, `subscription read failed (allowed): ${e.message}`, 60_000); }
  }
  // 6. Feature entitlement: every feature is on in A0; only the edition can exclude one
  const need = perm.feature && typeof perm.feature === 'object' ? perm.feature.anyOf : (perm.feature ? [perm.feature] : []);
  if (need.length && !need.some((k) => features.get(k)?.editions.includes(ctx.edition))) {
    return deny(402, 'featurenotinplan', 'Your plan doesn’t include this.', { upgrade: { feature: need[0], planCodes: [] } });
  }
  // 8. Limits (only the ones today's code enforces)
  const lim = perm.limit && limits.get(perm.limit);
  if (lim && lim.enforcedBy === 'entitlements' && ctx.orgId) {
    try {
      const problem = await h.limitProblem(ctx, lim.key, quantity);
      if (problem) return deny(402, 'limitreached', problem, { limit: { key: lim.key, adding: quantity } });
    } catch (e) { logOnce('ACCESS', `e8:${ctx.orgId}:${lim.key}`, `limit read failed (allowed): ${e.message}`, 60_000); }
  }
  return ALLOW;
}

async function check(ctx, key, opts = {}) {
  const d = decide(ctx, key);
  if (!d.allow) { if (d.http !== 401) logDeny(ctx, key, d); return d; }
  if (!opts.entitlements) return d;
  return entitlementSteps(ctx, permissions.get(key), opts);
}

async function assert(ctx, key, opts) {
  const d = await check(ctx, key, opts);
  if (!d.allow) throw new AccessError(d);
  return d;
}

function body(d) {
  if (d.code === 'forbidden') return { error: 'Forbidden', code: d.code, requiredPermission: d.requiredPermission };
  const { allow, http, message, ...rest } = d;
  return { error: message, ...rest };
}

function middleware(key) {
  if (!permissions.get(key)) throw new Error(`access: unknown permission "${key}" (add it to modules/access/permissions.js)`);
  const mw = function accessMiddleware(req, res, next) {
    const ctx = context(req);
    const d = decide(ctx, key);
    if (d.allow) { req.access = ctx; return next(); }
    if (d.http !== 401) logDeny(ctx, key, d);
    return res.status(d.http).json(body(d));
  };
  mw.accessPermission = key; // read by the route inventory (tests/access/routeInventory.test.js)
  return mw;
}

// ── Everything the app may show about access (GET /api/me/access) ────────────
async function explain(ctx) {
  const allowed = permissions.PERMISSIONS
    .filter((p) => p.scope !== 'platform')
    .filter((p) => { try { return decide(ctx, p.key).allow; } catch { return false; } })
    .map((p) => p.key);
  const featureState = Object.fromEntries(features.FEATURES.map((f) => [f.key, f.editions.includes(ctx.edition) ? 'on' : 'off']));
  let subscription = null;
  let limitRows = [];
  try {
    const s = await host().subscription(ctx);
    if (s) {
      subscription = { state: s.state, can_publish: !!s.can_publish, message: s.message || null,
        plan: s.plan || null, plan_name: s.plan_name || null, trial_days_left: s.trial_days_left ?? null };
      limitRows = await Promise.all(limits.LIMITS.filter((l) => l.enforcedBy === 'entitlements').map(async (l) => {
        const value = s.limits?.[l.key];
        let used = null;
        try { used = await host().usage(ctx, l.key); } catch {}
        return { key: l.key, name: l.name, unit: l.unit, limit: value === undefined ? null : value, used };
      }));
    }
  } catch (e) { logOnce('ACCESS', `ex:${ctx.orgId}`, `explain: subscription read failed: ${e.message}`, 60_000); }
  return {
    user: { id: ctx.actor.userId, staff: ctx.actor.staff },
    edition: ctx.edition,
    org: { id: ctx.orgId, status: ctx.orgStatus },
    workspace: { id: ctx.workspaceId, role: ctx.workspaceRole },
    permissions: allowed,
    features: featureState,
    subscription,
    limits: limitRows,
  };
}

module.exports = {
  context, decide, check, assert, middleware, explain, AccessError,
  roleGrants: permissions.roleGrants,
  permissions, features, limits,
  _setHost(h) { hostOverride = h; }, // tests only
};
