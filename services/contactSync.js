// Contact auto-sync: sends each workspace's contacts to its own Google Sheet and/or
// Salesforce, new and changed ones only.
//
// Multi-tenant: every call uses only that workspace's own saved Google login or
// Salesforce app. Nothing falls back to a platform account, and the state table keeps
// what was sent per workspace.
const axios = require('axios');
const secrets = require('./secrets');

const BATCH = 200;          // contacts sent per target per run (the next run sends the rest)
const MAX_ATTEMPTS = 5;     // a contact that keeps failing is parked until "Sync now"
const SWEEP_MS = Math.max(30, Number(process.env.CONTACT_SYNC_INTERVAL_SEC) || 120) * 1000;
const now = () => Math.floor(Date.now() / 1000);

class SyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ── What is sent for a contact ───────────────────────────────────────────────
const COLUMNS = ['Lead ID', 'Name', 'Mobile', 'Email', 'Society / company', 'Source', 'Stage', 'Score', 'Status', 'Owner', 'Deal value', 'Last action', 'Added', 'Updated'];
const stamp = (s) => (s ? new Date(Number(s) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '');

function toRecord(lead, last) {
  const raw = lead.raw_answers || lead.raw_answers_json || {};
  const company = lead.society || raw.society_name || raw.housing_society || raw.company || raw.company_name || raw.organization || '';
  return {
    id: lead.id,
    name: lead.full_name || '',
    phone: lead.phone_number || '',
    email: lead.email || '',
    company,
    source: lead.source || lead.channel_source || '',
    stage: lead.pipeline_stage || '',
    score: lead.lead_score ?? '',
    status: lead.status || '',
    owner: lead.assigned_agent_name || '',
    deal: lead.deal_value ?? '',
    summary: lead.intent_summary || '',
    last: last ? `${last.kind}${last.actor_name ? ' by ' + last.actor_name : ''}: ${String(last.body || '').slice(0, 120)}` : '',
    added: lead.created_at,
    updated: lead.updated_at || lead.created_at,
  };
}
const sheetRow = (r) => [r.id, r.name, r.phone, r.email, r.company, r.source, r.stage, r.score, r.status, r.owner, r.deal, r.last, stamp(r.added), stamp(r.updated)].map(v => String(v ?? ''));

// ── Config ───────────────────────────────────────────────────────────────────
async function getConfig(db, workspaceId) {
  return db('contact_sync_configs').where({ workspace_id: workspaceId }).first();
}
async function ensureConfig(db, workspaceId) {
  let c = await getConfig(db, workspaceId);
  if (!c) {
    await db('contact_sync_configs').insert({ workspace_id: workspaceId, created_at: now(), updated_at: now() });
    c = await getConfig(db, workspaceId);
  }
  return c;
}

// The contacts that still need sending to this target: never sent, or changed since
async function pendingLeads(db, workspaceId, target, { force = false, limit = BATCH } = {}) {
  const repo = require('../repos/leadPipelineRepo')(db);
  const q = db('meta_lead_events as l')
    .leftJoin('contact_sync_state as s', function () {
      this.on('s.lead_id', '=', 'l.id').andOn('s.workspace_id', '=', 'l.workspace_id').andOn('s.target', '=', db.raw('?', [target]));
    })
    .where('l.workspace_id', workspaceId)
    .where(function () {
      this.whereNull('s.id').orWhereRaw('COALESCE(l.updated_at, l.created_at) > COALESCE(s.synced_updated_at, 0)');
      if (force) this.orWhereNotNull('s.id');
    })
    .select('l.*', 's.external_id as sync_external_id', 's.attempts as sync_attempts')
    .orderBy('l.id', 'asc')
    .limit(limit);
  if (!force) q.where(function () { this.whereNull('s.id').orWhere('s.attempts', '<', MAX_ATTEMPTS); });
  const rows = await q;
  const last = await repo.lastActivities(workspaceId, rows.map(r => r.id)).catch(() => ({}));
  return rows.map(r => ({ lead: Object.assign(repo.formatLead(r), { updated_at: r.updated_at }), sync_external_id: r.sync_external_id, last: last[r.id] || null }));
}

async function saveState(db, workspaceId, leadId, target, patch) {
  const row = { workspace_id: workspaceId, lead_id: leadId, target, ...patch };
  await db('contact_sync_state').insert(row).onConflict(['workspace_id', 'lead_id', 'target']).merge(patch);
}
const markOk = (db, ws, item, target, externalId) => saveState(db, ws, item.lead.id, target, {
  external_id: externalId || item.sync_external_id || null, synced_at: now(),
  synced_updated_at: Number(item.lead.updated_at || item.lead.created_at || 0), error: null, attempts: 0,
});
const markFail = (db, ws, item, target, message) => saveState(db, ws, item.lead.id, target, {
  error: String(message).slice(0, 500), attempts: (Number(item.sync_attempts) || 0) + 1,
});

// ── Google Sheets ────────────────────────────────────────────────────────────
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

function googleError(err) {
  const e = err?.response?.data?.error;
  const msg = (typeof e === 'string' ? e : e?.message) || err?.response?.data?.error_description || err?.message || 'Google did not answer.';
  const status = err?.response?.status;
  if (status === 401 || /invalid_grant|invalid_token|expired|revoked/i.test(msg)) return new SyncError('google_auth', 'The Google connection has expired or was removed. Connect Google again.');
  if (status === 403 && /has not been used|disabled|SERVICE_DISABLED/i.test(msg)) return new SyncError('google_api_off', 'Turn on the Google Sheets API for your Google Cloud project, then try again.');
  if (status === 403) return new SyncError('google_denied', 'Google refused access to the sheet. Connect Google again so NEXUS can create a new one.');
  if (status === 404) return new SyncError('google_sheet_gone', 'The sheet was deleted or is no longer available. Create a new one.');
  if (status === 429) return new SyncError('rate_limited', 'Google asked us to slow down. It will retry shortly.');
  return new SyncError('google_error', msg);
}

async function googleAccessToken(cfg) {
  if (!cfg.google_refresh_token) throw new SyncError('google_not_connected', 'Connect Google first.');
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) throw new SyncError('google_not_configured', 'Google sign-in is not set up on this server (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).');
  try {
    const r = await axios.request({
      method: 'post', url: 'https://oauth2.googleapis.com/token', timeout: 15000,
      data: { client_id: process.env.GOOGLE_OAUTH_CLIENT_ID, client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: cfg.google_refresh_token, grant_type: 'refresh_token' },
    });
    return r.data.access_token;
  } catch (err) { throw googleError(err); }
}

async function sheets(token, method, path, { params, data } = {}) {
  try {
    const r = await axios.request({ method, url: `${SHEETS}${path}`, params, data, headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
    return r.data;
  } catch (err) { throw googleError(err); }
}
const tabRef = (tab) => `'${String(tab || 'Contacts').replace(/'/g, "''")}'`;

// Create the workspace's sheet (a new file owned by the person who connected Google)
async function createSheet(db, workspaceId, title) {
  const cfg = await ensureConfig(db, workspaceId);
  const token = await googleAccessToken(cfg);
  const tab = cfg.google_tab || 'Contacts';
  const sheet = await sheets(token, 'post', '', { data: { properties: { title: String(title || 'NEXUS Contacts').slice(0, 100) }, sheets: [{ properties: { title: tab } }] } });
  await sheets(token, 'put', `/${sheet.spreadsheetId}/values/${encodeURIComponent(`${tabRef(tab)}!A1`)}`, { params: { valueInputOption: 'RAW' }, data: { values: [COLUMNS] } });
  await db('contact_sync_configs').where({ workspace_id: workspaceId }).update({
    google_sheet_id: sheet.spreadsheetId, google_sheet_url: sheet.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}`,
    last_google_error: null, updated_at: now(),
  });
  // a new sheet is empty: send everything again
  await db('contact_sync_state').where({ workspace_id: workspaceId, target: 'google' }).del();
  return getConfig(db, workspaceId);
}

async function syncGoogle(db, workspaceId, { force = false } = {}) {
  const cfg = await getConfig(db, workspaceId);
  if (!cfg || !cfg.google_sheet_id) throw new SyncError('google_no_sheet', 'Create the sheet first.');
  const token = await googleAccessToken(cfg);
  const tab = tabRef(cfg.google_tab);
  const base = `/${cfg.google_sheet_id}`;
  const items = await pendingLeads(db, workspaceId, 'google', { force });
  if (!items.length) return { sent: 0, failed: 0 };

  // Where each contact already is in the sheet (column A holds the Lead ID)
  const col = await sheets(token, 'get', `${base}/values/${encodeURIComponent(`${tab}!A2:A`)}`, { params: { majorDimension: 'COLUMNS' } });
  const rowOf = new Map();
  ((col.values && col.values[0]) || []).forEach((id, i) => { if (id !== '' && !rowOf.has(String(id))) rowOf.set(String(id), i + 2); });

  const updates = []; const appends = [];
  for (const it of items) {
    const values = sheetRow(toRecord(it.lead, it.last));
    const row = rowOf.get(String(it.lead.id));
    if (row) updates.push({ it, range: `${tab}!A${row}:N${row}`, values: [values] });
    else appends.push({ it, values });
  }
  let sent = 0; let failed = 0;
  try {
    if (updates.length) {
      await sheets(token, 'post', `${base}/values:batchUpdate`, { data: { valueInputOption: 'RAW', data: updates.map(u => ({ range: u.range, values: u.values })) } });
      for (const u of updates) { await markOk(db, workspaceId, u.it, 'google'); sent++; }
    }
    if (appends.length) {
      await sheets(token, 'post', `${base}/values/${encodeURIComponent(`${tab}!A1`)}:append`, { params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, data: { values: appends.map(a => a.values) } });
      for (const a of appends) { await markOk(db, workspaceId, a.it, 'google'); sent++; }
    }
  } catch (err) {
    for (const it of [...updates, ...appends]) { await markFail(db, workspaceId, it.it, 'google', err.message); failed++; }
    throw err;
  }
  return { sent, failed };
}

// ── Salesforce ───────────────────────────────────────────────────────────────
// Only Salesforce's own addresses are allowed: the address is typed by the user and is
// called from our server, so anything else (an internal address, say) is refused.
function sfBase(domain) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(String(domain).trim()) ? String(domain).trim() : `https://${String(domain).trim()}`); }
  catch { throw new SyncError('sf_bad_domain', 'Enter your Salesforce My Domain address, like https://yourcompany.my.salesforce.com'); }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !(h.endsWith('.salesforce.com') || h.endsWith('.force.com')) || u.username || u.password) {
    throw new SyncError('sf_bad_domain', 'The address must be a Salesforce address ending in .salesforce.com or .force.com, starting with https://');
  }
  return `https://${h}`;
}

function sfError(err) {
  const d = err?.response?.data;
  const first = Array.isArray(d) ? d[0] : d;
  const msg = first?.message || first?.error_description || first?.error || err?.message || 'Salesforce did not answer.';
  const status = err?.response?.status;
  if (first?.error === 'invalid_client' || first?.error === 'invalid_client_id' || /invalid_client/.test(String(msg))) return new SyncError('sf_auth', 'Salesforce did not accept the Consumer Key or Secret. Check them and that the Client Credentials flow is turned on.');
  if (first?.error === 'unsupported_grant_type') return new SyncError('sf_auth', 'Turn on "Enable Client Credentials Flow" in your Salesforce connected app.');
  if (status === 401 || first?.errorCode === 'INVALID_SESSION_ID') return new SyncError('sf_auth', 'Salesforce refused the login. Check the Consumer Key, Secret and the "Run as" user.');
  if (first?.errorCode === 'REQUEST_LIMIT_EXCEEDED' || status === 429) return new SyncError('rate_limited', 'Salesforce API limit reached. It will retry later.');
  return new SyncError(first?.errorCode ? `sf_${String(first.errorCode).toLowerCase()}` : 'sf_error', msg);
}

async function sfLogin(cfg) {
  if (!cfg.sf_domain || !cfg.sf_client_id || !cfg.sf_client_secret) throw new SyncError('sf_not_configured', 'Enter the Salesforce address, Consumer Key and Consumer Secret first.');
  const base = sfBase(cfg.sf_domain);
  try {
    const r = await axios.request({
      method: 'post', url: `${base}/services/oauth2/token`, timeout: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.sf_client_id, client_secret: cfg.sf_client_secret }).toString(),
    });
    // Salesforce names the exact instance to use; only trust it if it is a Salesforce address
    let instance = base;
    try { instance = sfBase(r.data.instance_url || base); } catch { instance = base; }
    return { token: r.data.access_token, instance };
  } catch (err) { throw sfError(err); }
}

function leadBody(cfg, rec) {
  const name = String(rec.name || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const last = parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] || 'Unknown');
  const first = parts.length > 1 ? parts[0] : '';
  const desc = [
    rec.summary && `Summary: ${rec.summary}`,
    rec.stage && `Stage: ${rec.stage}`,
    rec.score !== '' && `Score: ${rec.score}`,
    rec.deal !== '' && `Deal value: ${rec.deal}`,
    rec.last && `Last action: ${rec.last}`,
    `NEXUS Lead ID: ${rec.id}`,
  ].filter(Boolean).join('\n');
  const body = {
    LastName: last.slice(0, 80), Company: (rec.company || cfg.sf_default_company || '[Not provided]').slice(0, 255),
    LeadSource: cfg.sf_lead_source || 'NEXUS', Description: desc.slice(0, 32000),
  };
  if (first) body.FirstName = first.slice(0, 40);
  if (rec.email) body.Email = rec.email;
  if (rec.phone) body.Phone = rec.phone.slice(0, 40);
  return body;
}

async function sfCall(login, cfg, method, path, data) {
  try {
    const r = await axios.request({
      method, url: `${login.instance}/services/data/${cfg.sf_api_version || 'v60.0'}${path}`, data, timeout: 20000,
      headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return r;
  } catch (err) { throw sfError(err); }
}

async function testSalesforce(db, workspaceId) {
  const cfg = await getConfig(db, workspaceId);
  if (!cfg) throw new SyncError('sf_not_configured', 'Save the Salesforce settings first.');
  const login = await sfLogin(cfg);
  const d = await sfCall(login, cfg, 'get', '/sobjects/Lead/describe');
  const fields = (d.data.fields || []).map(f => f.name);
  const ext = cfg.sf_external_id_field;
  return {
    ok: true, instance: login.instance,
    can_create: d.data.createable !== false,
    external_id_field_found: ext ? fields.includes(ext) : null,
  };
}

async function syncSalesforce(db, workspaceId, { force = false } = {}) {
  const cfg = await getConfig(db, workspaceId);
  if (!cfg) throw new SyncError('sf_not_configured', 'Save the Salesforce settings first.');
  const login = await sfLogin(cfg);
  const items = await pendingLeads(db, workspaceId, 'salesforce', { force });
  let sent = 0; let failed = 0; let firstError = null;
  const ext = cfg.sf_external_id_field && /^[A-Za-z][A-Za-z0-9_]*__c$/.test(cfg.sf_external_id_field) ? cfg.sf_external_id_field : null;
  for (const it of items) {
    const rec = toRecord(it.lead, it.last);
    const body = leadBody(cfg, rec);
    try {
      let id = it.sync_external_id || null;
      if (ext) {
        // upsert on the customer's own External ID field: the same contact is never created twice
        const r = await sfCall(login, cfg, 'patch', `/sobjects/Lead/${ext}/${encodeURIComponent(rec.id)}`, body);
        id = (r.data && r.data.id) || id;
      } else if (id) {
        await sfCall(login, cfg, 'patch', `/sobjects/Lead/${encodeURIComponent(id)}`, body);
      } else {
        const r = await sfCall(login, cfg, 'post', '/sobjects/Lead', body);
        id = r.data && r.data.id;
      }
      await markOk(db, workspaceId, it, 'salesforce', id);
      sent++;
    } catch (err) {
      await markFail(db, workspaceId, it, 'salesforce', err.message);
      failed++; firstError = firstError || err;
      if (err.code === 'sf_auth' || err.code === 'rate_limited') break; // no point trying the rest now
    }
  }
  if (firstError && !sent) throw firstError;
  return { sent, failed, error: firstError ? firstError.message : null };
}

// ── Running it: now, on demand, and on a timer ───────────────────────────────
const running = new Set();
async function run(db, workspaceId, target, opts = {}) {
  const key = `${workspaceId}|${target}`;
  if (running.has(key)) return { skipped: true };
  running.add(key);
  const col = target === 'google' ? 'google' : 'sf';
  try {
    let res;
    try { res = await (target === 'google' ? syncGoogle(db, workspaceId, opts) : syncSalesforce(db, workspaceId, opts)); }
    catch (err) {
      await db('contact_sync_configs').where({ workspace_id: workspaceId }).update({ [`last_${col}_error`]: String(err.message).slice(0, 500), updated_at: now() });
      throw err;
    }
    await db('contact_sync_configs').where({ workspace_id: workspaceId }).update({
      [`last_${col}_sync_at`]: now(), [`last_${col}_error`]: res.error || null, updated_at: now(),
    });
    return res;
  } finally { running.delete(key); }
}

async function sweep(db) {
  const cfgs = await db('contact_sync_configs').where(function () {
    this.where({ google_enabled: 1, google_auto: 1 }).orWhere({ sf_enabled: 1, sf_auto: 1 });
  });
  for (const c of cfgs) {
    if (c.google_enabled && c.google_auto && c.google_sheet_id) await run(db, c.workspace_id, 'google').catch(() => {});
    if (c.sf_enabled && c.sf_auto) await run(db, c.workspace_id, 'salesforce').catch(() => {});
  }
}

let timer = null; let dbRef = null; const pending = new Map();
function start(db) {
  dbRef = db;
  timer = setInterval(() => sweep(db).catch(err => console.warn('[ContactSync] sweep:', err.message)), SWEEP_MS);
  timer.unref?.();
}
// A new or changed contact: send it within seconds instead of waiting for the timer
function notify(workspaceId) {
  if (!dbRef || pending.has(workspaceId)) return;
  const t = setTimeout(async () => {
    pending.delete(workspaceId);
    try {
      const c = await getConfig(dbRef, workspaceId);
      if (!c) return;
      if (c.google_enabled && c.google_auto && c.google_sheet_id) await run(dbRef, workspaceId, 'google').catch(() => {});
      if (c.sf_enabled && c.sf_auto) await run(dbRef, workspaceId, 'salesforce').catch(() => {});
    } catch { /* the timer will retry */ }
  }, 4000);
  t.unref?.();
  pending.set(workspaceId, t);
}

// Counts for the screen: how many contacts are sent, waiting, or failing
async function counts(db, workspaceId, target) {
  const total = Number((await db('meta_lead_events').where({ workspace_id: workspaceId }).count({ c: '*' }).first()).c) || 0;
  const synced = Number((await db('contact_sync_state').where({ workspace_id: workspaceId, target }).whereNull('error').whereNotNull('synced_at').count({ c: '*' }).first()).c) || 0;
  const failing = Number((await db('contact_sync_state').where({ workspace_id: workspaceId, target }).whereNotNull('error').count({ c: '*' }).first()).c) || 0;
  const lastError = await db('contact_sync_state').where({ workspace_id: workspaceId, target }).whereNotNull('error').orderBy('id', 'desc').first('lead_id', 'error');
  return { total, synced, pending: Math.max(0, total - synced - failing), failing, last_error: lastError || null };
}

module.exports = {
  COLUMNS, SyncError, toRecord, sheetRow, leadBody, sfBase, googleError, sfError,
  getConfig, ensureConfig, pendingLeads, createSheet, syncGoogle, testSalesforce, syncSalesforce,
  run, sweep, start, notify, counts, seal: secrets.seal,
};
