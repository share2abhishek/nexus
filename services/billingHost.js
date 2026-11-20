// Nexus's side of the billing module's ports (modules/billing/ports/index.js; PLAN N6).
// The only place that knows both Nexus tables and the billing module.
const knex = require('./knex');
const edition = require('./edition');

const now = () => Math.floor(Date.now() / 1000);
const istToday = () => new Date(Date.now() + 19800 * 1000).toISOString().slice(0, 10);

// BILLING_TODAY (YYYY-MM-DD) moves "today" for QA, on staging and in tests only, never on production
function todayIST() {
  const o = process.env.BILLING_TODAY;
  const allowed = process.env.NEXUS_ENV === 'staging' || process.env.NODE_ENV === 'test';
  if (allowed && /^\d{4}-\d{2}-\d{2}$/.test(o || '')) return o;
  return istToday();
}

// Today's plans (services/entitlements.js DEFAULT_PLANS) as the seed. rank orders "higher plan";
// public = on the price list (trial and free are not bought).
const RANK = { free: 10, trial: 20, individual: 30, agency: 40, full: 50 };
const PUBLIC = new Set(['individual', 'agency', 'full']);

function defaults() {
  const { DEFAULT_PLANS } = require('./entitlements');
  const { FEATURES } = require('../modules/access/features');
  const { LIMITS } = require('../modules/access/limits');
  return {
    plans: Object.entries(DEFAULT_PLANS).map(([code, p]) => ({
      code, name: p.name, rank: RANK[code] ?? 100, public: PUBLIC.has(code), limits: { ...p.limits },
      price_monthly_minor: p.price_monthly == null ? null : Math.round(p.price_monthly * 100),
    })),
    features: FEATURES.map((f) => ({ key: f.key, name: f.name, module: f.module, requires: [...f.requires], requiresAny: [...f.requiresAny] })),
    limits: LIMITS.map((l) => ({ key: l.key, name: l.name, unit: l.unit, type: l.type })),
  };
}

// A plan's feature set must be possible: everything a ticked feature needs is ticked too
function checkFeatures(enabledKeys) {
  const { BY_KEY } = require('../modules/access/features');
  const on = new Set(enabledKeys);
  const name = (k) => BY_KEY[k]?.name || k;
  const problems = [];
  for (const k of on) {
    const f = BY_KEY[k];
    if (!f) continue;
    for (const r of f.requires) if (!on.has(r)) problems.push(`“${name(k)}” needs “${name(r)}”.`);
    if (f.requiresAny.length && !f.requiresAny.some((r) => on.has(r))) problems.push(`“${name(k)}” needs one of: ${f.requiresAny.map((r) => `“${name(r)}”`).join(', ')}.`);
  }
  return problems;
}

const count = async (q) => Number((await q.count('* as c').first())?.c || 0);

const ports = {
  host: {
    isServer: () => edition.isServer(),
    enabled: () => String(process.env.BILLING_ENABLED || '').toLowerCase() === 'true',
  },
  clock: { now, todayIST },
  accounts: {
    getAccount: async (id) => (await knex('organizations').where({ id }).first('id', 'name')) || null,
    listAccounts: () => knex('organizations').orderBy('id').select('id', 'name', 'created_at'),
    countSeatUnits: (accountId) => count(knex('workspaces').where({ org_id: accountId })), // default D3: workspaces
    // Today the plan lives on organizations.plan (the mirror); billing B1 makes bill_subscription the source
    countOnPlan: (code) => count(knex('organizations').where({ plan: code })),
    actorOf: async (userId) => {
      if (!userId) return 'system';
      const u = await knex('users').where({ id: userId }).first('email');
      return u?.email ? `${u.email} (#${userId})` : `user #${userId}`;
    },
  },
  catalogue: {
    defaults,
    checkFeatures,
    importState: async (accountId) => (await knex('organizations').where({ id: accountId }).first('plan', 'plan_status', 'trial_ends_at', 'paid_until')) || null,
  },
};

let instance = null;
// The billing module bound to Nexus (one per process)
function billing() {
  if (!instance) instance = require('../modules/billing').init({ knex, ports });
  return instance;
}

module.exports = { ports, billing, defaults, checkFeatures, todayIST };
