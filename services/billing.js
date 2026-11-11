// Server edition: paying for a business's plan online.
//
// Radixile's billing service (the licence server, license.radixile.com) sells the
// plans through Razorpay and keeps each business's subscription. This app asks it
// for plans, starts checkouts, cancels, lists invoices, and copies the result onto
// the business (organizations.plan, plan_status, paid_until), which
// services/entitlements.js reads. Every request is signed with BILLING_SECRET
// (the same value as SAAS_APP_SECRET on the billing service).
//
// Settings (.env): BILLING_URL, BILLING_SECRET, BILLING_APP_ID (default "nexus"),
// APP_URL (where customers come back to after paying).
const crypto = require('crypto');
const axios = require('axios');
const knex = require('./knex');
const edition = require('./edition');

const nowSec = () => Math.floor(Date.now() / 1000);
const MAX_SKEW = 300;

const config = () => ({
  url: (process.env.BILLING_URL || '').replace(/\/$/, ''),
  secret: process.env.BILLING_SECRET || '',
  appId: process.env.BILLING_APP_ID || 'nexus',
});
const configured = () => edition.isServer() && !!(config().url && config().secret);

function sign(secret, time, method, urlPath, body) {
  return crypto.createHmac('sha256', secret).update(`${time}.${method.toUpperCase()}.${urlPath}.${body || ''}`).digest('hex');
}
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

class BillingError extends Error {
  constructor(message, status = 502, code = 'BILLING_ERROR') { super(message); this.status = status; this.code = code; }
}

async function call(method, urlPath, body) {
  const { url, secret } = config();
  if (!configured()) throw new BillingError('Online payment isn’t set up yet. Write to info@radixile.com to choose a plan.', 503, 'NOT_CONFIGURED');
  const raw = body ? JSON.stringify(body) : '';
  const time = nowSec();
  try {
    const { data } = await axios({
      method, url: `${url}${urlPath}`, data: raw || undefined, timeout: 20000,
      headers: { 'Content-Type': 'application/json', 'X-SNX-Time': String(time), 'X-SNX-Signature': sign(secret, time, method, urlPath, raw) },
      transformRequest: [(d) => d], // send exactly the bytes that were signed
    });
    return data;
  } catch (err) {
    const d = err.response?.data;
    if (d?.error) throw new BillingError(d.error, err.response.status === 409 ? 409 : err.response.status >= 500 ? 502 : 400, d.code || 'BILLING_ERROR');
    throw new BillingError('The payment service couldn’t be reached. Please try again in a minute.');
  }
}

const orgRef = (orgId) => `${config().appId}:${orgId}`;
function orgIdFromRef(ref) {
  const m = /^([a-z0-9_-]+):(\d+)$/i.exec(String(ref || ''));
  return m && m[1] === config().appId ? Number(m[2]) : null;
}

// ── Plans (cached; their limits are what the app enforces) ──────────────────
let plansCache = { at: 0, value: null };
async function plans(fresh = false) {
  if (!fresh && plansCache.value && Date.now() - plansCache.at < 5 * 60 * 1000) return plansCache.value;
  const data = await call('GET', '/v1/saas/plans');
  const value = { plans: data.plans || [], mode: data.mode, states: data.states || {} };
  plansCache = { at: Date.now(), value };
  await syncLimits(value.plans).catch((err) => console.error('[Billing] Could not save plan limits:', err.message));
  return value;
}

// The limits edited in the billing service's admin panel become the app's plans
async function syncLimits(list) {
  const keep = ['workspaces', 'users', 'seo_sites'];
  const out = {};
  for (const p of list) {
    if (out[p.plan_code]) continue;
    const limits = {};
    for (const k of keep) if (p.limits?.[k] !== undefined) limits[k] = p.limits[k];
    out[p.plan_code] = { name: p.plan_name, limits };
  }
  if (!Object.keys(out).length) return;
  const configRepo = require('../repos/configRepo')(knex);
  let current = {};
  try { current = JSON.parse((await configRepo.get('saas_plans')) || '{}') || {}; } catch {}
  const merged = { ...current, ...out };
  if (JSON.stringify(merged) !== JSON.stringify(current)) {
    await configRepo.set('saas_plans', JSON.stringify(merged));
    await require('./entitlements').plans(true);
    require('./entitlements').forget();
  }
}

// ── A business's subscription ───────────────────────────────────────────────
// Copies the billing service's answer onto the business. A business Radixile
// paused stays paused; a business that never paid keeps its trial.
async function apply(orgId, s) {
  if (!orgId || !s || !s.status || s.status === 'none' || s.status === 'pending') return false;
  const org = await knex('organizations').where({ id: orgId }).first();
  if (!org || org.plan_status === 'suspended') return false;
  const status = { active: 'active', past_due: 'past_due', cancelled: 'cancelled', completed: 'cancelled' }[s.status];
  if (!status) return false;
  const update = { plan_status: status, paid_until: s.paid_until || null };
  if (s.plan_code) update.plan = s.plan_code;
  await knex('organizations').where({ id: orgId }).update(update);
  require('./entitlements').forget(orgId);
  return true;
}

async function status(orgId) {
  const s = await call('GET', `/v1/saas/status?org_ref=${encodeURIComponent(orgRef(orgId))}`);
  await apply(orgId, s);
  return s;
}

async function invoices(orgId) {
  return (await call('GET', `/v1/saas/invoices?org_ref=${encodeURIComponent(orgRef(orgId))}`)).invoices || [];
}

async function checkout(orgId, details) {
  // Customers come back to the service's own public address, never one taken from the request
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(appUrl)) throw new BillingError('Online payment isn’t set up yet (APP_URL is missing). Write to info@radixile.com to choose a plan.', 503, 'NOT_CONFIGURED');
  const r = await call('POST', '/v1/saas/checkout', {
    org_ref: orgRef(orgId), product_code: details.product_code, email: details.email, name: details.name,
    company: details.company, gstin: details.gstin, state_code: details.state_code, address: details.address,
    return_url: `${appUrl}/billing/return`,
  });
  await knex('organizations').where({ id: orgId }).update({ billing_checkout_at: nowSec() });
  return { pay_url: r.pay_url };
}

async function cancel(orgId, byEmail) {
  const s = await call('POST', '/v1/saas/cancel', { org_ref: orgRef(orgId), by: byEmail });
  await apply(orgId, s);
  return s;
}

// ── Notices from the billing service ────────────────────────────────────────
// rawBody: the exact bytes received; returns the business id updated, or null
async function handleWebhook(req) {
  const { secret } = config();
  if (!secret) throw new BillingError('Not set up', 503, 'NOT_CONFIGURED');
  const time = Number(req.get('x-snx-time'));
  const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
  if (!Number.isFinite(time) || Math.abs(nowSec() - time) > MAX_SKEW || !raw) throw new BillingError('Bad signature', 401, 'BAD_SIGNATURE');
  if (!safeEqual(sign(secret, time, 'POST', req.originalUrl.split('?')[0], raw), req.get('x-snx-signature') || '')) throw new BillingError('Bad signature', 401, 'BAD_SIGNATURE');
  const s = JSON.parse(raw);
  const orgId = orgIdFromRef(s.org_ref);
  if (!orgId) return null;
  await apply(orgId, s);
  return orgId;
}

// In case a notice was missed: re-read every paying business now and then
async function syncAll() {
  if (!configured()) return 0;
  // Paying businesses, and any that started paying in the last week (in case the "paid" notice was missed)
  const orgs = await knex('organizations')
    .where((q) => q.whereIn('plan_status', ['active', 'past_due', 'cancelled']).orWhere('billing_checkout_at', '>', nowSec() - 7 * 86400))
    .select('id');
  let n = 0;
  for (const o of orgs) {
    try { await status(o.id); n++; } catch (err) { console.error(`[Billing] Could not refresh business ${o.id}:`, err.message); }
  }
  return n;
}

let timer = null;
function start() {
  if (!configured() || timer) return;
  const run = () => syncAll().catch((err) => console.error('[Billing] Refresh failed:', err.message));
  setTimeout(run, 60 * 1000).unref?.();
  timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref?.();
}

module.exports = { configured, plans, status, invoices, checkout, cancel, apply, handleWebhook, syncAll, start, orgRef, orgIdFromRef, sign, BillingError };
