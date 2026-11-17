// API Routes: Contact auto-sync (Google Sheet and Salesforce).
// Everything is scoped to req.workspaceId; secrets are never sent back to the browser.
const express = require('express');
const contactSync = require('../services/contactSync');

const GUIDE = {
  google: {
    title: 'Send contacts to a Google Sheet',
    steps: [
      'Click "Connect Google" and sign in with the Google account that should own the sheet. NEXUS only gets access to files it creates itself.',
      'Click "Create sheet". NEXUS makes a new Google Sheet called "NEXUS Contacts" in that account.',
      'Turn on "Auto-sync". New and changed contacts are added or updated in the sheet within a few seconds.',
      'Do not rename the first column ("Lead ID"). NEXUS uses it to find the right row when a contact changes. You can add your own columns after the last one.',
    ],
    server_note: 'If "Connect Google" says Google is not set up, the owner of this NEXUS server must add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET and turn on the Google Sheets API in Google Cloud Console (APIs & Services → Library → Google Sheets API → Enable).',
  },
  salesforce: {
    title: 'Send contacts to Salesforce as Leads',
    steps: [
      'In Salesforce go to Setup → App Manager → New Connected App.',
      'Tick "Enable OAuth Settings". For the callback URL enter https://localhost. Add the OAuth scope "Manage user data via APIs (api)". Tick "Enable Client Credentials Flow" and save.',
      'Open the app (Manage → Edit Policies). Under "Client Credentials Flow" choose a "Run As" user who is allowed to create Leads, then save.',
      'Open "Manage Consumer Details" and copy the Consumer Key and Consumer Secret into the boxes here.',
      'Find your address in Setup → My Domain (it looks like https://yourcompany.my.salesforce.com) and paste it as the Salesforce address.',
      'Optional but recommended: create a custom Lead field of type Text, marked "External ID" and "Unique" (for example NEXUS_Lead_Id__c), and enter its API name here. Then a contact is never created twice.',
      'Click "Test connection", then turn on "Auto-sync".',
    ],
  },
};

module.exports = (knex, requirePermission) => {
  const router = express.Router();
  const fail = (res, err) => {
    const status = err.status || (String(err.code || '').startsWith('sf_') || String(err.code || '').startsWith('google_') ? 400 : err.code === 'rate_limited' ? 429 : 500);
    res.status(status).json({ error: err.message, code: err.code || 'error' });
  };
  const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => fail(res, e));

  // What the screen may see: no tokens or secrets
  const publicConfig = (c) => ({
    google: {
      connected: !!c.google_refresh_token, email: c.google_email || null,
      sheet_url: c.google_sheet_url || null, tab: c.google_tab || 'Contacts',
      enabled: !!c.google_enabled, auto: !!c.google_auto,
      last_sync_at: c.last_google_sync_at || null, last_error: c.last_google_error || null,
      available: !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
    },
    salesforce: {
      enabled: !!c.sf_enabled, auto: !!c.sf_auto,
      domain: c.sf_domain || '', client_id: c.sf_client_id || '', has_secret: !!c.sf_client_secret,
      api_version: c.sf_api_version || 'v60.0', external_id_field: c.sf_external_id_field || '',
      lead_source: c.sf_lead_source || 'NEXUS', default_company: c.sf_default_company || '[Not provided]',
      last_sync_at: c.last_sf_sync_at || null, last_error: c.last_sf_error || null,
    },
  });

  router.get('/status', requirePermission('content.view'), wrap(async (req, res) => {
    const c = await contactSync.ensureConfig(knex, req.workspaceId);
    res.json({
      ...publicConfig(c), guide: GUIDE, columns: contactSync.COLUMNS,
      counts: { google: await contactSync.counts(knex, req.workspaceId, 'google'), salesforce: await contactSync.counts(knex, req.workspaceId, 'salesforce') },
    });
  }));

  // Save settings. A blank secret keeps the saved one.
  router.post('/config', requirePermission('content.edit'), express.json(), wrap(async (req, res) => {
    const b = req.body || {};
    const c = await contactSync.ensureConfig(knex, req.workspaceId);
    const patch = {};
    const flag = (k, col) => { if (b[k] !== undefined) patch[col] = b[k] ? 1 : 0; };
    flag('google_enabled', 'google_enabled'); flag('google_auto', 'google_auto');
    flag('sf_enabled', 'sf_enabled'); flag('sf_auto', 'sf_auto');

    if (b.google_tab !== undefined) {
      const tab = String(b.google_tab).trim();
      if (!tab || tab.length > 90 || /[\[\]:*?\/\\]/.test(tab)) return res.status(400).json({ error: 'The sheet tab name can not be empty or contain [ ] : * ? / \\', code: 'bad_tab' });
      if (tab !== c.google_tab && c.google_sheet_id) return res.status(400).json({ error: 'The tab name is fixed once the sheet is created. Create a new sheet to use another name.', code: 'tab_locked' });
      patch.google_tab = tab;
    }
    if (b.sf_domain !== undefined) {
      const d = String(b.sf_domain).trim();
      if (d) contactSync.sfBase(d); // throws a clear message for anything that is not a Salesforce address
      patch.sf_domain = d ? contactSync.sfBase(d) : null;
    }
    if (b.sf_client_id !== undefined) patch.sf_client_id = String(b.sf_client_id).trim().slice(0, 255) || null;
    if (b.sf_client_secret) patch.sf_client_secret = contactSync.seal(String(b.sf_client_secret).trim().slice(0, 255));
    if (b.sf_api_version !== undefined) {
      const v = String(b.sf_api_version).trim() || 'v60.0';
      if (!/^v\d{2}\.0$/.test(v)) return res.status(400).json({ error: 'The API version looks like v60.0', code: 'bad_version' });
      patch.sf_api_version = v;
    }
    if (b.sf_external_id_field !== undefined) {
      const f = String(b.sf_external_id_field).trim();
      if (f && !/^[A-Za-z][A-Za-z0-9_]*__c$/.test(f)) return res.status(400).json({ error: 'The External ID field name must end with __c, for example NEXUS_Lead_Id__c', code: 'bad_field' });
      patch.sf_external_id_field = f || null;
    }
    if (b.sf_lead_source !== undefined) patch.sf_lead_source = String(b.sf_lead_source).trim().slice(0, 100) || 'NEXUS';
    if (b.sf_default_company !== undefined) patch.sf_default_company = String(b.sf_default_company).trim().slice(0, 150) || '[Not provided]';

    // Switching on needs the basics first, so "on" never means "silently failing"
    const next = { ...c, ...patch };
    if (patch.sf_enabled && (!next.sf_domain || !next.sf_client_id || !next.sf_client_secret)) return res.status(400).json({ error: 'Enter the Salesforce address, Consumer Key and Consumer Secret before turning it on.', code: 'sf_not_configured' });
    if (patch.google_enabled && !next.google_sheet_id) return res.status(400).json({ error: 'Connect Google and create the sheet before turning it on.', code: 'google_no_sheet' });

    patch.updated_at = Math.floor(Date.now() / 1000);
    await knex('contact_sync_configs').where({ workspace_id: req.workspaceId }).update(patch);
    // changed Salesforce settings: give failed contacts another chance
    if (['sf_domain', 'sf_client_id', 'sf_client_secret', 'sf_external_id_field'].some(k => patch[k] !== undefined)) {
      await knex('contact_sync_state').where({ workspace_id: req.workspaceId, target: 'salesforce' }).whereNotNull('error').update({ attempts: 0 });
    }
    res.json(publicConfig(await contactSync.getConfig(knex, req.workspaceId)));
  }));

  router.post('/google/sheet', requirePermission('content.edit'), express.json(), wrap(async (req, res) => {
    const c = await contactSync.createSheet(knex, req.workspaceId, req.body && req.body.title);
    res.json(publicConfig(c).google);
  }));

  router.post('/google/disconnect', requirePermission('content.edit'), wrap(async (req, res) => {
    await knex('contact_sync_configs').where({ workspace_id: req.workspaceId })
      .update({ google_refresh_token: null, google_email: null, google_enabled: 0, updated_at: Math.floor(Date.now() / 1000) });
    res.json({ success: true });
  }));

  router.post('/salesforce/test', requirePermission('content.edit'), wrap(async (req, res) => {
    res.json(await contactSync.testSalesforce(knex, req.workspaceId));
  }));

  // Send now. force=true sends every contact again, including ones already sent.
  router.post('/sync', requirePermission('content.edit'), express.json(), wrap(async (req, res) => {
    const target = req.body && req.body.target === 'salesforce' ? 'salesforce' : 'google';
    const force = !!(req.body && req.body.force);
    if (!force) { // failed contacts get another go
      await knex('contact_sync_state').where({ workspace_id: req.workspaceId, target }).whereNotNull('error').update({ attempts: 0 });
    }
    const r = await contactSync.run(knex, req.workspaceId, target, { force });
    res.json({ target, ...r, counts: await contactSync.counts(knex, req.workspaceId, target) });
  }));

  return router;
};
