// Social-Nexus app — SEO autopilot (server edition): Website SEO → Autopilot tab,
// and the SEO card on Home. The server re-checks the website on a schedule and
// keeps a to-do list; nothing on the website changes and nothing is posted
// without someone's OK.

State.features = State.features || null;
State.autopilot = null;

const AP_PRIORITY = { 1: { label: 'Fix first', cls: 'red' }, 2: { label: 'Important', cls: 'orange' }, 3: { label: 'Nice to have', cls: 'blue' } };

async function loadFeatures() {
  if (State.features) return State.features;
  try { State.features = await api('GET', '/api/seo/autopilot/features'); } catch { State.features = { server: false, seo_autopilot: false }; }
  // Show the server-only parts
  document.querySelectorAll('[data-server-only]').forEach(el => { el.hidden = !State.features.seo_autopilot; });
  return State.features;
}

const apWhen = (ts) => ts ? new Date(ts * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

async function loadAutopilot({ quiet = false } = {}) {
  const root = document.getElementById('seo-panel-autopilot');
  if (!root) return;
  const f = await loadFeatures();
  if (!f.seo_autopilot) { root.innerHTML = '<div class="form-hint">The SEO autopilot is part of the Social-Nexus server edition.</div>'; return; }
  if (!quiet) root.querySelector('#ap-body')?.classList.add('loading');
  try {
    State.autopilot = await api('GET', '/api/seo/autopilot');
    renderAutopilot();
    // While a check runs, look again every few seconds
    clearTimeout(State.autopilotPoll);
    if (State.autopilot.site?.last_status === 'running') State.autopilotPoll = setTimeout(() => loadAutopilot({ quiet: true }), 4000);
  } catch (err) { root.innerHTML = `<div class="state-error">${escapeHtml(err.message)}</div>`; }
}

function renderAutopilot() {
  const root = document.getElementById('seo-panel-autopilot');
  const { site, tasks, pages } = State.autopilot;
  const open = tasks.filter(t => t.status === 'open');
  const closed = tasks.filter(t => t.status !== 'open');
  const running = site?.last_status === 'running';
  const v = site?.vitals;

  root.innerHTML = `
    <div class="grid-2 ap-grid">
      <div class="card"><div class="card-header"><div class="card-title">🤖 Your website</div></div>
        <div class="card-body">
          <div class="form-hint" style="margin-bottom:12px">Social-Nexus re-checks your website by itself, lists what to do in plain words, and drafts Google posts for your OK. It never changes your website or posts on its own.</div>
          <div class="form-group"><label class="form-label" for="ap-url">Website address</label>
            <input type="url" class="form-input" id="ap-url" placeholder="yourbusiness.com" value="${escapeHtml(site?.url || '')}" /></div>
          <div class="form-group"><label class="form-label" for="ap-phrases">Phrases you want to be found for <span class="form-hint" style="display:inline">(one per line)</span></label>
            <textarea class="form-textarea" id="ap-phrases" style="min-height:70px" placeholder="interior designer in Pune&#10;office interiors Pune">${escapeHtml((site?.phrases || []).join('\n'))}</textarea></div>
          <div class="ap-row">
            <div><label class="form-label" for="ap-frequency">Check</label>
              <select class="form-select" id="ap-frequency">
                <option value="weekly" ${site?.frequency !== 'daily' ? 'selected' : ''}>every week</option>
                <option value="daily" ${site?.frequency === 'daily' ? 'selected' : ''}>every day</option>
              </select></div>
            <div><label class="form-label" for="ap-max">Pages to check</label>
              <select class="form-select" id="ap-max">${[10, 20, 50].map(n => `<option value="${n}" ${Number(site?.max_pages || 20) === n ? 'selected' : ''}>up to ${n}</option>`).join('')}</select></div>
            <div><label class="form-label" for="ap-gbp">Google post reminder</label>
              <select class="form-select" id="ap-gbp">${[[7, 'after 7 quiet days'], [14, 'after 14 quiet days'], [30, 'after 30 quiet days'], [0, 'off']].map(([n, l]) => `<option value="${n}" ${Number(site?.gbp_quiet_days ?? 7) === n ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          </div>
          <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:6px 0 12px"><input type="checkbox" id="ap-enabled" ${site?.enabled === false ? '' : 'checked'} /> Check automatically</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" id="btn-ap-save" onclick="saveAutopilotSite()">${site ? 'Save' : 'Start watching my website'}</button>
            ${site ? `<button class="btn btn-secondary" id="btn-ap-run" onclick="runAutopilotNow()" ${running ? 'disabled' : ''}>${running ? '<span class="spinner"></span> Checking…' : '🔎 Check now'}</button>` : ''}
          </div>
          ${site ? `<div class="form-hint" style="margin-top:12px">
            ${running ? 'Checking your website now. This takes a minute or two.' : site.last_status === 'error' ? `⚠️ The last check didn’t work: ${escapeHtml(site.last_error || '')}. It tries again in a few hours.` : `Last check: ${apWhen(site.last_run_at)}`}
            ${site.enabled && !running ? ` · Next: ${apWhen(site.next_run_at)}` : ''}</div>` : ''}
          ${v?.error ? `<div class="form-hint" style="margin-top:12px">⏱ Page speed: ${escapeHtml(v.error)}</div>` : ""}
          ${v && !v.error ? `<div class="ap-vitals">
            <div><b>${v.lcp_ms ? (v.lcp_ms / 1000).toFixed(1) + ' s' : '—'}</b><span>main content shows</span></div>
            <div><b>${v.cls ?? '—'}</b><span>layout shift</span></div>
            <div><b>${v.inp_ms != null ? v.inp_ms + ' ms' : '—'}</b><span>tap response</span></div>
            <div><b>${v.score != null ? v.score : '—'}</b><span>speed score</span></div>
          </div><div class="form-hint">Phone speed of your home page, from ${escapeHtml(v.source)} (Google PageSpeed Insights).</div>` : ''}
          ${pages?.length ? `<details style="margin-top:12px"><summary class="form-hint" style="cursor:pointer">${pages.length} pages checked</summary>
            <div class="ap-pages">${pages.map(p => `<div><span class="badge badge-${p.error || p.bad ? 'red' : p.warn ? 'orange' : 'green'}">${p.error ? 'error' : p.bad ? `${p.bad} to fix` : p.warn ? `${p.warn} to improve` : 'fine'}</span> <span title="${escapeHtml(p.url)}">${escapeHtml(p.title || p.url)}</span></div>`).join('')}</div></details>` : ''}
        </div>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">✅ To do</div><span class="badge badge-${open.length ? 'orange' : 'green'}">${open.length} open</span></div>
        <div class="card-body" id="ap-tasks">
          ${!site ? '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">🤖</div><div class="empty-title">Add your website to start</div><div class="empty-desc">The first check runs straight away.</div></div>'
            : !open.length ? `<div class="empty-state" style="padding:30px 0"><div class="empty-icon">🎉</div><div class="empty-title">${site.last_run_at ? 'Nothing to do right now' : 'Waiting for the first check'}</div><div class="empty-desc">${site.last_run_at ? 'New to-dos appear here after each check.' : ''}</div></div>`
            : open.map(apTaskHtml).join('')}
          ${closed.length ? `<details style="margin-top:12px"><summary class="form-hint" style="cursor:pointer">${closed.length} done or hidden in the last 2 weeks</summary>
            ${closed.map(t => `<div class="ap-closed">${t.status === 'dismissed' ? '🙈' : '✅'} ${escapeHtml(t.title)} <span class="form-hint" style="display:inline">· ${t.status === 'resolved' ? 'fixed (found on the last check)' : t.status === 'done' ? 'marked done' : 'hidden'}</span>
              <button class="btn btn-ghost btn-sm" onclick="autopilotTask(${t.id},'reopen')">Show again</button></div>`).join('')}</details>` : ''}
        </div>
      </div>
    </div>`;
}

function apTaskHtml(t) {
  const p = AP_PRIORITY[t.priority] || AP_PRIORITY[2];
  const pages = t.pages || [];
  const canDraft = /no title|no description|title is|titles are|description is|descriptions are|same title|same description|No page is about/i.test(t.title);
  return `
    <div class="ap-task">
      <div class="ap-task-head"><span class="badge badge-${p.cls}">${p.label}</span>${t.kind === 'post' ? '<span class="badge badge-blue">Needs your OK</span>' : t.kind === 'idea' ? '<span class="badge badge-blue">Idea</span>' : ''}</div>
      <div class="ap-task-title">${escapeHtml(t.title)}</div>
      <div class="ap-task-detail">${escapeHtml(t.detail || '')}</div>
      ${pages.length ? `<details><summary class="form-hint" style="cursor:pointer">${pages.length} page${pages.length === 1 ? '' : 's'}</summary>${pages.slice(0, 20).map(u => `<div class="form-hint"><a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u)}</a></div>`).join('')}</details>` : ''}
      ${t.draft && (t.draft.type === 'meta' || t.draft.type === 'page') ? apDraftHtml(t.draft) : ''}
      <div class="ap-task-actions">
        ${t.kind === 'post' && t.content_item_id ? `<button class="btn btn-primary btn-sm" onclick="navigateTo('calendar');setTimeout(()=>openContentDetail(${Number(t.content_item_id)}),500)">Review the post</button>` : ''}
        ${canDraft ? `<button class="btn btn-secondary btn-sm" id="ap-draft-${t.id}" onclick="autopilotDraft(${t.id})">✨ ${t.draft?.type ? 'Write again' : 'Write it for me'}</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="autopilotTask(${t.id},'done')">Done</button>
        <button class="btn btn-ghost btn-sm" onclick="autopilotTask(${t.id},'dismiss')" title="Hide it; it won’t come back">Not relevant</button>
      </div>
    </div>`;
}

function apCopy(text) { return `<button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(text || '')});toast('Copied','success')">📋 Copy</button>`; }

function apDraftHtml(d) {
  if (d.type === 'page') {
    return `<div class="ap-draft"><div class="form-hint">Suggested page for “${escapeHtml(d.phrase || '')}” (AI):</div>
      <div><b>Title:</b> ${escapeHtml(d.title)} ${apCopy(d.title)}</div>
      <div><b>Description:</b> ${escapeHtml(d.description)} ${apCopy(d.description)}</div>
      <div><b>Main heading:</b> ${escapeHtml(d.h1)} ${apCopy(d.h1)}</div>
      ${d.headings?.length ? `<div><b>Sections:</b> ${d.headings.map(escapeHtml).join(' · ')}</div>` : ''}
      ${d.note ? `<div class="form-hint" style="color:#b45309">⚠️ ${escapeHtml(d.note)}</div>` : ''}
      ${d.intro ? `<div style="margin-top:4px"><b>First paragraph:</b> ${escapeHtml(d.intro)} ${apCopy(d.intro)}</div>` : ''}</div>`;
  }
  return `<div class="ap-draft"><div class="form-hint">Suggestions (AI). Paste them into your website builder’s SEO settings for each page:</div>
    ${(d.pages || []).map(p => `<div class="ap-draft-page"><div class="form-hint" style="word-break:break-all">${escapeHtml(p.url)}</div>
      <div><b>Title</b> (${p.title.length}): ${escapeHtml(p.title)} ${apCopy(p.title)}</div>
      <div><b>Description</b> (${p.description.length}): ${escapeHtml(p.description)} ${apCopy(p.description)}</div></div>`).join('') || '<div class="form-hint">No pages could be read.</div>'}</div>`;
}

async function saveAutopilotSite() {
  const btn = document.getElementById('btn-ap-save');
  const first = !State.autopilot?.site;
  btn.disabled = true;
  try {
    await api('PUT', '/api/seo/autopilot/site', {
      url: document.getElementById('ap-url').value,
      phrases: document.getElementById('ap-phrases').value,
      frequency: document.getElementById('ap-frequency').value,
      max_pages: Number(document.getElementById('ap-max').value),
      gbp_quiet_days: Number(document.getElementById('ap-gbp').value),
      enabled: document.getElementById('ap-enabled').checked,
    });
    if (first) await api('POST', '/api/seo/autopilot/run');
    toast(first ? 'Saved. The first check has started.' : 'Saved.', 'success');
    await loadAutopilot();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
}

async function runAutopilotNow() {
  try {
    const r = await api('POST', '/api/seo/autopilot/run');
    toast(r.running ? 'A check is already running.' : 'Checking your website…', 'info');
    await loadAutopilot();
  } catch (err) { toast(err.message, 'error'); }
}

async function autopilotTask(id, action) {
  try { await api('POST', `/api/seo/autopilot/tasks/${id}/${action}`); await loadAutopilot({ quiet: true }); loadSeoHomeCard(); }
  catch (err) { toast(err.message, 'error'); }
}

async function autopilotDraft(id) {
  const btn = document.getElementById(`ap-draft-${id}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing… (up to a minute)'; }
  try { await api('POST', `/api/seo/autopilot/tasks/${id}/draft`); await loadAutopilot({ quiet: true }); }
  catch (err) { toast(err.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = '✨ Write it for me'; } }
}

// ── Home: SEO card ──────────────────────────────────────────────────────────
async function loadSeoHomeCard() {
  const card = document.getElementById('dash-seo-card');
  if (!card) return;
  const f = await loadFeatures();
  if (!f.seo_autopilot) { card.hidden = true; return; }
  card.hidden = false;
  const body = document.getElementById('dash-seo-body');
  const badge = document.getElementById('dash-seo-badge');
  try {
    const s = await api('GET', '/api/seo/autopilot/summary');
    if (!s.site) {
      badge.textContent = '';
      body.innerHTML = '<p class="dash-seo-text">Add your website and Social-Nexus checks it for Google by itself, then tells you what to fix.</p>';
      return;
    }
    badge.textContent = s.open ? `${s.open} to do` : 'All good';
    badge.className = `badge badge-${s.urgent ? 'red' : s.open ? 'orange' : 'green'}`;
    body.innerHTML = s.top.length
      ? `<ul class="dash-seo-list">${s.top.map(t => `<li><span class="badge badge-${(AP_PRIORITY[t.priority] || AP_PRIORITY[2]).cls}">${(AP_PRIORITY[t.priority] || AP_PRIORITY[2]).label}</span> ${escapeHtml(t.title)}</li>`).join('')}</ul>`
      : `<p class="dash-seo-text">Nothing to do. Last check: ${apWhen(s.site.last_run_at)}.</p>`;
  } catch { body.innerHTML = '<p class="dash-seo-text">Couldn’t load the SEO to-do list.</p>'; }
}
