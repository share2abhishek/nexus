// /api/license — licence status for everyone; activate/deactivate for admins.
const express = require('express');
const router = express.Router();
const license = require('../services/license');
const knex = require('../services/knex');

async function requireAdmin(req, res, next) {
  const user = await knex('users').where({ id: req.session?.userId }).first();
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Only the admin of this installation can change the licence.' });
  next();
}

function fail(res, err) {
  const status = err.code === 'NETWORK' ? 503 : err.code === 'SEATS_FULL' ? 409 : 400;
  res.status(status).json({ error: err.message, code: err.code || 'ERROR', devices: err.extra?.devices });
}

router.get('/', async (req, res) => {
  res.json(license.status());
});

router.post('/activate', requireAdmin, async (req, res) => {
  const { key, coupon, email, name, device_name } = req.body || {};
  const code = String(key || coupon || '').trim();
  if (!code) return res.status(400).json({ error: 'Enter your licence key or coupon code.' });
  // One box for both: coupons look like SNX-XXXX-XXXX, keys like SNXP-/SNXS-…
  const isCoupon = coupon || /^SNX-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(code);
  try {
    res.json(await license.activate({ key: isCoupon ? undefined : code, coupon: isCoupon ? code : undefined, email, name, deviceName: device_name }));
  } catch (err) { fail(res, err); }
});

router.post('/refresh', requireAdmin, async (req, res) => {
  try { res.json(await license.refresh({ force: true })); } catch (err) { fail(res, err); }
});

router.post('/deactivate', requireAdmin, async (req, res) => {
  try { res.json(await license.deactivate()); } catch (err) { fail(res, err); }
});

// Offline activation: download a request file / import the licence file
router.post('/offline-request', requireAdmin, async (req, res) => {
  const { key, device_name } = req.body || {};
  if (!/^SNX[PS]-/i.test(String(key || '').trim())) return res.status(400).json({ error: 'Enter your licence key (coupons need an internet connection).' });
  try {
    const request = await license.offlineRequest({ key, deviceName: device_name });
    res.set('Content-Disposition', 'attachment; filename="activation.snreq"');
    res.json(request);
  } catch (err) { fail(res, err); }
});

router.post('/import', requireAdmin, express.json({ limit: '50kb' }), async (req, res) => {
  try { res.json(await license.importLicense(req.body?.content ?? req.body)); } catch (err) { fail(res, err); }
});

module.exports = router;
