// Staff billing routes (docs/billing/REQUIREMENTS.md 7.2), B0 part: catalogue, price book, tax, coupons, quote
// preview, subscription import preview. Mounted by the host behind its staff check (Nexus: access.middleware
// 'platform.billing.manage'). Answers 404 for everything while billing is off or on the desktop edition.
// Errors: { error, code, field? } with the HTTP status (codes in REQUIREMENTS 7.3).
const express = require('express');
const { BillingError } = require('../domain/errors');

function makeAdminRouter({ svc, ports, ready }) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  router.use((req, res, next) => {
    if (!ports.host.isServer() || !ports.host.enabled()) return res.status(404).json({ error: 'Not found', code: 'notfound' });
    return ready().then(() => next(), next);
  });

  const actor = (req) => ports.accounts.actorOf(req.session?.userId);
  const reasonOf = (req) => (req.body && typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 500) : null) || null;
  const h = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, await actor(req))); } catch (e) { next(e); }
  };

  router.get('/status', h(async () => ({ enabled: true, today: ports.clock.todayIST(), plans: (await svc.catalogue.listPlans()).length })));
  router.get('/catalogue', h(async () => {
    const d = ports.catalogue.defaults();
    return { features: d.features, limits: d.limits };
  }));

  // Plans
  router.get('/plans', h(() => svc.catalogue.listPlans()));
  router.post('/plans', h((req, who) => svc.catalogue.createPlan(who, req.body || {}, reasonOf(req))));
  router.get('/plans/:code', h((req) => svc.catalogue.getPlan(req.params.code)));
  router.put('/plans/:code', h((req, who) => svc.catalogue.updatePlan(who, req.params.code, req.body || {}, reasonOf(req))));
  router.post('/plans/:code/clone', h((req, who) => svc.catalogue.clonePlan(who, req.params.code, req.body || {}, reasonOf(req))));
  router.get('/plans/:code/revisions', h((req) => svc.catalogue.revisions(req.params.code)));

  // Price book, cycle discounts, tax rates
  router.get('/price-book', h((req) => svc.catalogue.listPrices(typeof req.query.plan === 'string' ? req.query.plan : null)));
  router.post('/price-book', h((req, who) => svc.catalogue.addPrice(who, req.body || {})));
  router.get('/cycle-discounts', h(() => svc.catalogue.listCycleDiscounts()));
  router.put('/cycle-discounts/:cycle', h((req, who) => svc.catalogue.setCycleDiscount(who, req.params.cycle, req.body?.discount_hundredths, reasonOf(req))));
  router.get('/tax-rates', h(() => svc.catalogue.listTaxRates()));
  router.post('/tax-rates', h((req, who) => svc.catalogue.addTaxRate(who, req.body || {}, reasonOf(req))));

  // Coupons
  router.get('/coupons', h(() => svc.catalogue.listCoupons()));
  router.post('/coupons', h((req, who) => svc.catalogue.createCoupon(who, req.body || {})));
  router.put('/coupons/:id', h((req, who) => svc.catalogue.updateCoupon(who, Number(req.params.id), req.body || {})));

  // What a period would cost (nothing stored)
  router.post('/quote', h((req) => svc.catalogue.previewQuote(req.body || {})));

  // Subscriptions: the import preview only (apply runs from the command line: scripts/billing-import-subscriptions.js)
  router.get('/import/preview', h(() => svc.importer.preview()));
  router.get('/subscriptions', h(() => svc.importer.list()));

  router.get('/audit', h((req) => svc.audit.list({
    entity: typeof req.query.entity === 'string' ? req.query.entity : undefined,
    entityId: typeof req.query.entity_id === 'string' ? req.query.entity_id : undefined,
    limit: Number(req.query.limit) || 100,
  })));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof BillingError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.field && { field: err.field }) });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.', code: 'invalidjson' });
    console.error('[BILLING] admin route failed:', err && err.message);
    return res.status(500).json({ error: 'Something went wrong. Nothing was changed.', code: 'internal' });
  });

  return router;
}

module.exports = { makeAdminRouter };
