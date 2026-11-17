// API Routes: Meta Reports (ad account balance and reports, WhatsApp analytics).
// Everything is scoped to req.workspaceId and uses that workspace's own Meta token.
const express = require('express');
const metaReports = require('../services/metaReports');

module.exports = (knex, requirePermission) => {
  const router = express.Router();

  // The workspace's own Facebook connection and WhatsApp settings; nothing shared
  async function context(workspaceId) {
    const fb = await knex('social_accounts')
      .where({ workspace_id: workspaceId, platform: 'facebook' })
      .orderBy('id', 'desc').first();
    const cfg = await knex('meta_lead_configs').where({ workspace_id: workspaceId }).first();
    let adIds = [];
    try { adIds = JSON.parse(cfg?.meta_ad_account_ids || '[]'); } catch { adIds = []; }
    return {
      fbToken: fb?.access_token || null,
      fbConnected: !!fb,
      hasConfig: !!cfg,
      waToken: cfg?.whatsapp_access_token || null,
      wabaId: cfg?.whatsapp_business_account_id || null,
      phoneNumberId: cfg?.whatsapp_phone_number_id || null,
      adIds: Array.isArray(adIds) ? adIds.filter(x => /^act_\d+$/.test(String(x))) : [],
    };
  }

  const fail = (res, err) => {
    const status = err.code === 'bad_range' ? 400 : err.code === 'rate_limited' ? 429 : 502;
    res.status(status).json({ error: err.message, code: err.code || 'error' });
  };
  // Any error becomes a clear JSON answer instead of a hung request
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => fail(res, e));
  const needFacebook = res => res.status(400).json({ error: 'Connect Facebook first (Settings → Connected accounts).', code: 'not_connected' });

  // GET /status — what is connected, which permissions are missing, and how to add them
  router.get('/status', requirePermission('content.view'), wrap(async (req, res) => {
    const c = await context(req.workspaceId);
    const out = {
      guide: metaReports.GUIDE,
      ads: { connected: c.fbConnected, permission: 'ads_read', granted: null, selected: c.adIds, error: null },
      whatsapp: {
        connected: !!(c.waToken && c.wabaId),
        permission: 'whatsapp_business_management',
        has_token: !!c.waToken, has_waba_id: !!c.wabaId, has_phone_number_id: !!c.phoneNumberId,
        granted: null, error: null,
      },
    };
    if (c.fbToken) {
      try {
        const perms = await metaReports.grantedPermissions(c.fbToken);
        out.ads.granted = perms.includes('ads_read');
      } catch (e) { out.ads.error = { code: e.code, message: e.message }; }
    }
    if (c.waToken && c.wabaId) {
      try {
        await metaReports.checkWhatsApp(c.waToken, c.wabaId);
        out.whatsapp.granted = true;
      } catch (e) {
        out.whatsapp.granted = e.code === 'missing_permission' || e.code === 'token_expired' ? false : null;
        out.whatsapp.error = { code: e.code, message: e.message };
      }
    }
    res.json(out);
  }));

  // GET /ad-accounts — the ad accounts this Facebook connection can see
  router.get('/ad-accounts', requirePermission('content.view'), wrap(async (req, res) => {
    const c = await context(req.workspaceId);
    if (!c.fbToken) return needFacebook(res);
    const accounts = await metaReports.cached(req.workspaceId, 'adaccounts', req.query.refresh === '1', () => metaReports.listAdAccounts(c.fbToken));
    res.json({ accounts, selected: c.adIds });
  }));

  // POST /ad-accounts {ids:[...]} — choose which ad accounts to report on (this workspace only)
  router.post('/ad-accounts', requirePermission('content.edit'), express.json(), wrap(async (req, res) => {
    const c = await context(req.workspaceId);
    if (!c.fbToken) return needFacebook(res);
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String))].filter(x => /^act_\d+$/.test(x)).slice(0, 10);
    // Only accounts this connection can really see may be saved
    const visible = new Set((await metaReports.listAdAccounts(c.fbToken)).map(a => a.id));
    const bad = ids.filter(id => !visible.has(id));
    if (bad.length) return res.status(400).json({ error: `These ad accounts are not available to your Facebook connection: ${bad.join(', ')}`, code: 'not_visible' });
    if (!c.hasConfig) return res.status(400).json({ error: 'Open WhatsApp · Setup once to create your settings, then try again.', code: 'no_config' });
    await knex('meta_lead_configs').where({ workspace_id: req.workspaceId }).update({ meta_ad_account_ids: JSON.stringify(ids) });
    metaReports.clearCache(req.workspaceId);
    res.json({ success: true, selected: ids });
  }));

  // GET /ads?range=7d|30d|90d|month  or  ?since=YYYY-MM-DD&until=YYYY-MM-DD
  router.get('/ads', requirePermission('content.view'), wrap(async (req, res) => {
    const c = await context(req.workspaceId);
    if (!c.fbToken) return needFacebook(res);
    if (!c.adIds.length) return res.json({ accounts: [], needs_selection: true });
    const range = metaReports.resolveRange(req.query);
    const fresh = req.query.refresh === '1';
    const accounts = await Promise.all(c.adIds.map(async (id) => {
      try {
        return await metaReports.cached(req.workspaceId, `ads|${id}|${range.since}|${range.until}`, fresh, () => metaReports.adAccountReport(c.fbToken, id, range));
      } catch (e) { return { id, error: { code: e.code || 'error', message: e.message } }; }
    }));
    res.json({ range, accounts });
  }));

  // GET /whatsapp?range=...
  router.get('/whatsapp', requirePermission('content.view'), wrap(async (req, res) => {
    const c = await context(req.workspaceId);
    if (!c.waToken || !c.wabaId) {
      return res.status(400).json({ error: 'Add your WhatsApp access token and Business Account ID in WhatsApp · Setup first.', code: 'not_connected' });
    }
    const range = metaReports.resolveRange(req.query);
    const data = await metaReports.cached(req.workspaceId, `wa|${c.wabaId}|${c.phoneNumberId}|${range.since}|${range.until}`, req.query.refresh === '1',
      () => metaReports.whatsappReport(c.waToken, c.wabaId, c.phoneNumberId, range));
    res.json(data);
  }));

  return router;
};
