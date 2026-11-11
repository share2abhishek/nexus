// Server edition: paying for the business's plan online (services/billing.js).
//
//   GET  /api/billing           plans, current subscription and invoices
//   POST /api/billing/checkout  start paying for a plan → { pay_url }   (owner)
//   POST /api/billing/cancel    cancel at the end of the paid period    (owner)
//   POST /billing/webhook       notices from the billing service (signed)
//   GET  /billing/return        where customers land after paying
const express = require('express');
const knex = require('../services/knex');
const billing = require('../services/billing');
const edition = require('../services/edition');

// The business of the workspace being used, and whether this person may pay for it
async function businessOf(req) {
  const ws = req.workspaceId ? await knex('workspaces').where({ id: req.workspaceId }).first('org_id') : null;
  if (!ws) return null;
  const org = await knex('organizations').where({ id: ws.org_id }).first();
  const user = await knex('users').where({ id: req.session.userId }).first('id', 'email', 'name', 'role');
  const member = await knex('org_members').where({ org_id: org.id, user_id: user.id }).first('role');
  // The owner, or Radixile staff (platform admins are known by their email)
  const staff = user.role === 'admin' && require('../services/accounts').isPlatformAdminEmail(user.email);
  return { org, user, canManage: member?.role === 'owner' || staff };
}

function fail(res, err) {
  if (err instanceof billing.BillingError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error('[Billing]', err.message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

const api = express.Router();
api.use((req, res, next) => (edition.isServer() ? next() : res.status(404).json({ error: 'Only in the hosted edition.' })));

api.get('/', async (req, res) => {
  try {
    const b = await businessOf(req);
    if (!b) return res.status(400).json({ error: 'Open a workspace of your business first.' });
    const out = { configured: billing.configured(), can_manage: b.canManage, business: b.org.name, email: b.user.email, name: b.user.name || '' };
    if (!out.configured) return res.json(out);
    const [plans, status, invoices] = await Promise.all([
      billing.plans().catch((err) => ({ error: err.message })),
      billing.status(b.org.id).catch((err) => ({ error: err.message })),
      b.canManage ? billing.invoices(b.org.id).catch(() => []) : Promise.resolve([]),
    ]);
    res.json({ ...out, plans: plans.plans || [], states: plans.states || {}, mode: plans.mode, plans_error: plans.error || null, subscription: status, invoices });
  } catch (err) { fail(res, err); }
});

api.post('/checkout', async (req, res) => {
  try {
    const b = await businessOf(req);
    if (!b) return res.status(400).json({ error: 'Open a workspace of your business first.' });
    if (!b.canManage) return res.status(403).json({ error: 'Only the owner of the business can choose and pay for a plan.' });
    const body = req.body || {};
    const r = await billing.checkout(b.org.id, {
      product_code: String(body.product_code || ''), email: body.email || b.user.email, name: body.name || b.user.name || '',
      company: body.company || b.org.name, gstin: body.gstin || '', state_code: String(body.state_code || ''), address: body.address || '',
    });
    res.json(r);
  } catch (err) { fail(res, err); }
});

api.post('/cancel', async (req, res) => {
  try {
    const b = await businessOf(req);
    if (!b) return res.status(400).json({ error: 'Open a workspace of your business first.' });
    if (!b.canManage) return res.status(403).json({ error: 'Only the owner of the business can cancel the plan.' });
    res.json({ subscription: await billing.cancel(b.org.id, b.user.email) });
  } catch (err) { fail(res, err); }
});

// ── Public: notices from the billing service, and the way back after paying ──
const pub = express.Router();

pub.post('/webhook', async (req, res) => {
  try {
    const orgId = await billing.handleWebhook(req);
    res.json({ ok: true, updated: !!orgId });
  } catch (err) {
    if (err instanceof billing.BillingError) return res.status(err.status).json({ ok: false });
    console.error('[Billing] webhook:', err.message);
    res.status(500).json({ ok: false }); // the billing service will be asked again by the next refresh
  }
});

pub.get('/return', async (req, res) => {
  // Re-read the plan straight away so the screen shows it as paid
  try {
    if (req.session?.userId && billing.configured()) {
      // Every business this person owns or belongs to (they may have paid for any of them)
      const own = await knex('org_members').where({ user_id: req.session.userId }).pluck('org_id');
      const viaWs = await knex('memberships as m').join('workspaces as w', 'w.id', 'm.workspace_id').where('m.user_id', req.session.userId).pluck('w.org_id');
      for (const id of [...new Set([...own, ...viaWs])].slice(0, 20)) await billing.status(id).catch(() => {});
    }
  } catch {}
  res.redirect('/?billing=done');
});

module.exports = { api, pub };
