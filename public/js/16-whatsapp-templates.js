// Social-Nexus app — WhatsApp templates: see yours, write new ones, send to Meta.
// One of the files in public/js, loaded in order by index.html (shared global scope).
//
// WhatsApp only lets a business message someone first (or send a broadcast) with
// a template Meta has approved. Here the owner writes it in plain words: fill-ins
// such as "Customer's name" are inserted with a button and become {{1}}, {{2}}…

const TplState = { list: [], connected: false, filter: 'all', loading: false, error: '', editing: null };

const TPL_LANGS = [
  ['en', 'English'], ['en_US', 'English (US)'], ['hi', 'Hindi'], ['mr', 'Marathi'], ['gu', 'Gujarati'],
  ['ta', 'Tamil'], ['te', 'Telugu'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['bn', 'Bengali'], ['pa', 'Punjabi'], ['ur', 'Urdu'],
];
const TPL_FILLS = [
  { key: 'name', label: 'Customer’s name', example: 'Priya' },
  { key: 'offer', label: 'Offer', example: '20% off' },
  { key: 'date', label: 'Date', example: '25 December' },
  { key: 'order', label: 'Order number', example: 'A-1043' },
];
const TPL_STARTERS = {
  offer: { title: 'Festival offer', category: 'MARKETING', header: 'A treat for you', body: 'Hi {{1}}, this festive season enjoy {{2}} on everything at our store. Valid till {{3}}. Reply STOP to stop these messages.', fields: [TPL_FILLS[0], TPL_FILLS[1], TPL_FILLS[2]], buttons: [{ type: 'QUICK_REPLY', text: 'I’m interested' }] },
  order: { title: 'Order update', category: 'UTILITY', header: '', body: 'Hi {{1}}, your order {{2}} is ready. You can pick it up today or reply here to arrange delivery.', fields: [TPL_FILLS[0], TPL_FILLS[3]], buttons: [] },
  reminder: { title: 'Appointment reminder', category: 'UTILITY', header: '', body: 'Hi {{1}}, a reminder of your appointment on {{2}}. Reply YES to confirm or NO to change it.', fields: [TPL_FILLS[0], { key: 'date', label: 'Date and time', example: '25 Dec, 4 pm' }], buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }, { type: 'QUICK_REPLY', text: 'No' }] },
  stock: { title: 'Back in stock', category: 'MARKETING', header: '', body: 'Good news {{1}}! {{2}} is back in stock. Order today before it sells out again.', fields: [TPL_FILLS[0], { key: 'product', label: 'Product', example: 'Kaju katli' }], buttons: [] },
};

const tplSlug = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, '').trim().replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 60);
const tplTitle = (name) => String(name || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const tplStatus = (s) => ({
  APPROVED: ['ok', 'Approved'], PENDING: ['warn', 'Waiting for Meta'], IN_APPEAL: ['warn', 'Appeal in progress'],
  REJECTED: ['bad', 'Rejected'], PAUSED: ['bad', 'Paused by Meta'], DISABLED: ['bad', 'Disabled'],
}[s] || ['off', s || 'Unknown']);

async function loadWhatsAppTemplates(force = false) {
  const root = document.getElementById('tpl-root');
  if (!root) return;
  TplState.loading = true; TplState.error = '';
  if (!TplState.editing) renderTemplatesPage();
  try {
    const r = await api('GET', `/api/lead-pipeline/whatsapp/templates${force ? '?forceRefresh=1' : ''}`);
    TplState.connected = !!r.connected;
    TplState.list = r.templates || [];
    if (!r.success && r.error) TplState.error = r.error;
  } catch (err) { TplState.error = err.message; }
  TplState.loading = false;
  if (!TplState.editing) renderTemplatesPage();
}

function renderTemplatesPage() {
  const root = document.getElementById('tpl-root');
  if (!root) return;
  const counts = { all: TplState.list.length, APPROVED: 0, waiting: 0, REJECTED: 0 };
  for (const t of TplState.list) {
    if (t.status === 'APPROVED') counts.APPROVED++;
    else if (['PENDING', 'IN_APPEAL'].includes(t.status)) counts.waiting++;
    else counts.REJECTED++;
  }
  const shown = TplState.list.filter(t => TplState.filter === 'all' ? true
    : TplState.filter === 'waiting' ? ['PENDING', 'IN_APPEAL'].includes(t.status)
    : TplState.filter === 'REJECTED' ? !['APPROVED', 'PENDING', 'IN_APPEAL'].includes(t.status)
    : t.status === TplState.filter);

  root.innerHTML = `
    <div class="tpl-head">
      <p class="panel-desc">WhatsApp lets you message someone first, or send a broadcast, only with a template Meta has approved. Replies to customers who wrote to you in the last 24 hours don’t need one.</p>
      <div class="tpl-head-actions">
        <button class="btn btn-secondary" onclick="loadWhatsAppTemplates(true)" ${TplState.loading ? 'disabled' : ''}>${TplState.loading ? 'Loading…' : 'Refresh'}</button>
        <button class="btn btn-primary" onclick="openTemplateEditor()" ${TplState.connected ? '' : 'disabled title="Connect WhatsApp first"'}>+ New template</button>
      </div>
    </div>
    ${!TplState.connected && !TplState.loading ? `
      <div class="callout callout-warn">
        <b>Connect WhatsApp first.</b> Templates live in your WhatsApp Business account, so Social-Nexus needs your access token and Business Account ID.
        <button class="btn btn-secondary btn-sm" onclick="navigateTo('leads-settings')">Open WhatsApp setup</button>
      </div>` : ''}
    ${TplState.error && TplState.connected ? `<div class="state-error">${escapeHtml(TplState.error)}</div>` : ''}
    ${TplState.list.length ? `
      <div class="designer-chips tpl-filters" role="tablist">
        ${[['all', 'All'], ['APPROVED', 'Approved'], ['waiting', 'Waiting'], ['REJECTED', 'Rejected']].map(([k, l]) =>
          `<button class="designer-chip ${TplState.filter === k ? 'on' : ''}" onclick="TplState.filter='${k}';renderTemplatesPage()">${l} <span class="tpl-count">${counts[k] ?? 0}</span></button>`).join('')}
      </div>` : ''}
    <div class="tpl-grid">
      ${TplState.loading && !TplState.list.length ? '<div class="state-loading"><span class="spinner lg"></span><div>Loading your templates…</div></div>' : ''}
      ${!TplState.loading && TplState.connected && !TplState.list.length && !TplState.error ? `
        <div class="tpl-empty">
          <div class="tpl-empty-title">No templates yet</div>
          <div class="form-hint">Start from an idea — you can change every word:</div>
          <div class="designer-chips" style="justify-content:center;margin-top:10px">
            ${Object.entries(TPL_STARTERS).map(([k, s]) => `<button class="designer-chip" onclick="openTemplateEditor('${k}')">${escapeHtml(s.title)}</button>`).join('')}
          </div>
        </div>` : ''}
      ${shown.map(tplCard).join('')}
    </div>`;
}

function tplPreviewHtml({ header, body, footer, buttons, fields }) {
  const filled = escapeHtml(body || '').replace(/\{\{(\d+)\}\}/g, (m, n) => {
    const f = (fields || [])[Number(n) - 1];
    return `<span class="tpl-fill" title="${escapeHtml(f?.label || `Fill-in ${n}`)}">${escapeHtml(f?.example || f?.label || m)}</span>`;
  });
  return `
    <div class="tpl-bubble">
      ${header ? `<div class="tpl-bubble-head">${escapeHtml(header)}</div>` : ''}
      <div class="tpl-bubble-body">${filled || '<span class="form-hint">Your message appears here</span>'}</div>
      ${footer ? `<div class="tpl-bubble-foot">${escapeHtml(footer)}</div>` : ''}
    </div>
    ${(buttons || []).filter(b => b.text).map(b => `<div class="tpl-bubble-btn">${b.type === 'URL' ? '↗ ' : b.type === 'PHONE_NUMBER' ? '☎ ' : '↩ '}${escapeHtml(b.text)}</div>`).join('')}`;
}

function tplCard(t) {
  const [tone, label] = tplStatus(t.status);
  return `
    <div class="tpl-card">
      <div class="tpl-card-head">
        <div>
          <div class="tpl-card-name">${escapeHtml(tplTitle(t.name))}</div>
          <div class="form-hint">${escapeHtml(t.category === 'MARKETING' ? 'Offers & news' : t.category === 'UTILITY' ? 'Updates & reminders' : (t.category || ''))} · ${escapeHtml((TPL_LANGS.find(l => l[0] === t.language) || [, t.language])[1])}</div>
        </div>
        <span class="status-pill ${tone}"><span class="status-dot-sm ${tone}"></span>${escapeHtml(label)}</span>
      </div>
      <div class="tpl-card-preview">${tplPreviewHtml({ header: t.header_text, body: t.body_text, footer: t.footer_text, buttons: t.buttons, fields: t.fields })}</div>
      ${t.rejected_reason ? `<div class="form-hint tpl-reason">Meta’s reason: ${escapeHtml(String(t.rejected_reason).replace(/_/g, ' ').toLowerCase())}. Try “Copy as new” and change the wording.</div>` : ''}
      ${t.status === 'PENDING' ? '<div class="form-hint">Meta usually decides within minutes, sometimes up to a day. Click Refresh to check.</div>' : ''}
      <div class="tpl-card-actions">
        ${t.status === 'APPROVED' ? `<button class="btn btn-primary btn-sm" onclick="useTemplateInBroadcast(${jsAttr(t.name)}, ${jsAttr(t.language)})">Use in broadcast</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="copyTemplateAsNew(${jsAttr(t.name)}, ${jsAttr(t.language)})">Copy as new</button>
        <button class="btn btn-ghost btn-ghost-danger btn-sm" onclick="deleteWhatsAppTemplate(${jsAttr(t.name)}, ${jsAttr(t.id || '')}, ${jsAttr(t.language)})">Delete</button>
      </div>
    </div>`;
}

// ── Editor ───────────────────────────────────────────────────────────────────

function openTemplateEditor(starterKey = null, from = null) {
  const s = from || (starterKey ? TPL_STARTERS[starterKey] : null) || { title: '', category: 'MARKETING', header: '', body: '', fields: [], buttons: [] };
  TplState.editing = {
    title: s.title || '', category: s.category || 'MARKETING', language: s.language || 'en',
    header: s.header || '', body: s.body || '', footer: s.footer || '',
    fields: (s.fields || []).map(f => ({ ...f })), buttons: (s.buttons || []).map(b => ({ ...b })),
  };
  const root = document.getElementById('tpl-root');
  const e = TplState.editing;
  root.innerHTML = `
    <div class="tpl-editor">
      <div class="tpl-editor-form">
        <div class="tpl-editor-top">
          <button class="btn btn-ghost btn-sm" onclick="closeTemplateEditor()">‹ Back to templates</button>
          ${!from && !starterKey ? `<div class="designer-chips">${Object.entries(TPL_STARTERS).map(([k, st]) => `<button class="designer-chip" onclick="openTemplateEditor('${k}')">${escapeHtml(st.title)}</button>`).join('')}</div>` : ''}
        </div>

        <div class="settings-section">
          <div class="card-body">
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label" for="tpl-title">Template name</label>
                <input class="form-input" id="tpl-title" value="${escapeHtml(e.title)}" placeholder="e.g. Diwali offer" maxlength="60" />
                <div class="form-hint" id="tpl-slug"></div>
              </div>
              <div class="form-group">
                <label class="form-label" for="tpl-lang">Language</label>
                <select class="form-select" id="tpl-lang">${TPL_LANGS.map(([c, n]) => `<option value="${c}" ${e.language === c ? 'selected' : ''}>${n}</option>`).join('')}</select>
              </div>
            </div>
            <div class="form-group">
              <div class="form-label">What is it for?</div>
              <div class="bot-radios">
                <label class="bot-radio"><input type="radio" name="tpl-cat" value="MARKETING" ${e.category === 'MARKETING' ? 'checked' : ''}/><span><b>Offers &amp; news</b> — sales, new products, festival wishes. Meta charges more for these and people can block them.</span></label>
                <label class="bot-radio"><input type="radio" name="tpl-cat" value="UTILITY" ${e.category === 'UTILITY' ? 'checked' : ''}/><span><b>Updates &amp; reminders</b> — about something the customer asked for: an order, an appointment, a payment. Meta rejects these if they contain offers.</span></label>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="tpl-header">Title <span class="form-hint" style="display:inline">(optional, bold, max 60)</span></label>
              <input class="form-input" id="tpl-header" value="${escapeHtml(e.header)}" maxlength="60" placeholder="e.g. A treat for you" />
            </div>
            <div class="form-group">
              <label class="form-label" for="tpl-body">Message</label>
              <textarea class="form-textarea" id="tpl-body" rows="5" maxlength="1024" placeholder="Hi … write your message here">${escapeHtml(e.body)}</textarea>
              <div class="tpl-fill-bar">
                <span class="form-hint" style="margin:0">Add a fill-in:</span>
                ${TPL_FILLS.map((f, i) => `<button type="button" class="designer-chip" data-fill="${i}">${escapeHtml(f.label)}</button>`).join('')}
                <button type="button" class="designer-chip" data-fill="custom">Other…</button>
                <span class="form-hint" id="tpl-count" style="margin:0 0 0 auto"></span>
              </div>
            </div>
            <div id="tpl-fields"></div>
            <div class="form-group">
              <label class="form-label" for="tpl-footer">Small print <span class="form-hint" style="display:inline">(optional, max 60)</span></label>
              <input class="form-input" id="tpl-footer" value="${escapeHtml(e.footer)}" maxlength="60" placeholder="e.g. Reply STOP to stop these messages" />
            </div>
            <div class="form-group">
              <div class="form-label">Buttons <span class="form-hint" style="display:inline">(optional, up to 3)</span></div>
              <div id="tpl-buttons" class="bot-list"></div>
              <div class="designer-chips">
                <button type="button" class="designer-chip" data-addbtn="QUICK_REPLY">+ Quick reply</button>
                <button type="button" class="designer-chip" data-addbtn="URL">+ Website link</button>
                <button type="button" class="designer-chip" data-addbtn="PHONE_NUMBER">+ Call button</button>
              </div>
            </div>
            <div id="tpl-errors"></div>
            <div class="settings-actions">
              <button class="btn btn-secondary" onclick="closeTemplateEditor()">Cancel</button>
              <button class="btn btn-primary" id="tpl-submit" onclick="submitWhatsAppTemplate()">Send to Meta for approval</button>
            </div>
          </div>
        </div>
      </div>
      <aside class="tpl-phone" aria-label="Preview">
        <div class="bot-try-head"><div class="bot-try-title">Preview</div><div class="form-hint">Fill-ins show your examples.</div></div>
        <div class="tpl-phone-chat" id="tpl-preview"></div>
      </aside>
    </div>`;
  wireTemplateEditor();
}

function closeTemplateEditor() { TplState.editing = null; renderTemplatesPage(); }

// Fill-ins in the order they appear; renumber so Meta gets {{1}}, {{2}}… with matching examples
function normalizeFills(body, fields) {
  const order = [];
  body.replace(/\{\{(\d+)\}\}/g, (m, n) => { if (!order.includes(n)) order.push(n); return m; });
  const map = new Map(order.map((n, i) => [n, String(i + 1)]));
  return {
    body: body.replace(/\{\{(\d+)\}\}/g, (m, n) => `{{${map.get(n)}}}`),
    fields: order.map(n => fields[Number(n) - 1] || { key: `field${n}`, label: `Fill-in ${n}`, example: '' }),
  };
}

function readTemplateEditor() {
  const e = TplState.editing;
  const v = (id) => document.getElementById(id)?.value ?? '';
  e.title = v('tpl-title'); e.language = v('tpl-lang'); e.header = v('tpl-header'); e.body = v('tpl-body'); e.footer = v('tpl-footer');
  e.category = document.querySelector('input[name="tpl-cat"]:checked')?.value || 'MARKETING';
  document.querySelectorAll('#tpl-fields [data-i]').forEach(el => {
    const f = e.fields[Number(el.dataset.i)];
    if (f) f.example = el.querySelector('input').value;
  });
  document.querySelectorAll('#tpl-buttons .bot-row').forEach((row, i) => {
    const b = e.buttons[i];
    if (!b) return;
    b.text = row.querySelector('.tb-text').value;
    if (b.type === 'URL') b.url = row.querySelector('.tb-extra').value;
    if (b.type === 'PHONE_NUMBER') b.phone_number = row.querySelector('.tb-extra').value;
  });
  return e;
}

function renderTemplateFields() {
  const e = TplState.editing;
  const used = new Set((e.body.match(/\{\{(\d+)\}\}/g) || []).map(m => Number(m.slice(2, -2)) - 1));
  document.getElementById('tpl-fields').innerHTML = e.fields.map((f, i) => used.has(i) ? `
    <div class="form-group tpl-field" data-i="${i}">
      <label class="form-label">Example for <code>{{${i + 1}}}</code> — ${escapeHtml(f.label)}</label>
      <input class="form-input" value="${escapeHtml(f.example)}" placeholder="What it might say, e.g. ${escapeHtml(f.example || 'Priya')}" maxlength="200" />
    </div>` : '').join('');
}

function renderTemplateButtons() {
  const e = TplState.editing;
  document.getElementById('tpl-buttons').innerHTML = e.buttons.map((b, i) => `
    <div class="bot-row">
      <div class="bot-row-main">
        <div class="form-hint" style="margin:0">${b.type === 'URL' ? 'Website link' : b.type === 'PHONE_NUMBER' ? 'Call button' : 'Quick reply'}</div>
        <input class="form-input tb-text" value="${escapeHtml(b.text || '')}" maxlength="25" placeholder="Button text" />
        ${b.type === 'URL' ? `<input class="form-input tb-extra" value="${escapeHtml(b.url || '')}" placeholder="https://yourwebsite.com" />` : ''}
        ${b.type === 'PHONE_NUMBER' ? `<input class="form-input tb-extra" value="${escapeHtml(b.phone_number || '')}" placeholder="+91 98765 43210" />` : ''}
      </div>
      <button type="button" class="btn btn-ghost btn-ghost-danger btn-sm" data-rmbtn="${i}">Remove</button>
    </div>`).join('');
}

function refreshTemplatePreview() {
  const e = readTemplateEditor();
  const slug = tplSlug(e.title);
  document.getElementById('tpl-slug').textContent = slug ? `Saved at Meta as “${slug}”` : '';
  document.getElementById('tpl-count').textContent = `${e.body.length}/1024`;
  document.getElementById('tpl-preview').innerHTML = tplPreviewHtml(e);
}

function wireTemplateEditor() {
  renderTemplateFields(); renderTemplateButtons(); refreshTemplatePreview();
  const root = document.getElementById('tpl-root');
  root.querySelector('.tpl-editor-form').addEventListener('input', (ev) => {
    if (ev.target.id === 'tpl-body') { readTemplateEditor(); renderTemplateFields(); }
    refreshTemplatePreview();
  });
  root.querySelector('.tpl-editor-form').addEventListener('change', refreshTemplatePreview);
  root.querySelector('.tpl-fill-bar').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-fill]');
    if (!btn) return;
    const e = readTemplateEditor();
    let f = TPL_FILLS[Number(btn.dataset.fill)];
    if (btn.dataset.fill === 'custom') {
      const label = await askText({ title: 'Add a fill-in', message: 'What changes for each customer? (e.g. “Pickup time”)' });
      if (!label) return;
      f = { key: tplSlug(label) || 'field', label: label.slice(0, 80), example: '' };
    }
    // Same fill-in used again: reuse its number
    let idx = e.fields.findIndex(x => x.key === f.key);
    if (idx < 0) { e.fields.push({ ...f }); idx = e.fields.length - 1; }
    const ta = document.getElementById('tpl-body');
    const token = `{{${idx + 1}}}`;
    const at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + token + ta.value.slice(ta.selectionEnd ?? at);
    ta.focus(); ta.selectionStart = ta.selectionEnd = at + token.length;
    readTemplateEditor(); renderTemplateFields(); refreshTemplatePreview();
  });
  if (root.dataset.btnWired) return; // the page root stays; attach this once
  root.dataset.btnWired = '1';
  root.addEventListener('click', (ev) => {
    if (!TplState.editing) return;
    const add = ev.target.closest('[data-addbtn]');
    const rm = ev.target.closest('[data-rmbtn]');
    if (!add && !rm) return;
    const e = readTemplateEditor();
    if (add) {
      if (e.buttons.length >= 3) return toast('A template can have up to 3 buttons.', 'warning');
      e.buttons.push({ type: add.dataset.addbtn, text: '' });
    } else e.buttons.splice(Number(rm.dataset.rmbtn), 1);
    renderTemplateButtons(); refreshTemplatePreview();
  });
}

async function submitWhatsAppTemplate() {
  const e = readTemplateEditor();
  const n = normalizeFills(e.body.trim(), e.fields);
  const payload = {
    name: tplSlug(e.title), category: e.category, language: e.language,
    header: e.header.trim(), body: n.body, footer: e.footer.trim(),
    buttons: e.buttons.filter(b => (b.text || '').trim()),
    fields: n.fields,
  };
  const errBox = document.getElementById('tpl-errors');
  errBox.innerHTML = '';
  const btn = document.getElementById('tpl-submit');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await api('POST', '/api/lead-pipeline/whatsapp/templates', payload);
    toast('Sent to Meta. Most templates are approved within minutes; it can take up to a day.', 'success', 7000);
    TplState.editing = null;
    TplState.filter = 'all';
    await loadWhatsAppTemplates(true);
  } catch (err) {
    errBox.innerHTML = `<div class="state-error">${escapeHtml(err.message)}</div>`;
  } finally {
    const b = document.getElementById('tpl-submit');
    if (b) { b.disabled = false; b.textContent = 'Send to Meta for approval'; }
  }
}

function copyTemplateAsNew(name, language) {
  const t = TplState.list.find(x => x.name === name && x.language === language);
  if (!t) return;
  const count = (t.body_text.match(/\{\{\d+\}\}/g) || []).length;
  const fields = t.fields || Array.from({ length: count }, (_, i) => ({ key: `field${i + 1}`, label: `Fill-in ${i + 1}`, example: '' }));
  openTemplateEditor(null, {
    title: `${tplTitle(t.name)} 2`, category: ['MARKETING', 'UTILITY'].includes(t.category) ? t.category : 'MARKETING', language: t.language,
    header: t.header_text, body: t.body_text, footer: t.footer_text, fields,
    buttons: (t.buttons || []).filter(b => ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(b.type)),
  });
}

async function deleteWhatsAppTemplate(name, id, language) {
  if (!(await askConfirm(`Delete the template “${tplTitle(name)}”? Broadcasts using it will stop working, and Meta won’t let you reuse this name for 30 days.`, 'Delete'))) return;
  try {
    await api('DELETE', `/api/lead-pipeline/whatsapp/templates/${encodeURIComponent(name)}?${new URLSearchParams({ ...(id ? { id } : {}), language })}`);
    toast('Template deleted', 'info');
    loadWhatsAppTemplates(true);
  } catch (err) { toast(err.message, 'error'); }
}

window.loadWhatsAppTemplates = loadWhatsAppTemplates;
window.openTemplateEditor = openTemplateEditor;
