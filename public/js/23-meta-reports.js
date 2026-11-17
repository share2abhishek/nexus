// NexaDrip App — Meta Reports page
// Ad account balance and spend, WhatsApp message and cost analytics, number health,
// and a step-by-step guide for any Meta permission that is still missing.

const MrState = { status: null, range: '30d', adAccounts: null, ads: null, wa: null, picking: false, busy: false };

function mrEsc(v) { return typeof escapeHtml === 'function' ? escapeHtml(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function mrMoney(n, cur) {
  if (n == null) return '—';
  try { return new Intl.NumberFormat(undefined, cur ? { style: 'currency', currency: cur } : { maximumFractionDigits: 2 }).format(n); }
  catch { return mrEsc(`${n} ${cur || ''}`.trim()); }
}
const mrNum = n => (n == null ? '—' : Number(n).toLocaleString());

async function loadMetaReports(refresh = false) {
  const root = document.getElementById('mr-root');
  if (!root) return;
  if (!MrState.status) root.innerHTML = '<div style="max-width:980px" aria-busy="true" aria-label="Checking your Meta connection"><div class="nx-skel w-30"></div><div class="nx-skel w-90"></div><div class="nx-skel w-60"></div></div>';
  try {
    MrState.status = await api('GET', '/api/meta-reports/status');
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="card-body">Could not load Meta Reports: ${mrEsc(err.message)}</div></div>`;
    return;
  }
  renderMetaReports();
  const q = `range=${encodeURIComponent(MrState.range)}${refresh ? '&refresh=1' : ''}`;
  const jobs = [];
  if (MrState.status.ads.granted) {
    jobs.push(api('GET', `/api/meta-reports/ad-accounts${refresh ? '?refresh=1' : ''}`).then(r => { MrState.adAccounts = r; }).catch(e => { MrState.adAccounts = { error: e.message }; }));
    jobs.push(api('GET', `/api/meta-reports/ads?${q}`).then(r => { MrState.ads = r; }).catch(e => { MrState.ads = { error: e.message }; }));
  }
  if (MrState.status.whatsapp.connected) {
    jobs.push(api('GET', `/api/meta-reports/whatsapp?${q}`).then(r => { MrState.wa = r; }).catch(e => { MrState.wa = { error: e.message }; }));
  }
  await Promise.all(jobs);
  renderMetaReports();
}

function mrSetRange(v) { MrState.range = v; MrState.ads = null; MrState.wa = null; loadMetaReports(); }

// ── Permission checklist with the how-to guide ───────────────────────────────
function mrChip(kind, text) {
  const c = { ok: '#16a34a', warn: '#d97706', bad: '#dc2626', off: '#64748b' }[kind];
  return `<span class="nx-chip" style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;color:${c};background:${c}1f">${text}</span>`;
}

function mrGuideBlock(g, extraButtons) {
  return `
    <details style="margin-top:10px" open>
      <summary style="cursor:pointer;font-weight:600">How to add this permission</summary>
      <ol style="margin:10px 0 0 18px;padding:0;line-height:1.6;font-size:13.5px">
        ${g.steps.map(s => `<li style="margin-bottom:6px">${mrEsc(s)}</li>`).join('')}
      </ol>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${extraButtons || ''}
        ${(g.links || []).map(l => `<a class="btn btn-secondary btn-sm" href="${mrEsc(l.url)}" target="_blank" rel="noopener noreferrer">${mrEsc(l.label)} ↗</a>`).join('')}
        <button class="btn btn-secondary btn-sm" onclick="loadMetaReports(true)">Check again</button>
      </div>
    </details>`;
}

function renderMrPermissions() {
  const s = MrState.status;
  const g = s.guide;

  // Ads row
  let adsChip; let adsBody = '';
  if (!s.ads.connected) {
    adsChip = mrChip('off', 'Facebook not connected');
    adsBody = '<div class="form-hint" style="margin-top:6px">Connect Facebook in Settings → Connected accounts, then come back.</div>';
  } else if (s.ads.granted) {
    adsChip = mrChip('ok', '✓ Ready');
  } else if (s.ads.error && s.ads.error.code === 'token_expired') {
    adsChip = mrChip('bad', 'Connection expired');
    adsBody = mrGuideBlock(g.ads, '<a class="btn btn-primary btn-sm" href="/auth/facebook?ads=1">Reconnect Facebook with ads access</a>');
  } else {
    adsChip = mrChip('warn', 'One more step: ads access');
    adsBody = mrGuideBlock(g.ads, '<a class="btn btn-primary btn-sm" href="/auth/facebook?ads=1">Reconnect Facebook with ads access</a>');
  }

  // WhatsApp row
  const w = s.whatsapp;
  let waChip; let waBody = '';
  if (!w.has_token || !w.has_waba_id) {
    waChip = mrChip('off', 'WhatsApp not fully set up');
    waBody = `<div class="form-hint" style="margin-top:6px">${!w.has_token ? 'The access token is missing. ' : ''}${!w.has_waba_id ? 'The WhatsApp Business Account ID is missing. ' : ''}Add them in WhatsApp · Setup.</div>` + mrGuideBlock(g.whatsapp, '<button class="btn btn-primary btn-sm" onclick="navigateTo(\'leads-settings\')">Open WhatsApp · Setup</button>');
  } else if (w.granted) {
    waChip = mrChip('ok', '✓ Ready');
  } else if (w.granted === false) {
    waChip = mrChip('warn', w.error && w.error.code === 'token_expired' ? 'Token expired' : 'One more step: WhatsApp reports access');
    waBody = `<div class="form-hint" style="margin-top:6px">${mrEsc(w.error?.message || '')}</div>` + mrGuideBlock(g.whatsapp, '<button class="btn btn-primary btn-sm" onclick="navigateTo(\'leads-settings\')">Open WhatsApp · Setup</button>');
  } else {
    waChip = mrChip('warn', 'Could not check');
    waBody = `<div class="form-hint" style="margin-top:6px">${mrEsc(w.error?.message || 'Meta did not answer.')}</div>`;
  }

  return `
    <div class="card" style="margin-bottom:16px"><div class="card-body">
      <div style="font-weight:700;font-size:15px;margin-bottom:12px">🔐 Permissions Meta needs to share these reports</div>
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div><b>${mrEsc(g.ads.title)}</b><div class="form-hint">Needs the Meta permission <code>ads_read</code></div></div>${adsChip}
      </div>${adsBody}
      <hr style="border:0;border-top:1px solid var(--border);margin:16px 0" />
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div><b>${mrEsc(g.whatsapp.title)}</b><div class="form-hint">Needs the Meta permission <code>whatsapp_business_management</code></div></div>${waChip}
      </div>${waBody}
    </div></div>`;
}

// ── Ads ──────────────────────────────────────────────────────────────────────
function mrToggleAccountPicker() { MrState.picking = !MrState.picking; renderMetaReports(); }

async function mrSaveAdAccounts() {
  const ids = [...document.querySelectorAll('.mr-acct:checked')].map(el => el.value);
  try {
    await api('POST', '/api/meta-reports/ad-accounts', { ids });
    toast('Ad accounts saved.', 'success');
    MrState.picking = false; MrState.ads = null;
    await loadMetaReports(true);
  } catch (err) { toast(`Could not save: ${err.message}`, 'error'); }
}

function renderMrAds() {
  const s = MrState.status;
  if (!s.ads.connected || !s.ads.granted) return '';
  const accts = MrState.adAccounts?.accounts || [];
  const selected = new Set(MrState.adAccounts?.selected || s.ads.selected || []);

  const picker = MrState.picking ? `
    <div class="card" style="margin-bottom:12px"><div class="card-body">
      <div style="font-weight:600;margin-bottom:8px">Choose the ad accounts to report on</div>
      ${accts.length ? accts.map(a => `
        <label style="display:flex;gap:8px;align-items:center;padding:6px 0;cursor:pointer">
          <input type="checkbox" class="mr-acct" value="${mrEsc(a.id)}" ${selected.has(a.id) ? 'checked' : ''} />
          <span><b>${mrEsc(a.name)}</b> <span class="form-hint">${mrEsc(a.id)} · ${mrEsc(a.currency || '')} · ${mrEsc(a.status)}</span></span>
        </label>`).join('') : '<div class="form-hint">This Facebook connection can not see any ad account. Ask the owner to give you access in Business settings → Ad accounts.</div>'}
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-primary btn-sm" onclick="mrSaveAdAccounts()">Save</button><button class="btn btn-secondary btn-sm" onclick="mrToggleAccountPicker()">Cancel</button></div>
    </div></div>` : '';

  let body;
  if (MrState.ads?.error) body = `<div class="form-hint">${mrEsc(MrState.ads.error)}</div>`;
  else if (!MrState.ads) body = '<div class="state-loading"><span class="spinner"></span> Loading ad reports…</div>';
  else if (MrState.ads.needs_selection) body = '<div class="form-hint">Choose which ad accounts to report on, using the button above.</div>';
  else body = MrState.ads.accounts.map(a => {
    if (a.error) return `<div class="card" style="margin-bottom:10px"><div class="card-body"><b>${mrEsc(a.id)}</b><div class="form-hint" style="color:#dc2626">${mrEsc(a.error.message)}</div></div></div>`;
    const t = a.totals;
    return `
      <div class="card" style="margin-bottom:12px"><div class="card-body">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center">
          <div><b style="font-size:15px">${mrEsc(a.name)}</b> <span class="form-hint">${mrEsc(a.id)}</span></div>
          <div style="display:flex;gap:8px;align-items:center">
            ${mrChip(a.status === 'Active' ? 'ok' : 'warn', mrEsc(a.status))}
            ${a.billing_url ? `<a class="btn btn-primary btn-sm" href="${mrEsc(a.billing_url)}" target="_blank" rel="noopener noreferrer" title="Meta takes payments on its own page">Pay on Meta ↗</a>` : ''}
          </div>
        </div>
        ${a.warning ? `<div role="alert" style="margin-top:10px;padding:10px 12px;border-radius:8px;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.35);color:#b91c1c;font-size:13px">⚠️ ${mrEsc(a.warning)}</div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:14px">
          ${mrStat('Amount due now', mrMoney(a.amount_due, a.currency), 'What Meta is waiting to bill')}
          ${mrStat('Spent, all time', mrMoney(a.total_spent, a.currency))}
          ${mrStat('Spending limit', a.spend_cap == null ? 'None' : mrMoney(a.spend_cap, a.currency))}
          ${mrStat('Payment method', mrEsc(a.funding_source || '—'))}
        </div>
        <div style="font-weight:600;margin:16px 0 8px">${mrEsc(a.range.since)} → ${mrEsc(a.range.until)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px">
          ${mrStat('Spend', mrMoney(t.spend, a.currency))}
          ${mrStat('Leads', mrNum(t.leads))}
          ${mrStat('Cost per lead', t.cost_per_lead == null ? '—' : mrMoney(t.cost_per_lead, a.currency))}
          ${mrStat('Impressions', mrNum(t.impressions))}
          ${mrStat('Clicks', mrNum(t.clicks))}
        </div>
        ${a.daily.length ? `<details style="margin-top:12px"><summary style="cursor:pointer">Day by day</summary>
          <div style="overflow-x:auto"><table class="table" style="width:100%;font-size:13px;margin-top:8px"><thead><tr><th>Date</th><th>Spend</th><th>Leads</th><th>Clicks</th><th>Impressions</th></tr></thead><tbody>
          ${a.daily.map(d => `<tr><td>${mrEsc(d.date)}</td><td>${mrMoney(d.spend, a.currency)}</td><td>${mrNum(d.leads)}</td><td>${mrNum(d.clicks)}</td><td>${mrNum(d.impressions)}</td></tr>`).join('')}
          </tbody></table></div></details>` : ''}
      </div></div>`;
  }).join('');

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin:22px 0 10px;gap:10px;flex-wrap:wrap">
      <div style="font-weight:700;font-size:16px">📣 Ad accounts</div>
      <button class="btn btn-secondary btn-sm" onclick="mrToggleAccountPicker()">Choose ad accounts</button>
    </div>${picker}${body}`;
}

function mrStat(label, value, hint) {
  return `<div><div class="form-hint" style="font-size:12px">${mrEsc(label)}</div><div style="font-size:17px;font-weight:700;overflow-wrap:anywhere">${value}</div>${hint ? `<div class="form-hint" style="font-size:11px">${mrEsc(hint)}</div>` : ''}</div>`;
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────
const MR_TIERS = { TIER_50: '50 people a day', TIER_250: '250 people a day', TIER_1K: '1,000 people a day', TIER_10K: '10,000 people a day', TIER_100K: '100,000 people a day', TIER_UNLIMITED: 'Unlimited' };
const MR_QUALITY = { GREEN: ['ok', 'Good'], YELLOW: ['warn', 'Medium: watch your reports and blocks'], RED: ['bad', 'Low: messaging may be limited'], UNKNOWN: ['off', 'Not rated yet'] };

function renderMrWhatsApp() {
  const s = MrState.status;
  if (!s.whatsapp.connected || s.whatsapp.granted === false) return '';
  const w = MrState.wa;
  let body;
  if (!w) body = '<div class="state-loading"><span class="spinner"></span> Loading WhatsApp reports…</div>';
  else if (w.error) body = `<div class="form-hint">${mrEsc(w.error)}</div>`;
  else {
    const errs = Object.entries(w.errors || {}).map(([k, e]) => `<div class="form-hint" style="color:#dc2626">${mrEsc(k)}: ${mrEsc(e.message)}</div>`).join('');
    const p = w.phone;
    const q = p ? (MR_QUALITY[p.quality] || MR_QUALITY.UNKNOWN) : null;
    const cats = w.cost ? Object.entries(w.cost.by_category) : [];
    body = `
      <div class="card" style="margin-bottom:12px"><div class="card-body">
        ${errs}
        ${p ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px">
          ${mrStat('Number', mrEsc(p.number || '—'), p.name || '')}
          ${mrStat('Quality rating', mrChip(q[0], mrEsc(p.quality || 'UNKNOWN')), q[1])}
          ${mrStat('Daily message limit', mrEsc(MR_TIERS[p.daily_limit] || p.daily_limit || '—'))}
          ${mrStat('Status', mrEsc(p.status || '—'))}
        </div>` : ''}
        <div style="font-weight:600;margin:16px 0 8px">${mrEsc(w.range.since)} → ${mrEsc(w.range.until)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
          ${mrStat('Messages sent', mrNum(w.messages?.sent))}
          ${mrStat('Delivered', mrNum(w.messages?.delivered))}
          ${mrStat('Charged messages', mrNum(w.cost?.messages))}
          ${mrStat('WhatsApp cost', w.cost ? mrMoney(w.cost.total, w.cost.currency) : '—')}
        </div>
        ${cats.length ? `<div style="margin-top:12px;font-size:13px"><b>Cost by type:</b> ${cats.map(([k, v]) => `${mrEsc(k)} ${mrMoney(v.cost, w.cost.currency)} (${mrNum(v.volume)})`).join(' · ')}</div>` : ''}
        ${w.messages?.daily?.length ? `<details style="margin-top:12px"><summary style="cursor:pointer">Day by day</summary>
          <div style="overflow-x:auto"><table class="table" style="width:100%;font-size:13px;margin-top:8px"><thead><tr><th>Date</th><th>Sent</th><th>Delivered</th></tr></thead><tbody>
          ${w.messages.daily.map(d => `<tr><td>${mrEsc(d.date)}</td><td>${mrNum(d.sent)}</td><td>${mrNum(d.delivered)}</td></tr>`).join('')}
          </tbody></table></div></details>` : ''}
        <div class="form-hint" style="margin-top:12px">${mrEsc(s.guide.whatsappCredit.note)} <a class="btn btn-secondary btn-sm" style="margin-left:6px" href="${mrEsc(s.guide.whatsappCredit.url)}" target="_blank" rel="noopener noreferrer">Pay / manage on Meta ↗</a></div>
      </div></div>`;
  }
  return `<div style="font-weight:700;font-size:16px;margin:22px 0 10px">💬 WhatsApp</div>${body}`;
}

function renderMetaReports() {
  const root = document.getElementById('mr-root');
  if (!root || !MrState.status) return;
  const opt = (v, l) => `<option value="${v}" ${MrState.range === v ? 'selected' : ''}>${l}</option>`;
  root.innerHTML = `
    <div style="max-width:980px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div class="form-hint">Numbers come straight from Meta using your own connection. Results are kept for 10 minutes.</div>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="form-select" onchange="mrSetRange(this.value)" aria-label="Date range">
            ${opt('7d', 'Last 7 days')}${opt('30d', 'Last 30 days')}${opt('month', 'This month')}${opt('90d', 'Last 90 days')}
          </select>
          <button class="btn btn-secondary btn-sm" onclick="loadMetaReports(true)">↻ Refresh</button>
        </div>
      </div>
      ${renderMrPermissions()}
      ${renderMrAds()}
      ${renderMrWhatsApp()}
    </div>`;
}

window.loadMetaReports = loadMetaReports;
window.mrSetRange = mrSetRange;
window.mrToggleAccountPicker = mrToggleAccountPicker;
window.mrSaveAdAccounts = mrSaveAdAccounts;
