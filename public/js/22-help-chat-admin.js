// Super Admin: the knowledge base of the help chats (landing page and in-app) and the
// enquiries they pass on. Part of Users & access → "Help chat".

const HELP_FOR = { public: 'Website visitors', app: 'Inside the app', both: 'Both' };
let helpKbRows = [];
let helpKbEditing = null;

async function loadHelpAdmin() {
  const box = document.getElementById('help-kb-list');
  if (!box) return;
  box.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    helpKbRows = await api('GET', '/admin/help-kb');
    renderHelpKb();
  } catch (err) { box.innerHTML = `<div class="state-error">${escapeHtml(err.message)}</div>`; }
  loadHelpEnquiries();
}

function renderHelpKb() {
  const box = document.getElementById('help-kb-list');
  const filter = document.getElementById('help-kb-filter')?.value || 'all';
  const q = (document.getElementById('help-kb-search')?.value || '').trim().toLowerCase();
  const rows = helpKbRows.filter(r => (filter === 'all' || r.audience === filter || (r.audience === 'both' && filter !== 'all'))
    && (!q || `${r.question} ${r.answer} ${r.keywords}`.toLowerCase().includes(q)));
  setEl('help-kb-count', `${helpKbRows.filter(r => r.enabled).length} answers on · ${helpKbRows.length} in total`);
  if (!rows.length) { box.innerHTML = '<div class="empty-state" style="padding:24px">No answers match. Add one with “Add an answer”.</div>'; return; }
  box.innerHTML = rows.map(r => `
    <div class="help-kb-row ${r.enabled ? '' : 'off'}">
      <div class="help-kb-main">
        <div class="help-kb-q">${escapeHtml(r.question)} <span class="badge ${r.audience === 'public' ? 'badge-purple' : r.audience === 'app' ? 'badge-green' : ''}">${HELP_FOR[r.audience] || r.audience}</span>${r.builtin_id ? ' <span class="badge">Built-in</span>' : ''}${r.go ? ` <span class="badge" title="Button the chat shows">→ ${escapeHtml(r.go)}</span>` : ''}</div>
        <div class="help-kb-a">${escapeHtml(r.answer)}</div>
        <div class="help-kb-k">Matches: ${escapeHtml(r.keywords || '(question words only)')}</div>
      </div>
      <div class="help-kb-actions">
        <label class="toggle-row-switch" title="Show this answer in the chats"><input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="helpKbToggle(${r.id}, this.checked)" aria-label="On"> On</label>
        <button class="btn btn-secondary btn-sm" onclick="helpKbEdit(${r.id})">Edit</button>
        <button class="btn btn-secondary btn-sm" onclick="helpKbDelete(${r.id})">Delete</button>
      </div>
    </div>`).join('');
}

function helpKbOpenForm(row) {
  helpKbEditing = row?.id || null;
  const f = (id) => document.getElementById(id);
  f('help-kb-form').hidden = false;
  f('hk-audience').value = row?.audience || 'public';
  f('hk-question').value = row?.question || '';
  f('hk-keywords').value = row?.keywords || '';
  f('hk-answer').value = row?.answer || '';
  f('hk-go').value = row?.go || '';
  setEl('hk-title', row ? 'Edit answer' : 'Add an answer');
  f('hk-error').hidden = true;
  f('hk-question').focus();
}
function helpKbEdit(id) { helpKbOpenForm(helpKbRows.find(r => r.id === id)); }
function helpKbCancel() { document.getElementById('help-kb-form').hidden = true; helpKbEditing = null; }

async function helpKbSave(btn) {
  const body = {
    audience: document.getElementById('hk-audience').value,
    question: document.getElementById('hk-question').value,
    keywords: document.getElementById('hk-keywords').value,
    answer: document.getElementById('hk-answer').value,
    go: document.getElementById('hk-go').value,
  };
  const err = document.getElementById('hk-error');
  err.hidden = true;
  btn.disabled = true;
  try {
    if (helpKbEditing) await api('PUT', `/admin/help-kb/${helpKbEditing}`, { ...body, enabled: helpKbRows.find(r => r.id === helpKbEditing)?.enabled });
    else await api('POST', '/admin/help-kb', body);
    toast('Saved. The chats use it right away.', 'success');
    helpKbCancel();
    loadHelpAdmin();
  } catch (e) { err.textContent = e.message; err.hidden = false; }
  finally { btn.disabled = false; }
}

async function helpKbToggle(id, on) {
  const r = helpKbRows.find(x => x.id === id);
  try { await api('PUT', `/admin/help-kb/${id}`, { audience: r.audience, question: r.question, keywords: r.keywords, answer: r.answer, go: r.go, enabled: on }); r.enabled = on ? 1 : 0; renderHelpKb(); }
  catch (e) { toast(e.message, 'error'); loadHelpAdmin(); }
}

async function helpKbDelete(id) {
  const r = helpKbRows.find(x => x.id === id);
  if (!confirm(`Delete this answer?\n\n${r.question}${r.builtin_id ? '\n\n(You can bring built-in answers back with “Restore built-in answers”.)' : ''}`)) return;
  try { await api('DELETE', `/admin/help-kb/${id}`); toast('Deleted', 'success'); loadHelpAdmin(); } catch (e) { toast(e.message, 'error'); }
}

async function helpKbRestore(btn) {
  btn.disabled = true;
  try { const r = await api('POST', '/admin/help-kb/restore'); toast(r.added ? `${r.added} built-in answer${r.added === 1 ? '' : 's'} restored` : 'Nothing to restore: all built-in answers are there', 'success'); loadHelpAdmin(); }
  catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; }
}

// Try a question the way a visitor would
async function helpKbTest(btn) {
  const message = document.getElementById('hk-test-q').value.trim();
  const out = document.getElementById('hk-test-out');
  if (!message) { out.textContent = 'Type a question to try.'; return; }
  btn.disabled = true; out.textContent = 'Checking…';
  try {
    const r = await api('POST', '/admin/help-kb/test', { audience: document.getElementById('hk-test-for').value, message });
    out.innerHTML = `<b>The chat would say:</b> ${escapeHtml(r.reply)}${r.needs_human ? '<br><i>It would offer to pass this to the team.</i>' : ''}<br><small>Matched: ${r.matched?.length ? r.matched.map(escapeHtml).join(' · ') : 'nothing. Add an answer or more matching words.'}</small>`;
  } catch (e) { out.textContent = e.message; } finally { btn.disabled = false; }
}

async function loadHelpEnquiries() {
  const box = document.getElementById('help-enq-list');
  if (!box) return;
  try {
    const rows = await api('GET', '/admin/help-enquiries');
    const open = rows.filter(r => r.status === 'new').length;
    setEl('help-enq-count', open ? `${open} waiting for a reply` : 'No new enquiries');
    box.innerHTML = rows.length ? rows.map(r => `
      <div class="help-kb-row ${r.status === 'done' ? 'off' : ''}">
        <div class="help-kb-main">
          <div class="help-kb-q">${escapeHtml(r.name || 'No name')} · <a href="${/@/.test(r.contact || '') ? 'mailto:' : 'tel:'}${escapeHtml(r.contact || '')}">${escapeHtml(r.contact || 'no contact')}</a> <span class="badge ${r.source === 'landing' ? 'badge-purple' : 'badge-green'}">${r.source === 'landing' ? 'Website' : 'In the app'}</span> <small>${new Date(r.created_at * 1000).toLocaleString('en-IN')}</small></div>
          <div class="help-kb-a">${escapeHtml(r.message)}</div>
          ${r.transcript ? `<details><summary>Chat before this</summary><pre class="help-kb-pre">${escapeHtml(r.transcript)}</pre></details>` : ''}
        </div>
        <div class="help-kb-actions"><button class="btn btn-secondary btn-sm" onclick="helpEnqDone(${r.id}, '${r.status === 'done' ? 'new' : 'done'}')">${r.status === 'done' ? 'Reopen' : 'Mark done'}</button></div>
      </div>`).join('') : '<div class="empty-state" style="padding:24px">No enquiries yet. Questions the chat cannot answer and “talk to a person” requests land here.</div>';
  } catch (e) { box.innerHTML = `<div class="state-error">${escapeHtml(e.message)}</div>`; }
}

async function helpEnqDone(id, status) {
  try { await api('POST', `/admin/help-enquiries/${id}/done`, { status }); loadHelpEnquiries(); } catch (e) { toast(e.message, 'error'); }
}
