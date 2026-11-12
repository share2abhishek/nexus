// What a business may do. One question for every place that publishes, sends or
// automates: "may this workspace's business do that now?"
//
// Desktop app: the answer comes from the install's licence (services/license),
// as before. Server edition (hosted for many businesses): from the business's
// own trial or plan, so one business's plan never affects another's.
//
// The shape matches license.status() so screens and messages work for both:
//   { can_publish, state, message, limits, plan, plan_name, trial_days_left }
const knex = require('./knex');
const edition = require('./edition');

const DAY = 86400;
const GRACE_DAYS = 3; // a late renewal doesn't stop publishing straight away
const now = () => Math.floor(Date.now() / 1000);

// Plans, their limits (-1 = unlimited) and prices. A Radixile admin can override
// them with the "saas_plans" config value; the license-server Razorpay panel is the
// source of truth for what customers are actually charged. Prices are in INR and set
// ~15% below the comparable Zoho Social India tier; yearly = 10x monthly (2 months
// free). price_monthly null = quoted by sales (Enterprise).
const CURRENCY = 'INR';
const DEFAULT_PLANS = {
  trial:      { name: 'Free Trial', limits: { workspaces: 3, users: 5, seo_sites: 1 }, price_monthly: 0, price_yearly: 0 },
  free:       { name: 'Free Starter', limits: { workspaces: 1, users: 2, seo_sites: 1 }, price_monthly: 0, price_yearly: 0 },
  individual: { name: 'Individual / Starter', limits: { workspaces: 3, users: 3, seo_sites: 3 }, price_monthly: 1275, price_yearly: 12750 },
  agency:     { name: 'Agency Pro', limits: { workspaces: 25, users: 10, seo_sites: 10 }, price_monthly: 10200, price_yearly: 102000 },
  full:       { name: 'Enterprise / Unlimited', limits: { workspaces: -1, users: -1, seo_sites: -1 }, price_monthly: null, price_yearly: null },
};

let plansCache = { at: 0, plans: DEFAULT_PLANS };
async function plans(fresh = false) {
  if (!fresh && Date.now() - plansCache.at < 60000) return plansCache.plans;
  let custom = null;
  try { custom = JSON.parse((await require('../repos/configRepo')(knex).get('saas_plans')) || 'null'); } catch {}
  plansCache = { at: Date.now(), plans: custom && typeof custom === 'object' ? { ...DEFAULT_PLANS, ...custom } : DEFAULT_PLANS };
  return plansCache.plans;
}

function decide(org, plan) {
  const t = now();
  const base = { plan: org.plan, plan_name: plan?.name || org.plan, limits: plan?.limits || {}, org_id: org.id, business: org.name };
  if (org.plan_status === 'suspended') {
    return { ...base, can_publish: false, state: 'invalid', message: `${org.name} is paused by Radixile. Please contact support.` };
  }
  if (org.plan === 'trial') {
    const left = org.trial_ends_at ? Math.ceil((org.trial_ends_at - t) / DAY) : 0;
    if (left > 0) return { ...base, can_publish: true, state: 'active', trial_days_left: left, message: null };
    return { ...base, can_publish: false, state: 'expired', trial_days_left: 0, message: `The free trial for ${org.name} has ended. Choose a plan to keep publishing; your posts and settings are kept.` };
  }
  if (!plan) {
    return { ...base, can_publish: false, state: 'unlicensed', message: `${org.name} has no plan yet. Choose a plan to start publishing.` };
  }
  const graceEnd = (org.paid_until || 0) + GRACE_DAYS * DAY;
  const daysLeft = (until) => Math.max(1, Math.ceil((until - t) / DAY));
  // Paying (or a payment just failed: a few days' grace)
  if ((org.plan_status === 'active' && (!org.paid_until || graceEnd > t)) || (org.plan_status === 'past_due' && org.paid_until && graceEnd > t)) {
    let message = null;
    if (org.plan_status === 'past_due') message = `The last payment for the ${base.plan_name} plan didn’t go through. Update your payment method within ${daysLeft(graceEnd)} days to keep publishing.`;
    else if (org.paid_until && org.paid_until < t) message = `The ${base.plan_name} plan payment is overdue: renew within ${daysLeft(graceEnd)} days to keep publishing.`;
    return { ...base, can_publish: true, state: 'active', message };
  }
  // Cancelled: works until the end of the period already paid for
  if (org.plan_status === 'cancelled' && org.paid_until && org.paid_until > t) {
    const until = new Date(org.paid_until * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
    return { ...base, can_publish: true, state: 'active', ends_at: org.paid_until, message: `The ${base.plan_name} plan is cancelled and ends on ${until}. Choose a plan again any time to keep publishing after that.` };
  }
  return {
    ...base, can_publish: false, state: 'expired',
    message: org.plan_status === 'cancelled'
      ? `The ${base.plan_name} plan for ${org.name} was cancelled. Choose a plan to keep publishing; your posts and settings are kept.`
      : `The ${base.plan_name} plan for ${org.name} isn’t paid up. Renew to keep publishing; your posts and settings are kept.`,
  };
}

// ── Lookups (cached for 30 seconds; cleared when a plan changes) ────────────
const cache = new Map(); // org id -> { at, value }
const TTL = 30000;

async function forOrg(orgId, forceOrgEvaluation = false) {
  if (!edition.isServer() && !forceOrgEvaluation) return require('./license').status();
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const org = await knex('organizations').where({ id: orgId }).first();
  if (!org) return { can_publish: false, state: 'invalid', message: 'This business no longer exists.', limits: {} };
  const value = decide(org, (await plans())[org.plan]);
  cache.set(orgId, { at: Date.now(), value });
  return value;
}

async function forWorkspace(workspaceId) {
  if (!edition.isServer()) return require('./license').status();
  const ws = workspaceId ? await knex('workspaces').where({ id: workspaceId }).first('org_id') : null;
  if (!ws) return { can_publish: false, state: 'invalid', message: 'Workspace not found.', limits: {} };
  return forOrg(ws.org_id);
}

async function canPublish(workspaceId) {
  try { return !!(await forWorkspace(workspaceId)).can_publish; } catch { return false; }
}

function forget(orgId) { if (orgId == null) cache.clear(); else cache.delete(orgId); }

// ── Limits ──────────────────────────────────────────────────────────────────
const WHAT = { workspaces: 'brand/client workspaces', users: 'team members', seo_sites: 'websites in the SEO autopilot' };

// How many the business uses now
async function usage(orgId, name) {
  const count = async (q) => Number((await q.count('* as c').first())?.c || 0);
  if (name === 'workspaces') return count(knex('workspaces').where({ org_id: orgId }));
  if (name === 'users') {
    return count(knex.from(knex('memberships as m').join('workspaces as w', 'w.id', 'm.workspace_id').where('w.org_id', orgId).distinct('m.user_id').as('u')));
  }
  if (name === 'seo_sites') {
    return count(knex('seo_sites as s').join('workspaces as w', 'w.id', 's.workspace_id').where('w.org_id', orgId));
  }
  return 0;
}

// null when allowed, else a message for the person
async function limitProblem(workspaceId, name, { adding = 1 } = {}) {
  if (!edition.isServer()) {
    const { withinLimit, limitMessage } = require('../middleware/license');
    const current = name === 'workspaces' ? Number((await knex('workspaces').count('id as c').first())?.c || 0) : 0;
    return withinLimit(name, current) ? null : limitMessage(name);
  }
  const ws = await knex('workspaces').where({ id: workspaceId }).first('org_id');
  if (!ws) return null;
  return limitProblemForOrg(ws.org_id, name, { adding });
}

async function limitProblemForOrg(orgId, name, { adding = 1 } = {}) {
  if (!edition.isServer()) return null;
  const s = await forOrg(orgId);
  const limit = s.limits?.[name];
  if (limit === undefined || limit === -1) return null;
  const used = await usage(orgId, name);
  if (used + adding <= limit) return null;
  return `The ${s.plan_name} plan includes ${limit} ${WHAT[name] || name}${s.plan === 'trial' ? ' during the trial' : ''}. Choose a bigger plan to add more.`;
}

// For a route: answers 402 with the reason and returns true when publishing isn't allowed
// note: an extra sentence, e.g. 'Your post is saved as a draft.'
async function blockPublishing(req, res, what = 'Publishing and scheduling', note = '') {
  const s = await forWorkspace(req.workspaceId);
  if (s.can_publish) return false;
  const hint = edition.isServer() ? '' : ' Go to Settings → Licence to activate.';
  const why = s.message ? `${s.message}${hint}` : `${what} need an active licence.${hint}`;
  res.status(402).json({ error: note ? `${why} ${note}` : why, code: 'LICENSE_REQUIRED', license_state: s.state });
  return true;
}

module.exports = { forOrg, forWorkspace, canPublish, limitProblem, limitProblemForOrg, usage, blockPublishing, forget, plans, decide, DEFAULT_PLANS, CURRENCY, GRACE_DAYS };
