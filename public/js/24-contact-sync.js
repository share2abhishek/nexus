// NexaDrip App — Contact Sync page
// Send contacts automatically to a Google Sheet and to Salesforce (as Leads).
// Settings, a connection test, "sync now" and the state of every contact.

// showSteps: undefined = open while the service is not set up yet, closed once it works
const CsState = { status: null, busy: {}, showSteps: {}, draft: {}, prev: {} };
const CS_SF_FIELDS = ['cs-sf-domain', 'cs-sf-key', 'cs-sf-secret', 'cs-sf-ext', 'cs-sf-source', 'cs-sf-company', 'cs-sf-ver'];

function csEsc(v) { return typeof escapeHtml === 'function' ? escapeHtml(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function csAgo(sec) {
  if (!sec) return 'never';
  const d = Math.max(0, Math.floor(Date.now() / 1000) - Number(sec));
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(Number(sec) * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function csChip(kind, text) {
  const c = { ok: '#16a34a', warn: '#d97706', bad: '#dc2626', off: '#64748b' }[kind];
  return `<span class="nx-chip" style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;color:${c};background:${c}1f">${text}</span>`;
}

async function loadContactSync() {
  const root = document.getElementById('cs-root');
  if (!root) return;
  if (!CsState.status) root.innerHTML = '<div style="max-width:980px"><div class="nx-skel w-30"></div><div class="nx-skel w-90"></div><div class="nx-skel w-60"></div><div class="nx-skel w-90"></div></div>';
  try { CsState.status = await api('GET', '/api/contact-sync/status'); }
  catch (err) { root.innerHTML = `<div class="card"><div class="card-body">Could not load Contact Sync: ${csEsc(err.message)}</div></div>`; return; }
  renderContactSync();
}

async function csCall(key, fn, okMsg) {
  if (CsState.busy[key]) return;
  CsState.busy[key] = true; renderContactSync();
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'success', 6000); return r; }
  catch (err) { toast(err.message || 'Something went wrong', 'error', 9000); }
  finally { CsState.busy[key] = false; await loadContactSync(); }
}

// ── Actions ──────────────────────────────────────────────────────────────────
function csConnectGoogle() { window.location.href = '/auth/google?sheets=1'; }
function csCreateSheet() {
  const title = (document.getElementById('cs-sheet-title')?.value || '').trim() || 'NEXUS Contacts';
  return csCall('sheet', () => api('POST', '/api/contact-sync/google/sheet', { title }), 'Sheet created. Turn on Auto-sync to start sending contacts.');
}
function csDisconnectGoogle() {
  if (!confirm('Disconnect Google?\n\nContacts stop being sent. The sheet stays in your Google account.')) return;
  return csCall('gdisc', () => api('POST', '/api/contact-sync/google/disconnect'), 'Google disconnected.');
}
// Turning auto-sync on copies personal details to another service: say so first
function csToggle(target, on) {
  if (on) {
    const where = target === 'google' ? 'your Google Sheet' : 'Salesforce';
    if (!confirm(`Turn on auto-sync?\n\nEvery contact's name, phone, email and deal value is copied to ${where}, and new or changed contacts follow automatically.\n\nDeleting a contact in NEXUS does not delete it there.`)) { renderContactSync(); return; }
  }
  const body = target === 'google' ? { google_enabled: on, google_auto: on } : { sf_enabled: on, sf_auto: on };
  return csCall(`toggle-${target}`, () => api('POST', '/api/contact-sync/config', body), on ? 'Auto-sync is on.' : 'Auto-sync is off.');
}
function csSyncNow(target, force) {
  if (force && !confirm('Send every contact again?\n\nUse this if you cleared the sheet or want everything refreshed. Contacts already there are updated, and in Salesforce they are updated, not duplicated.')) return;
  return csCall(`sync-${target}`, () => api('POST', '/api/contact-sync/sync', { target, force: !!force }),
    r => (r.skipped ? 'A sync is already running.' : `Sent ${r.sent} contact${r.sent === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed` : ''}.`));
}
function csSfBody() {
  const v = id => (document.getElementById(id)?.value ?? '').trim();
  const body = { sf_domain: v('cs-sf-domain'), sf_api_version: v('cs-sf-ver') || 'v60.0', sf_external_id_field: v('cs-sf-ext'), sf_lead_source: v('cs-sf-source'), sf_default_company: v('cs-sf-company') };
  // The saved Consumer Key and Secret are never shown: leaving them blank keeps them
  const key = v('cs-sf-key'); if (key) body.sf_client_id = key;
  const secret = v('cs-sf-secret'); if (secret) body.sf_client_secret = secret;
  return body;
}
function csSaveSalesforce() {
  const body = csSfBody();
  return csCall('sfsave', async () => { const r = await api('POST', '/api/contact-sync/config', body); CsState.draft = {}; return r; }, 'Salesforce settings saved.');
}
function csTestSalesforce() {
  const body = csSfBody();
  return csCall('sftest', async () => { await api('POST', '/api/contact-sync/config', body); CsState.draft = {}; return api('POST', '/api/contact-sync/salesforce/test'); },
    r => `Connected to ${r.instance}.${r.external_id_field_found === false ? ' Warning: the External ID field was not found on Lead.' : ''}`);
}
function csCopy(text) {
  const done = () => toast('Copied.', 'success', 2000);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast('Select the address and copy it with Ctrl+C.', 'info'));
  else toast('Select the address and copy it with Ctrl+C.', 'info');
}
function csToggleSteps(which, open) { CsState.showSteps[which] = open; renderContactSync(); }

// ── Rendering ────────────────────────────────────────────────────────────────
// A number that changed since the last drawing is highlighted once, so progress is noticed
function csCounts(c, key) {
  const prev = CsState.prev[key] || null;
  const next = { total: c.total, synced: c.synced, pending: c.pending, failing: c.failing };
  CsState.prev[key] = next;
  const cell = ([label, field]) => {
    const n = next[field];
    const changed = prev && prev[field] !== n;
    return `<div><div class="form-hint" style="font-size:12px">${label}</div><div class="${changed ? 'nx-flash' : ''}" style="font-size:18px;font-weight:700;display:inline-block;padding:0 4px;${field === 'failing' && n ? 'color:#dc2626' : ''}">${Number(n).toLocaleString()}</div></div>`;
  };
  const who = c.last_error ? (c.last_error.name ? csEsc(c.last_error.name) : `contact #${csEsc(c.last_error.lead_id)}`) : '';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:12px">
    ${[['Total contacts', 'total'], ['Sent', 'synced'], ['Waiting', 'pending'], ['Failed', 'failing']].map(cell).join('')}
  </div>${c.failing && c.last_error ? `<div class="form-hint" style="color:#b91c1c;margin-top:6px">Last failure (${who}): ${csEsc(c.last_error.error)}</div>` : ''}`;
}
// "Something went wrong?" list: the exact message people see, and what to do about it
function csTroubleshoot(g) {
  if (!g.troubleshooting || !g.troubleshooting.length) return '';
  return `<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Google shows an error? Find it here</summary>
    <div style="margin-top:8px;display:grid;gap:10px">${g.troubleshooting.map((t) => `
      <div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px">
        <div style="font-weight:600;font-size:13px">${csEsc(t.problem)}</div>
        <div style="font-size:13px;line-height:1.55;margin-top:4px;color:var(--text-secondary)">${csEsc(t.fix)}</div>
      </div>`).join('')}</div></details>`;
}
function csSteps(which, g, notSetUp) {
  const open = CsState.showSteps[which] === undefined ? !!notSetUp : CsState.showSteps[which];
  return `<div style="margin-top:12px">
    ${g.intro ? `<div class="form-hint" style="margin-bottom:8px">${csEsc(g.intro)}</div>` : ''}
    <button class="btn btn-secondary btn-sm" onclick="csToggleSteps('${which}', ${!open})">${open ? 'Hide' : 'Show'} setup steps</button>
    ${open ? `<ol style="margin:10px 0 0 18px;padding:0;line-height:1.6;font-size:13.5px">${g.steps.map(s => `<li style="margin-bottom:6px">${csEsc(s)}</li>`).join('')}</ol>` : ''}</div>`;
}
const csBtn = (label, onclick, busyKey, kind = 'secondary', title = '') =>
  `<button class="btn btn-${kind} btn-sm" onclick="${onclick}" ${title ? `title="${csEsc(title)}"` : ''} ${CsState.busy[busyKey] ? 'disabled' : ''}>${CsState.busy[busyKey] ? '<span class="spinner sm"></span> ' : ''}${label}</button>`;
const csToggleHtml = (target, on) =>
  `<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-weight:600"><input type="checkbox" ${on ? 'checked' : ''} ${CsState.busy[`toggle-${target}`] ? 'disabled' : ''} onchange="csToggle('${target}', this.checked)" /> Auto-sync ${on ? 'is on' : 'is off'}</label>`;
const csDeleteNote = '<div class="form-hint" style="margin-top:6px">Deleting a contact in NEXUS does not delete it there.</div>';

function renderGoogleCard(s) {
  const g = s.google; const guide = s.guide.google; const c = s.counts.google;
  let body;
  if (!g.available) {
    body = `<div class="form-hint" style="margin-top:8px">${csEsc(guide.server_note)}</div>`;
  } else if (!g.connected) {
    body = `<div style="margin-top:12px">${csBtn('Connect Google', 'csConnectGoogle()', 'gconn', 'primary')}</div>
      <div class="form-hint" style="margin-top:10px">First time? In Google Cloud Console, add this under <b>Authorized redirect URIs</b> for your OAuth client:</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px"><code style="padding:4px 8px;border-radius:6px;background:var(--bg2,rgba(0,0,0,.05));overflow-wrap:anywhere">${csEsc(g.callback_url)}</code>
        <button type="button" class="btn btn-secondary btn-sm" onclick="csCopy(${csEsc(JSON.stringify(g.callback_url))})">Copy</button></div>`;
  } else if (!g.sheet_url) {
    body = `<div class="form-hint" style="margin-top:8px">Connected as <b>${csEsc(g.email || 'your Google account')}</b>.</div>
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:12px">
        <label style="flex:1;min-width:200px"><span class="form-hint">Sheet name</span><input id="cs-sheet-title" class="form-input" value="NEXUS Contacts" maxlength="100" /></label>
        ${csBtn('Create sheet', 'csCreateSheet()', 'sheet', 'primary')}
      </div>`;
  } else {
    body = `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px">
        <a class="btn btn-secondary btn-sm" href="${csEsc(g.sheet_url)}" target="_blank" rel="noopener noreferrer">Open sheet ↗</a>
        ${csToggleHtml('google', g.enabled && g.auto)}
        ${csBtn('Sync now', "csSyncNow('google', false)", 'sync-google', 'primary', 'Send new and changed contacts now')}
        ${csBtn('Send every contact again', "csSyncNow('google', true)", 'sync-google', 'secondary', 'Use this if you cleared the sheet')}
      </div>${csDeleteNote}
      <div class="form-hint" style="margin-top:8px">Account: ${csEsc(g.email || '—')} · Tab: ${csEsc(g.tab)} · Last sync: ${csEsc(csAgo(g.last_sync_at))}</div>
      ${g.last_error ? `<div role="alert" style="margin-top:8px;padding:8px 12px;border-radius:8px;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.35);color:#b91c1c;font-size:13px"><span aria-hidden="true">⚠️</span> ${csEsc(g.last_error)}</div>` : ''}
      ${csCounts(c, 'google')}
      <div style="margin-top:12px"><button type="button" class="btn btn-secondary btn-sm" onclick="csDisconnectGoogle()" style="color:#dc2626;border-color:rgba(220,38,38,.35)">Disconnect Google</button></div>`;
  }
  const ready = !!(g.connected && g.sheet_url);
  return `<div class="card" style="margin-bottom:16px"><div class="card-body">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
      <div style="font-weight:700;font-size:16px"><span aria-hidden="true">📊</span> Google Sheet</div>
      ${ready && g.enabled && g.auto ? csChip('ok', '✓ Auto-sync on') : csChip('off', ready ? 'Auto-sync off' : 'Not set up: follow the steps below')}
    </div>${body}${csSteps('google', guide, !ready)}${csTroubleshoot(guide)}</div></div>`;
}

function renderSalesforceCard(s) {
  const f = s.salesforce; const guide = s.guide.salesforce; const c = s.counts.salesforce;
  const ready = !!(f.domain && f.has_client_id && f.has_secret);
  const input = (id, label, val, ph = '', type = 'text', hint = '') =>
    `<label style="flex:1;min-width:230px"><span class="form-hint">${label}</span><input id="${id}" type="${type}" class="form-input" value="${csEsc(CsState.draft[id] !== undefined ? CsState.draft[id] : val)}" placeholder="${csEsc(ph)}" autocomplete="off" />${hint ? `<span class="form-hint" style="font-size:11px">${hint}</span>` : ''}</label>`;
  return `<div class="card" style="margin-bottom:16px"><div class="card-body">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
      <div style="font-weight:700;font-size:16px"><span aria-hidden="true">☁️</span> Salesforce</div>
      ${ready && f.enabled && f.auto ? csChip('ok', '✓ Auto-sync on') : csChip('off', ready ? 'Auto-sync off' : 'Not set up: follow the steps below')}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
      ${input('cs-sf-domain', 'Salesforce address (My Domain)', f.domain, 'https://yourcompany.my.salesforce.com', 'text', 'Salesforce: Setup → My Domain')}
      ${input('cs-sf-key', 'Consumer Key', '', f.has_client_id ? `Saved (ends …${f.client_id_hint}). Leave blank to keep it` : 'From your connected app', 'text', 'Salesforce: your app → Manage Consumer Details')}
      ${input('cs-sf-secret', 'Consumer Secret', '', f.has_secret ? 'Saved. Leave blank to keep it' : 'From your connected app', 'password', 'Same place as the Consumer Key')}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
      ${input('cs-sf-ext', 'External ID field (optional)', f.external_id_field, 'NEXUS_Lead_Id__c', 'text', 'Stops the same contact being created twice')}
      ${input('cs-sf-source', 'Lead Source', f.lead_source)}
      ${input('cs-sf-company', 'Company when unknown', f.default_company, '', 'text', 'Salesforce needs a Company on every Lead')}
      ${input('cs-sf-ver', 'API version', f.api_version, 'v60.0')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px">
      ${csBtn('Save', 'csSaveSalesforce()', 'sfsave', 'primary')}
      ${csBtn('Save and test', 'csTestSalesforce()', 'sftest', 'secondary', 'Saves what you typed, then signs in to Salesforce to check it')}
      ${ready ? csToggleHtml('salesforce', f.enabled && f.auto) : ''}
      ${ready ? csBtn('Sync now', "csSyncNow('salesforce', false)", 'sync-salesforce', 'secondary', 'Send new and changed contacts now') : ''}
      ${ready ? csBtn('Send every contact again', "csSyncNow('salesforce', true)", 'sync-salesforce', 'secondary', 'Refreshes every Lead in Salesforce (no duplicates)') : ''}
    </div>${ready ? csDeleteNote : ''}
    <div class="form-hint" style="margin-top:8px">Last sync: ${csEsc(csAgo(f.last_sync_at))}</div>
    ${f.last_error ? `<div role="alert" style="margin-top:8px;padding:8px 12px;border-radius:8px;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.35);color:#b91c1c;font-size:13px"><span aria-hidden="true">⚠️</span> ${csEsc(f.last_error)}</div>` : ''}
    ${ready ? csCounts(c, 'salesforce') : ''}${csSteps('salesforce', guide, !ready)}</div></div>`;
}

function renderContactSync() {
  const root = document.getElementById('cs-root');
  if (!root || !CsState.status) return;
  for (const id of CS_SF_FIELDS) { const el = document.getElementById(id); if (el) CsState.draft[id] = el.value; }
  const hadFocus = document.activeElement && document.activeElement.id;
  const s = CsState.status;
  root.innerHTML = `
    <div style="max-width:980px">
      <div class="form-hint" style="margin-bottom:14px">New and changed contacts are sent automatically within seconds; a timer also re-checks every couple of minutes.</div>
      ${renderGoogleCard(s)}
      ${renderSalesforceCard(s)}
      <div class="card"><div class="card-body">
        <div style="font-weight:700;margin-bottom:8px">What is sent for each contact</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${s.columns.map(c => `<span class="kb-tab-badge" style="font-size:12px">${csEsc(c)}</span>`).join('')}</div>
        <div class="form-hint" style="margin-top:8px">Salesforce receives: First and Last name, Company, Email, Phone, Lead Source, and a Description with the summary, stage, score, deal value and last action.</div>
      </div></div>
    </div>`;
  // a redraw must not take the cursor away from the box being typed in
  if (hadFocus && CS_SF_FIELDS.includes(hadFocus)) document.getElementById(hadFocus)?.focus();
}

window.loadContactSync = loadContactSync;
Object.assign(window, { csCopy, csConnectGoogle, csCreateSheet, csDisconnectGoogle, csToggle, csSyncNow, csSaveSalesforce, csTestSalesforce, csToggleSteps });
