// Social-Nexus app — WhatsApp broadcasts: one message to many people, in 3 steps.
// One of the files in public/js, loaded in order by index.html (shared global scope).
//
//   1. Who gets it   all contacts / a tag / a spreadsheet — with the real count
//   2. Message       an approved template (fill-ins: the person's name or a fixed text),
//                    or free text with WhatsApp Web
//   3. Send          test to yourself, then send; progress and results; history

const BC = {
  setup: null, templates: [], history: [],
  audience: { type: 'all', tag: '', contacts: [], fileName: '' },
  count: null,
  template: null, params: [], text: '', title: '',
  current: null, poll: null,
};

async function loadBroadcastPage() {
  const root = document.getElementById('bc-root');
  if (!root) return;
  root.innerHTML = '<div class="state-loading"><span class="spinner lg"></span><div>Loading…</div></div>';
  try {
    const [setup, tpl, history] = await Promise.all([
      api('GET', '/api/lead-pipeline/whatsapp/broadcasts/setup'),
      api('GET', '/api/lead-pipeline/whatsapp/templates').catch(() => ({ templates: [] })),
      api('GET', '/api/lead-pipeline/whatsapp/broadcasts').catch(() => []),
    ]);
    BC.setup = setup;
    BC.templates = (tpl.templates || []).filter(t => t.status === 'APPROVED');
    BC.history = Array.isArray(history) ? history : (history.broadcasts || []);
    // A template chosen on the Templates screen ("Use in broadcast")
    if (BC.pendingTemplate) { pickTemplate(BC.pendingTemplate.name, BC.pendingTemplate.language); BC.pendingTemplate = null; }
    renderBroadcastPage();
    refreshAudienceCount();
  } catch (err) {
    root.innerHTML = `<div class="state-error">Couldn’t load broadcasts: ${escapeHtml(err.message)} <button class="btn btn-secondary btn-sm" onclick="loadBroadcastPage()">Try again</button></div>`;
  }
}

function pickTemplate(name, language) {
  const t = BC.templates.find(x => x.name === name && (!language || x.language === language));
  BC.template = t || null;
  const n = t ? (t.body_text.match(/\{\{\d+\}\}/g) || []).length : 0;
  BC.params = Array.from({ length: n }, (_, i) => {
    const f = t.fields?.[i];
    return f?.key === 'name' || /name/i.test(f?.label || '') ? { source: 'name' } : { source: 'text', value: f?.example || '' };
  });
}

const bcEngineWeb = () => BC.setup?.engine === 'evolution';

function renderBroadcastPage() {
  const root = document.getElementById('bc-root');
  const s = BC.setup || {};
  const tags = s.tags || [];
  const a = BC.audience;
  root.innerHTML = `
    <div class="bc-layout">
      <div class="bc-main">
        <p class="panel-desc" style="margin-bottom:14px">Send one message to many people. People who replied STOP are always left out.</p>
        ${!s.connected ? `<div class="callout callout-warn"><b>Connect WhatsApp first.</b> You can prepare the broadcast now. <button class="btn btn-secondary btn-sm" onclick="navigateTo('leads-settings')">Open WhatsApp setup</button></div>` : ''}
        ${s.licensed === false ? `<div class="callout callout-warn"><b>Sending broadcasts needs an active licence.</b> You can prepare everything now and send once it’s active. <button class="btn btn-secondary btn-sm" onclick="openSettings('license')">Open Licence</button></div>` : ''}

        <div class="settings-section wa-step">
          <div class="settings-section-header"><div class="wa-step-head"><span class="wa-step-num">1</span><div>
            <div class="settings-section-title">Who gets it</div></div></div>
            <span class="status-pill" id="bc-count-pill">…</span>
          </div>
          <div class="card-body bot-radios">
            <label class="bot-radio"><input type="radio" name="bc-aud" value="all" ${a.type === 'all' ? 'checked' : ''}/><span><b>All my WhatsApp contacts</b> (${s.contacts_with_phone || 0})</span></label>
            <label class="bot-radio"><input type="radio" name="bc-aud" value="tag" ${a.type === 'tag' ? 'checked' : ''} ${tags.length ? '' : 'disabled'}/><span><b>Contacts with a tag</b>
              <select class="form-select bc-inline-select" id="bc-tag" ${tags.length ? '' : 'disabled'}>${tags.map(t => `<option value="${escapeHtml(t.tag)}" ${a.tag === t.tag ? 'selected' : ''}>${escapeHtml(t.tag)} (${t.count})</option>`).join('') || '<option>No tags yet</option>'}</select></span></label>
            <label class="bot-radio"><input type="radio" name="bc-aud" value="list" ${a.type === 'list' ? 'checked' : ''}/><span><b>People in a spreadsheet</b> — Excel or CSV with a “Phone” column (and “Name” if you have it)
              <span class="bc-file-row">
                <label class="btn btn-secondary btn-sm">Choose file… <input type="file" id="bc-file" accept=".xlsx,.csv,text/csv" hidden /></label>
                <span class="form-hint" id="bc-file-name">${a.fileName ? `${escapeHtml(a.fileName)} · ${a.contacts.length} rows` : ''}</span>
              </span></span></label>
            <div class="form-hint" id="bc-count-detail"></div>
          </div>
        </div>

        <div class="settings-section wa-step">
          <div class="settings-section-header"><div class="wa-step-head"><span class="wa-step-num">2</span><div>
            <div class="settings-section-title">Message</div>
            <div class="settings-section-sub">${bcEngineWeb() ? 'You’re connected with WhatsApp Web, so you can write any text. <code>{{name}}</code> becomes each person’s first name.' : 'WhatsApp only lets businesses start a conversation with a template Meta has approved.'}</div></div></div>
          </div>
          <div class="card-body">
            ${bcEngineWeb() ? `
              <textarea class="form-textarea" id="bc-text" rows="5" maxlength="1000" placeholder="Hi {{name}}, …">${escapeHtml(BC.text)}</textarea>
            ` : BC.templates.length ? `
              <div class="form-group">
                <label class="form-label" for="bc-template">Template</label>
                <select class="form-select" id="bc-template">
                  <option value="">Choose a template…</option>
                  ${BC.templates.map(t => `<option value="${escapeHtml(t.name)}|${escapeHtml(t.language)}" ${BC.template?.name === t.name && BC.template?.language === t.language ? 'selected' : ''}>${escapeHtml(tplTitle(t.name))} · ${escapeHtml(t.language)}</option>`).join('')}
                </select>
              </div>
              <div id="bc-params">${renderBcParams()}</div>
            ` : `
              <div class="tpl-empty" style="padding:20px">
                <div class="tpl-empty-title">No approved templates yet</div>
                <div class="form-hint">Make one in Templates. Meta usually approves within minutes.</div>
                <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navigateTo('leads-templates')">Open Templates</button>
              </div>`}
          </div>
        </div>

        <div class="settings-section wa-step">
          <div class="settings-section-header"><div class="wa-step-head"><span class="wa-step-num">3</span><div>
            <div class="settings-section-title">Send</div></div></div></div>
          <div class="card-body">
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label" for="bc-title">Name (for your history)</label>
                <input class="form-input" id="bc-title" maxlength="120" value="${escapeHtml(BC.title)}" placeholder="e.g. Diwali offer — November" />
              </div>
              <div class="form-group">
                <label class="form-label" for="bc-test-to">Send a test to</label>
                <div class="wa-inline">
                  <input class="form-input" id="bc-test-to" value="${escapeHtml(s.test_recipient || '')}" placeholder="Your own number, e.g. 9876543210" />
                  <button class="btn btn-secondary btn-sm" id="bc-test-btn" ${s.licensed === false ? 'disabled title="Needs an active licence"' : ''}>Send test</button>
                </div>
              </div>
            </div>
            <div id="bc-progress"></div>
            <div class="settings-actions">
              <button class="btn btn-primary" id="bc-send-btn" ${s.connected && s.licensed !== false ? '' : 'disabled'}>Send broadcast</button>
            </div>
          </div>
        </div>

        ${renderBcHistory()}
      </div>

      <aside class="tpl-phone" aria-label="Preview">
        <div class="bot-try-head"><div class="bot-try-title">Preview</div><div class="form-hint">How it looks for one person.</div></div>
        <div class="tpl-phone-chat" id="bc-preview"></div>
      </aside>
    </div>`;
  wireBroadcastPage();
  renderBcPreview();
  if (BC.current?.running) showBcProgress(BC.current);
}

function renderBcParams() {
  const t = BC.template;
  if (!t) return '';
  if (!BC.params.length) return '<div class="form-hint">This template has no fill-ins.</div>';
  return BC.params.map((p, i) => {
    const label = t.fields?.[i]?.label || `Fill-in ${i + 1}`;
    return `
      <div class="form-group bc-param" data-i="${i}">
        <label class="form-label"><code>{{${i + 1}}}</code> ${escapeHtml(label)}</label>
        <div class="wa-inline">
          <select class="form-select bc-param-src" style="max-width:220px">
            <option value="name" ${p.source === 'name' ? 'selected' : ''}>Each person’s first name</option>
            <option value="text" ${p.source === 'text' ? 'selected' : ''}>The same text for everyone</option>
          </select>
          <input class="form-input bc-param-val" value="${escapeHtml(p.value || '')}" placeholder="Type it here" ${p.source === 'name' ? 'hidden' : ''} maxlength="200" />
        </div>
      </div>`;
  }).join('');
}

function renderBcHistory() {
  if (!BC.history.length) return '';
  const label = { completed: ['ok', 'Sent'], sending: ['warn', 'Sending…'], stopped: ['warn', 'Stopped'], failed: ['bad', 'Not sent'] };
  return `
    <div class="settings-section">
      <div class="settings-section-header"><div class="settings-section-title">Past broadcasts</div></div>
      <div class="bc-history">
        ${BC.history.slice(0, 20).map(b => {
          const [tone, text] = label[b.status] || ['off', b.status];
          return `<div class="bc-history-row">
            <div><div class="tpl-card-name" style="font-size:14px">${escapeHtml(b.title)}</div>
              <div class="form-hint">${new Date(b.created_at * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · ${b.template_name ? escapeHtml(tplTitle(b.template_name)) : 'Own text'}</div></div>
            <div class="bc-history-nums"><b>${b.sent_count || 0}</b> sent${b.failed_count ? ` · <b>${b.failed_count}</b> not sent` : ''}${b.skipped_count ? ` · ${b.skipped_count} left out` : ''}</div>
            <span class="status-pill ${tone}"><span class="status-dot-sm ${tone}"></span>${text}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function readBcForm() {
  const aud = document.querySelector('input[name="bc-aud"]:checked')?.value || 'all';
  BC.audience.type = aud;
  BC.audience.tag = document.getElementById('bc-tag')?.value || '';
  BC.title = document.getElementById('bc-title')?.value || '';
  if (bcEngineWeb()) BC.text = document.getElementById('bc-text')?.value || '';
  document.querySelectorAll('.bc-param').forEach(el => {
    const i = Number(el.dataset.i);
    BC.params[i] = { source: el.querySelector('.bc-param-src').value, value: el.querySelector('.bc-param-val').value };
  });
}

function bcMessage() {
  if (bcEngineWeb()) return { text: BC.text };
  const t = BC.template;
  return t ? { template: { name: t.name, language: t.language, body: t.body_text, var_count: BC.params.length, params: BC.params } } : {};
}

function bcAudiencePayload() {
  const a = BC.audience;
  return a.type === 'list' ? { type: 'list', contacts: a.contacts } : a.type === 'tag' ? { type: 'tag', tag: a.tag } : { type: 'all' };
}

let bcCountTimer = null;
function refreshAudienceCount() {
  clearTimeout(bcCountTimer);
  bcCountTimer = setTimeout(async () => {
    const pill = document.getElementById('bc-count-pill');
    const detail = document.getElementById('bc-count-detail');
    if (BC.audience.type === 'list' && !BC.audience.contacts.length) {
      BC.count = { count: 0 };
      if (pill) { pill.className = 'status-pill'; pill.textContent = 'Choose a file'; }
      if (detail) detail.textContent = '';
      return;
    }
    try {
      const r = await api('POST', '/api/lead-pipeline/whatsapp/broadcasts/audience', { audience: bcAudiencePayload() });
      BC.count = r;
      if (pill) { pill.className = `status-pill ${r.count ? 'ok' : 'warn'}`; pill.innerHTML = `<span class="status-dot-sm ${r.count ? 'ok' : 'warn'}"></span>${r.count} ${r.count === 1 ? 'person' : 'people'}`; }
      const left = [];
      if (r.skipped.opted_out) left.push(`${r.skipped.opted_out} replied STOP`);
      if (r.skipped.invalid) left.push(`${r.skipped.invalid} without a valid number`);
      if (r.skipped.duplicate) left.push(`${r.skipped.duplicate} listed twice`);
      if (detail) detail.textContent = [left.length ? `Left out: ${left.join(', ')}.` : '', r.too_many ? `Only the first ${r.count} will get it (limit per broadcast).` : ''].filter(Boolean).join(' ');
    } catch (err) { if (detail) detail.textContent = err.message; }
  }, 250);
}

function renderBcPreview() {
  const box = document.getElementById('bc-preview');
  if (!box) return;
  const firstName = 'Priya';
  if (bcEngineWeb()) {
    const text = (BC.text || '').replace(/\{\{\s*name\s*\}\}/gi, firstName);
    box.innerHTML = tplPreviewHtml({ body: text || '' });
    return;
  }
  const t = BC.template;
  if (!t) { box.innerHTML = '<div class="form-hint" style="margin:auto">Choose a template to see it here.</div>'; return; }
  const fields = BC.params.map((p, i) => ({ label: t.fields?.[i]?.label || `Fill-in ${i + 1}`, example: p.source === 'name' ? firstName : (p.value || `[${t.fields?.[i]?.label || `fill-in ${i + 1}`}]`) }));
  box.innerHTML = tplPreviewHtml({ header: t.header_text, body: t.body_text, footer: t.footer_text, buttons: t.buttons, fields });
}

function wireBroadcastPage() {
  const root = document.getElementById('bc-root');
  root.querySelector('.bc-main').addEventListener('change', (e) => {
    if (e.target.id === 'bc-file') return;
    if (e.target.id === 'bc-template') {
      const [name, language] = e.target.value.split('|');
      pickTemplate(name, language);
      document.getElementById('bc-params').innerHTML = renderBcParams();
    }
    if (e.target.classList.contains('bc-param-src')) e.target.closest('.bc-param').querySelector('.bc-param-val').hidden = e.target.value === 'name';
    readBcForm();
    if (e.target.name === 'bc-aud' || e.target.id === 'bc-tag') refreshAudienceCount();
    renderBcPreview();
  });
  root.querySelector('.bc-main').addEventListener('input', () => { readBcForm(); renderBcPreview(); });

  document.getElementById('bc-file').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await fetch('/api/lead-pipeline/whatsapp/broadcasts/read-file', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Couldn’t read the file.');
      BC.audience = { type: 'list', tag: '', contacts: data.contacts, fileName: file.name };
      document.querySelector('input[name="bc-aud"][value="list"]').checked = true;
      document.getElementById('bc-file-name').textContent = `${file.name} · ${data.contacts.length} rows`;
      refreshAudienceCount();
    } catch (err) { toast(err.message, 'error'); }
  };

  document.getElementById('bc-test-btn').onclick = async (ev) => {
    readBcForm();
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const r = await api('POST', '/api/lead-pipeline/whatsapp/broadcasts/test', { to: document.getElementById('bc-test-to').value, message: bcMessage() });
      toast(`Test sent to ${r.to}. Check your WhatsApp.`, 'success');
    } catch (err) { toast(err.message, 'error', 7000); }
    finally { btn.disabled = false; }
  };

  document.getElementById('bc-send-btn').onclick = sendBroadcastNow;
}

async function sendBroadcastNow() {
  readBcForm();
  const n = BC.count?.count || 0;
  if (!n) return toast('Nobody to send to yet. Choose who gets it.', 'warning');
  const msg = bcMessage();
  if (!bcEngineWeb() && !msg.template) return toast('Choose a template first.', 'warning');
  if (bcEngineWeb() && !BC.text.trim()) return toast('Write the message first.', 'warning');
  if (!(await askConfirm(`Send this to ${n} ${n === 1 ? 'person' : 'people'} now? This can’t be undone.`, 'Send'))) return;
  const btn = document.getElementById('bc-send-btn');
  btn.disabled = true;
  try {
    const b = await api('POST', '/api/lead-pipeline/whatsapp/broadcasts', { title: BC.title, audience: bcAudiencePayload(), message: msg });
    BC.current = b;
    showBcProgress(b);
    pollBroadcast(b.id);
  } catch (err) {
    toast(err.message, 'error', 7000);
    btn.disabled = false;
  }
}

function showBcProgress(b) {
  const box = document.getElementById('bc-progress');
  if (!box) return;
  const done = (b.sent_count || 0) + (b.failed_count || 0);
  const pct = b.total_recipients ? Math.round((done / b.total_recipients) * 100) : 0;
  const finished = !b.running && b.status !== 'sending';
  const failures = b.results?.failures || [];
  box.innerHTML = `
    <div class="bc-progress">
      <div class="bc-progress-head">
        <b>${finished ? (b.status === 'stopped' ? 'Stopped' : 'Done') : 'Sending…'}</b>
        <span>${b.sent_count || 0} sent${b.failed_count ? ` · ${b.failed_count} not sent` : ''} · ${b.total_recipients} total</span>
        ${!finished ? `<button class="btn btn-ghost btn-ghost-danger btn-sm" onclick="stopBroadcast(${Number(b.id)})">Stop</button>` : ''}
      </div>
      <div class="bc-bar"><div style="width:${pct}%"></div></div>
      ${!finished ? '<div class="form-hint">You can leave this screen; sending carries on while Social-Nexus is open.</div>' : ''}
      ${failures.length ? `<details class="settings-more"><summary>Not sent (${b.failed_count})</summary>
        <ul class="bc-fail">${failures.map(f => `<li><b>${escapeHtml(f.name || '+' + f.phone)}</b> — ${escapeHtml(f.error)}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  const btn = document.getElementById('bc-send-btn');
  if (btn) btn.disabled = !finished;
}

function pollBroadcast(id) {
  clearInterval(BC.poll);
  BC.poll = setInterval(async () => {
    try {
      const b = await api('GET', `/api/lead-pipeline/whatsapp/broadcasts/${id}`);
      BC.current = b;
      if (State.currentPage === 'leads-broadcast') showBcProgress(b);
      if (!b.running && b.status !== 'sending') {
        clearInterval(BC.poll);
        toast(`Broadcast finished: ${b.sent_count} sent${b.failed_count ? `, ${b.failed_count} not sent` : ''}.`, b.failed_count ? 'warning' : 'success', 7000);
        BC.history = await api('GET', '/api/lead-pipeline/whatsapp/broadcasts').then(r => r.broadcasts || r).catch(() => BC.history);
        if (State.currentPage === 'leads-broadcast') renderBroadcastPage();
      }
    } catch { /* try again next tick */ }
  }, 1500);
}

async function stopBroadcast(id) {
  try { await api('POST', `/api/lead-pipeline/whatsapp/broadcasts/${id}/stop`); toast('Stopping after the current message…', 'info'); }
  catch (err) { toast(err.message, 'error'); }
}

// From Templates → "Use in broadcast"
function useTemplateInBroadcast(name, language) {
  BC.pendingTemplate = { name, language };
  navigateTo('leads-broadcast');
}

window.loadBroadcastPage = loadBroadcastPage;
window.useTemplateInBroadcast = useTemplateInBroadcast;
window.stopBroadcast = stopBroadcast;
