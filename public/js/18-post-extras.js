// Social-Nexus app — Signatures, post sets (in Create post) and RSS feeds (own screen).
// One of the files in public/js, loaded in order by index.html (shared global scope).

const PX = { signatures: [], sets: [], feeds: [], sigOn: null, sigId: null };
const PX_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'threads', 'bluesky', 'pinterest', 'twitter', 'google_business'];

// ── Create post: signature and post sets ─────────────────────────────────────

async function loadPostExtras() {
  try {
    [PX.signatures, PX.sets] = await Promise.all([
      api('GET', '/api/post-extras/signatures'),
      api('GET', '/api/post-extras/sets'),
    ]);
  } catch { PX.signatures = []; PX.sets = []; }
  const def = PX.signatures.find(s => s.is_default);
  if (PX.sigId == null || !PX.signatures.some(s => s.id === PX.sigId)) PX.sigId = (def || PX.signatures[0])?.id ?? null;
  if (PX.sigOn == null) PX.sigOn = !!def;
  renderSignatureRow();
  renderSetsRow();
}

function renderSignatureRow() {
  const box = document.getElementById('compose-signature-row');
  if (!box) return;
  if (!PX.signatures.length) {
    box.innerHTML = `<button type="button" class="btn btn-ghost btn-sm" onclick="openSignatureManager()">+ Add a signature</button>
      <span class="form-hint" style="margin:0">Your contact details or hashtags, added to the end of posts.</span>`;
    return;
  }
  box.innerHTML = `
    <label class="bot-check"><input type="checkbox" id="compose-sig-on" ${PX.sigOn ? 'checked' : ''}/> Add signature</label>
    <select class="form-select px-inline-select" id="compose-sig-pick" ${PX.sigOn ? '' : 'disabled'}>
      ${PX.signatures.map(s => `<option value="${s.id}" ${s.id === PX.sigId ? 'selected' : ''}>${escapeHtml(s.name)}${s.is_default ? ' (default)' : ''}</option>`).join('')}
    </select>
    <button type="button" class="btn btn-ghost btn-sm" onclick="openSignatureManager()">Manage</button>
    <span class="form-hint px-sig-preview" id="compose-sig-preview"></span>`;
  const on = document.getElementById('compose-sig-on');
  const pick = document.getElementById('compose-sig-pick');
  const preview = () => {
    const s = PX.signatures.find(x => x.id === PX.sigId);
    document.getElementById('compose-sig-preview').textContent = PX.sigOn && s ? `Adds: “${s.text.replace(/\s+/g, ' ').slice(0, 70)}${s.text.length > 70 ? '…' : ''}”` : '';
    if (typeof updateComposeCharCount === 'function') updateComposeCharCount();
  };
  on.onchange = () => { PX.sigOn = on.checked; pick.disabled = !on.checked; preview(); };
  pick.onchange = () => { PX.sigId = Number(pick.value); preview(); };
  preview();
}

// Used by composeFields(): the post text with the chosen signature at the end
function withSignature(text) {
  const s = PX.sigOn && PX.signatures.find(x => x.id === PX.sigId);
  if (!s || !text) return text;
  if (text.includes(s.text.trim())) return text; // already there (e.g. a saved post opened again)
  return `${text}\n\n${s.text.trim()}`;
}

function renderSetsRow() {
  const box = document.getElementById('compose-sets-row');
  if (!box) return;
  box.innerHTML = `
    <span class="form-hint" style="margin:0">Quick choice:</span>
    ${PX.sets.map(s => `<span class="px-set"><button type="button" class="designer-chip" onclick="applyPostSet(${s.id})" title="${escapeHtml(s.platforms.map(p => PLATFORMS[p]?.label || p).join(', '))}">${escapeHtml(s.name)}</button><button type="button" class="px-set-x" onclick="deletePostSet(${s.id})" aria-label="Remove ${escapeHtml(s.name)}">×</button></span>`).join('')}
    <button type="button" class="btn btn-ghost btn-sm" onclick="savePostSet()">+ Save these platforms</button>`;
}

function applyPostSet(id) {
  const set = PX.sets.find(s => s.id === id);
  if (!set) return;
  document.querySelectorAll('#compose-platforms .platform-toggle').forEach(el => el.classList.toggle('selected', set.platforms.includes(el.dataset.platform)));
  const ig = document.getElementById('compose-ig-format');
  if (ig) ig.value = set.options?.ig_format || 'feed';
  if (typeof updateComposeCharCount === 'function') updateComposeCharCount();
  toast(`Platforms set to “${set.name}”`, 'info', 2500);
}

async function savePostSet() {
  const platforms = getSelectedPlatforms('compose-platforms');
  if (!platforms.length) return toast('Choose the platforms first, then save them as a set.', 'warning');
  const name = await askText({ title: 'Save these platforms', message: `Name for ${platforms.map(p => PLATFORMS[p]?.label || p).join(' + ')}:`, value: platforms.map(p => PLATFORMS[p]?.label || p).join(' + ').slice(0, 60) });
  if (!name) return;
  const ig = document.getElementById('compose-ig-format')?.value;
  try {
    await api('POST', '/api/post-extras/sets', { name, platforms, options: platforms.includes('instagram') && ig && ig !== 'feed' ? { ig_format: ig } : {} });
    PX.sets = await api('GET', '/api/post-extras/sets');
    renderSetsRow();
  } catch (err) { toast(err.message, 'error'); }
}

async function deletePostSet(id) {
  const set = PX.sets.find(s => s.id === id);
  if (!set || !(await askConfirm(`Remove the quick choice “${set.name}”?`, 'Remove'))) return;
  try { await api('DELETE', `/api/post-extras/sets/${id}`); PX.sets = PX.sets.filter(s => s.id !== id); renderSetsRow(); }
  catch (err) { toast(err.message, 'error'); }
}

// ── Signature manager (small dialog) ─────────────────────────────────────────

function openSignatureManager() {
  let m = document.getElementById('signature-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'signature-modal';
    m.className = 'modal-overlay';
    m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div class="modal" style="width:min(620px,calc(100vw - 32px))" role="dialog" aria-modal="true" aria-labelledby="sig-title" onclick="event.stopPropagation()">
      <div class="modal-header"><div class="modal-title" id="sig-title">Signatures</div>
        <button class="modal-close" onclick="document.getElementById('signature-modal').style.display='none'" aria-label="Close">✕</button></div>
      <div class="modal-body" style="padding:18px 24px">
        <div class="form-hint" style="margin-bottom:12px">Text added to the end of a post: contact details, an address, your usual hashtags. The default one is ticked for every new post.</div>
        <div id="sig-list" class="bot-list">${PX.signatures.map(s => `
          <div class="bot-row">
            <div class="bot-row-main">
              <b>${escapeHtml(s.name)}</b>
              <div class="form-hint" style="white-space:pre-wrap;margin:0">${escapeHtml(s.text)}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
              <label class="bot-check"><input type="radio" name="sig-default" ${s.is_default ? 'checked' : ''} onchange="setDefaultSignature(${s.id})"/> Default</label>
              <button class="btn btn-ghost btn-sm" onclick="deleteSignature(${s.id})">Delete</button>
            </div>
          </div>`).join('') || '<div class="form-hint">No signatures yet.</div>'}</div>
        <div class="form-subsection">
          <div class="form-subsection-title">New signature</div>
          <div class="form-group"><label class="form-label" for="sig-name">Name</label><input class="form-input" id="sig-name" maxlength="80" placeholder="e.g. Contact details" /></div>
          <div class="form-group"><label class="form-label" for="sig-text">Text</label><textarea class="form-textarea" id="sig-text" rows="3" maxlength="1000" placeholder="📍 Shop 4, MG Road, Pune · 📞 98765 43210&#10;#pune #bakery"></textarea></div>
          <label class="bot-check"><input type="checkbox" id="sig-default" ${PX.signatures.length ? '' : 'checked'}/> Use for every new post</label>
        </div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById('signature-modal').style.display='none'">Close</button><button class="btn btn-primary" onclick="addSignature()">Add signature</button></div>
    </div>`;
  m.style.display = 'flex';
}

async function addSignature() {
  const name = document.getElementById('sig-name').value.trim();
  const text = document.getElementById('sig-text').value.trim();
  if (!name || !text) return toast('Give it a name and some text.', 'warning');
  try {
    const isDefault = document.getElementById('sig-default').checked;
    const r = await api('POST', '/api/post-extras/signatures', { name, text, is_default: isDefault });
    if (isDefault) { PX.sigId = r.id; PX.sigOn = true; }
    await loadPostExtras();
    openSignatureManager();
  } catch (err) { toast(err.message, 'error'); }
}
async function setDefaultSignature(id) {
  try { await api('PUT', `/api/post-extras/signatures/${id}`, { is_default: true }); PX.sigId = id; PX.sigOn = true; await loadPostExtras(); }
  catch (err) { toast(err.message, 'error'); }
}
async function deleteSignature(id) {
  if (!(await askConfirm('Delete this signature? Posts already saved keep their text.', 'Delete'))) return;
  try { await api('DELETE', `/api/post-extras/signatures/${id}`); await loadPostExtras(); openSignatureManager(); }
  catch (err) { toast(err.message, 'error'); }
}

// ── RSS feeds screen ─────────────────────────────────────────────────────────

async function loadFeedsPage() {
  const root = document.getElementById('feeds-root');
  if (!root) return;
  try { PX.feeds = await api('GET', '/api/post-extras/feeds'); } catch (err) { PX.feeds = []; }
  const ago = (t) => t ? (typeof timeAgo === 'function' ? timeAgo(new Date(t * 1000)) : new Date(t * 1000).toLocaleString()) : 'not yet';
  root.innerHTML = `
    <p class="panel-desc" style="margin-bottom:16px">Have a blog, a news page or a YouTube channel? Add its feed and every new article becomes a post for you, checked every 30 minutes.</p>
    <div class="settings-section">
      <div class="settings-section-header"><div class="settings-section-title">Add a feed</div></div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label" for="feed-url">Feed address</label>
          <input class="form-input" id="feed-url" placeholder="https://yourblog.com/feed" />
          <div class="form-hint">Often your website address followed by <code>/feed</code> or <code>/rss.xml</code>. For YouTube: <code>https://www.youtube.com/feeds/videos.xml?channel_id=…</code></div>
        </div>
        <div class="form-group">
          <div class="form-label">Post to</div>
          <div class="designer-chips" id="feed-platforms">${PX_PLATFORMS.map(p => `<button type="button" class="designer-chip ${['facebook', 'linkedin'].includes(p) ? 'on' : ''}" data-p="${p}">${escapeHtml(PLATFORMS[p]?.label || p)}</button>`).join('')}</div>
        </div>
        <div class="bot-radios">
          <label class="bot-radio"><input type="radio" name="feed-mode" value="draft" checked/><span><b>Make a draft for me to check</b> — it waits in the Calendar until you schedule it</span></label>
          <label class="bot-radio"><input type="radio" name="feed-mode" value="schedule"/><span><b>Schedule it automatically</b> — goes out 15 minutes after the article appears (you can still change or cancel it in the Calendar)</span></label>
          <label class="bot-check"><input type="checkbox" id="feed-sig" checked/> Add my default signature</label>
        </div>
        <div class="settings-actions"><button class="btn btn-primary" id="feed-add">Add feed</button></div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-header"><div class="settings-section-title">Your feeds</div></div>
      ${PX.feeds.length ? PX.feeds.map(f => `
        <div class="px-feed">
          <div class="px-feed-main">
            <div class="tpl-card-name" style="font-size:14px">${escapeHtml(f.name || f.url)}</div>
            <div class="form-hint" style="margin:2px 0;word-break:break-all">${escapeHtml(f.url)}</div>
            <div class="form-hint" style="margin:0">${escapeHtml(f.platforms.map(p => PLATFORMS[p]?.label || p).join(', '))} · ${f.mode === 'schedule' ? 'scheduled automatically' : 'drafts'} · checked ${escapeHtml(ago(f.last_checked_at))} · ${f.posts_created} post${f.posts_created === 1 ? '' : 's'} made</div>
            ${f.last_error ? `<div class="state-error" style="margin-top:6px">${escapeHtml(f.last_error)}</div>` : ''}
          </div>
          <div class="px-feed-actions">
            <label class="bot-check"><input type="checkbox" ${f.enabled ? 'checked' : ''} onchange="updateFeed(${f.id}, { enabled: this.checked })"/> On</label>
            <button class="btn btn-secondary btn-sm" onclick="checkFeedNow(${f.id}, this)">Check now</button>
            <button class="btn btn-ghost btn-sm" onclick="deleteFeed(${f.id})">Remove</button>
          </div>
        </div>`).join('') : '<div class="card-body"><div class="form-hint">No feeds yet.</div></div>'}
    </div>`;
  root.querySelector('#feed-platforms').addEventListener('click', (e) => { const b = e.target.closest('.designer-chip'); if (b) b.classList.toggle('on'); });
  document.getElementById('feed-add').onclick = addFeed;
}

async function addFeed() {
  const url = document.getElementById('feed-url').value.trim();
  const platforms = [...document.querySelectorAll('#feed-platforms .designer-chip.on')].map(b => b.dataset.p);
  if (!url) return toast('Paste the feed address first.', 'warning');
  if (!platforms.length) return toast('Choose at least one place to post to.', 'warning');
  const btn = document.getElementById('feed-add');
  btn.disabled = true; btn.textContent = 'Checking the feed…';
  try {
    const r = await api('POST', '/api/post-extras/feeds', {
      url, platforms, mode: document.querySelector('input[name="feed-mode"]:checked')?.value, add_signature: document.getElementById('feed-sig').checked,
    });
    toast(`Added “${r.name || url}”. From now on, each new article becomes a post.`, 'success', 6000);
    loadFeedsPage();
  } catch (err) { toast(err.message, 'error', 7000); btn.disabled = false; btn.textContent = 'Add feed'; }
}
async function updateFeed(id, patch) {
  try { await api('PUT', `/api/post-extras/feeds/${id}`, patch); } catch (err) { toast(err.message, 'error'); loadFeedsPage(); }
}
async function checkFeedNow(id, btn) {
  btn.disabled = true;
  try {
    const r = await api('POST', `/api/post-extras/feeds/${id}/check`);
    toast(r.error ? r.error : r.created ? `${r.created} new post${r.created === 1 ? '' : 's'} made. See the Calendar.` : 'No new articles since the last check.', r.error ? 'error' : 'success');
    loadFeedsPage();
  } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
}
async function deleteFeed(id) {
  if (!(await askConfirm('Remove this feed? Posts it already made stay in the Calendar.', 'Remove'))) return;
  try { await api('DELETE', `/api/post-extras/feeds/${id}`); loadFeedsPage(); } catch (err) { toast(err.message, 'error'); }
}

Object.assign(window, { loadPostExtras, withSignature, applyPostSet, savePostSet, deletePostSet, openSignatureManager, addSignature, setDefaultSignature, deleteSignature, loadFeedsPage, updateFeed, checkFeedNow, deleteFeed });
