// NexaDrip app — Media library, backups, bulk, recovery, approvals, one-click connect, inbox, link in bio, phone, Canva.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// 🖼 Media library
// A post's picture is either a web link or a library item, saved as "media:<id>".
// ─────────────────────────────────────────────────────────────────────────────

const MEDIA_ACCEPT = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime))$/;

function mediaSrc(ref) {
  const m = /^media:(\d+)$/.exec(ref || '');
  return m ? `/api/media-library/${m[1]}/file` : (ref || '');
}

async function uploadMediaFile(file) {
  if (!file) return null;
  if (file.type && !MEDIA_ACCEPT.test(file.type)) throw new Error(`"${file.name}" isn’t a photo or video NexaDrip can post (JPG, PNG, GIF, WEBP, MP4, MOV).`);
  let res;
  try {
    res = await fetch('/api/media-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || '') },
      body: file,
    });
  } catch { throw new Error('Can’t reach the NexaDrip server. Make sure the app is running, then try again.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  if (!res.ok) throw new Error(data.error || `Upload failed (error ${res.status}).`);
  return data;
}

async function uploadComposeFile(file) {
  if (!file) return;
  const box = document.getElementById('compose-media-box');
  box?.classList.add('busy');
  try {
    const asset = await uploadMediaFile(file);
    if (!asset) return;
    State.mediaKinds = { ...(State.mediaKinds || {}), [asset.ref]: asset.kind };
    if (asset.width) State.mediaDims = { ...(State.mediaDims || {}), [asset.ref]: [asset.width, asset.height] };
    addComposeMedia(asset.ref);
    toast(`${asset.kind === 'video' ? 'Video' : 'Photo'} added to the post and to your media library`, 'success');
  } catch (err) {
    toast(err.message, 'error', 7000);
  } finally {
    box?.classList.remove('busy');
  }
}

async function composeMediaDrop(ev) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag');
  for (const file of [...(ev.dataTransfer?.files || [])].slice(0, 10)) await uploadComposeFile(file);
}

function clearComposeMedia(index = null) {
  if (index === null) { State.composeMedia = []; document.getElementById('compose-image').value = ''; updateComposeCharCount(); return; }
  const refs = composeMediaRefs();
  refs.splice(index, 1);
  setComposeMedia(refs);
}

function moveComposeMedia(index, by) {
  const refs = composeMediaRefs();
  const to = index + by;
  if (to < 0 || to >= refs.length) return;
  [refs[index], refs[to]] = [refs[to], refs[index]];
  setComposeMedia(refs);
}

// Shows what's attached: a library item, or a picture link
function renderComposeMediaPreview() {
  const box = document.getElementById('compose-media-preview');
  const input = document.getElementById('compose-image');
  if (!box || !input) return;
  const refs = composeMediaRefs();
  const hasLibrary = refs.some(r => /^media:\d+$/.test(r));
  input.style.display = hasLibrary ? 'none' : '';
  const key = JSON.stringify(refs);
  if (box.dataset.ref === key) return; // unchanged: don't reload the pictures
  box.dataset.ref = key;
  const shown = refs.filter(r => /^media:\d+$/.test(r) || /^https?:\/\//i.test(r));
  if (!shown.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  // Drafts opened again: learn whether library files are photos or videos
  if (shown.some(r => /^media:/.test(r) && !State.mediaKinds?.[r])) {
    api('GET', '/api/media-library').then(items => {
      State.mediaKinds = { ...(State.mediaKinds || {}), ...Object.fromEntries(items.map(a => [a.ref, a.kind])) };
      State.mediaDims = { ...(State.mediaDims || {}), ...Object.fromEntries(items.filter(a => a.width).map(a => [a.ref, [a.width, a.height]])) };
      box.dataset.ref = '';
      updateComposeCharCount();
    }).catch(() => {});
  }
  box.innerHTML = shown.map((ref, i) => {
    const src = escapeHtml(mediaSrc(ref));
    const isVideo = /\.(mp4|mov)(\?|$)/i.test(ref) || State.mediaKinds?.[ref] === 'video';
    return `<div class="media-chip">
      ${isVideo ? `<video src="${src}" muted preload="metadata"></video><span class="media-badge">▶</span>` : `<img src="${src}" alt="" />`}
      <div class="media-chip-actions">
        ${shown.length > 1 ? `<button type="button" title="Move left" aria-label="Move left" onclick="moveComposeMedia(${i}, -1)" ${i === 0 ? 'disabled' : ''}>‹</button>` : ''}
        <button type="button" title="Remove" aria-label="Remove" onclick="clearComposeMedia(${i})">✕</button>
        ${shown.length > 1 ? `<button type="button" title="Move right" aria-label="Move right" onclick="moveComposeMedia(${i}, 1)" ${i === shown.length - 1 ? 'disabled' : ''}>›</button>` : ''}
      </div>
    </div>`;
  }).join('') + (shown.length > 1 ? `<div class="media-preview-info">${shown.length} items: Instagram, Facebook, LinkedIn and Pinterest post them together (X up to 4).</div>` : '');
  box.style.display = 'flex';
}

// ── Library grid (page and picker) ───────────────────────────────────────────

function mediaTile(a, mode) {
  const name = escapeHtml(a.original_name || (a.kind === 'video' ? 'Video' : 'Photo'));
  const size = a.size > 1024 * 1024 ? `${(a.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`;
  const thumb = a.kind === 'video'
    ? `<video src="${a.url}" muted preload="metadata"></video><span class="media-badge">▶ Video</span>`
    : `<img src="${a.url}" alt="${name}" loading="lazy" />`;
  const pick = mode === 'pick'
    ? `onclick="pickMedia('${a.ref}', '${a.kind}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')this.click()"`
    : '';
  return `<div class="media-tile${mode === 'pick' ? ' pickable' : ''}" ${pick} title="${name}">
      <div class="media-thumb">${thumb}</div>
      <div class="media-tile-info"><span>${name}</span><small>${size}${a.source === 'ai' ? ' · AI' : ''}</small></div>
      ${mode === 'manage' ? `<div class="media-tile-actions">
        <button class="btn btn-secondary btn-sm" onclick="useMediaInCompose('${a.ref}', '${a.kind}')">Use in a post</button>
        <button class="btn btn-secondary btn-sm" onclick="deleteMediaAsset(${a.id})" aria-label="Delete ${name}">🗑</button>
      </div>` : ''}
    </div>`;
}

async function renderMediaGrid(el, mode) {
  el.innerHTML = '<div class="empty-state" style="padding:24px;grid-column:1/-1">Loading…</div>';
  try {
    const items = await api('GET', '/api/media-library');
    State.mediaKinds = Object.fromEntries(items.map(a => [a.ref, a.kind]));
    State.mediaDims = Object.fromEntries(items.filter(a => a.width).map(a => [a.ref, [a.width, a.height]]));
    el.innerHTML = items.length
      ? items.map(a => mediaTile(a, mode)).join('')
      : `<div class="empty-state" style="padding:32px;grid-column:1/-1">No photos or videos yet. Upload some${mode === 'manage' ? ', or drag them here' : ''}.</div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="padding:24px;grid-column:1/-1">${escapeHtml(err.message)}</div>`;
  }
}

function loadMediaLibrary() { return renderMediaGrid(document.getElementById('library-grid'), 'manage'); }

function openMediaLibrary() {
  document.getElementById('media-library-modal').style.display = 'flex';
  renderMediaGrid(document.getElementById('media-modal-grid'), 'pick');
}
function closeMediaLibrary() { document.getElementById('media-library-modal').style.display = 'none'; }

function pickMedia(ref, kind) {
  State.mediaKinds = { ...(State.mediaKinds || {}), [ref]: kind };
  closeMediaLibrary();
  if (State.mediaPickTarget === 'bio') {
    State.mediaPickTarget = null;
    if (kind !== 'image') return toast('Choose a photo for the page.', 'warning');
    State.bioAvatar = ref;
    document.getElementById('bio-avatar-name').textContent = 'chosen ✓';
    return renderBioPreview();
  }
  addComposeMedia(ref);
}

function useMediaInCompose(ref, kind) {
  State.mediaKinds = { ...(State.mediaKinds || {}), [ref]: kind };
  if (composeHasUnsaved()) {
    // Keep the post being written; add the picture to it
    navigateTo('compose');
    addComposeMedia(ref);
  } else if (!startNewCompose({ image_url: ref })) return;
  toast('Added to Create Post', 'success');
}

async function uploadLibraryFiles(files, pickFirst = false) {
  const list = [...(files || [])];
  if (!list.length) return;
  let first = null, ok = 0;
  for (const f of list) {
    try { const a = await uploadMediaFile(f); if (a) { ok++; first = first || a; } }
    catch (err) { toast(err.message, 'error', 7000); }
  }
  if (ok) toast(`${ok} file${ok === 1 ? '' : 's'} added to the media library`, 'success');
  if (pickFirst && first) return pickMedia(first.ref, first.kind);
  if (document.getElementById('media-library-modal').style.display !== 'none') renderMediaGrid(document.getElementById('media-modal-grid'), 'pick');
  if (State.currentPage === 'library') loadMediaLibrary();
}

async function deleteMediaAsset(id) {
  if (!confirm('Delete this file from the media library? Posts already published keep their picture.')) return;
  try {
    await api('DELETE', `/api/media-library/${id}`);
  } catch (err) {
    if (!/haven.t gone out yet/.test(err.message)) return toast(err.message, 'error');
    if (!confirm(`${err.message} Those posts will fail unless you give them another picture. Delete anyway?`)) return;
    try { await api('DELETE', `/api/media-library/${id}?force=1`); } catch (e) { return toast(e.message, 'error'); }
  }
  toast('Deleted', 'success');
  loadMediaLibrary();
}

// AI image → library → Create Post (platforms need the file, not a data: link)
async function useImageInCompose() {
  if (!State.lastImageBase64 && !State.lastImageUrl) return;
  try {
    const asset = await api('POST', '/api/media-library/import',
      State.lastImageBase64 ? { base64: State.lastImageBase64, name: `ai-image-${Date.now()}.png` } : { url: State.lastImageUrl });
    useMediaInCompose(asset.ref, 'image');
  } catch (err) {
    toast(err.message, 'error', 7000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 💾 Backups (Settings → Backups, admin only)
// ─────────────────────────────────────────────────────────────────────────────

async function loadBackups() {
  const el = document.getElementById('backups-panel');
  if (!el) return;
  if (State.user?.role !== 'admin') {
    el.innerHTML = '<div class="admin-note">🔒 Backups are managed by the admin of this installation.</div>';
    return;
  }
  el.innerHTML = '<span class="spinner"></span>';
  try {
    const { backups, folder, restore_pending, can_restart } = await api('GET', '/api/backups');
    const when = (t) => new Date(t * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const label = { daily: 'Daily', manual: 'Made by you', 'before-restore': 'Kept before a restore' };
    el.innerHTML = `
      ${restore_pending ? `<div class="admin-note" style="border-color:#f59e0b">⏳ A backup is ready to restore. ${can_restart ? 'Restart NexaDrip to finish.' : '<strong>Close NexaDrip completely (tray icon → Quit) and open it again</strong> to finish.'} ${can_restart ? '<button class="btn btn-primary btn-sm" onclick="restartForRestore()">Restart now</button>' : ''} <button class="btn btn-secondary btn-sm" onclick="cancelRestore()">Cancel restore</button></div>` : ''}
      <p style="color:var(--text-secondary);font-size:13px;margin:0 0 12px">
        NexaDrip saves a backup of your posts, settings and logins every day and keeps the last 7.
        For safety against a broken PC, also <strong>export</strong> a backup now and then and keep it on a USB stick or cloud drive.
        Backups include saved logins and keys, so keep the file private.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <button class="btn btn-primary btn-sm" onclick="backupNow(this)">💾 Back up now</button>
        <button class="btn btn-secondary btn-sm" onclick="exportBackupFile(this)">⬇ Export a backup file (with media)</button>
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('restore-file').click()">⬆ Restore from a file…</button>
        <input type="file" id="restore-file" accept=".snbackup" hidden onchange="restoreFromFile(this.files[0]); this.value=''" />
      </div>
      <div style="overflow-x:auto"><table class="analytics-table">
        <thead><tr><th>Backup</th><th>Type</th><th>Size</th><th></th></tr></thead>
        <tbody>${backups.length ? backups.map(b => `<tr>
          <td>${when(b.created_at)}</td><td>${label[b.reason] || b.reason}</td>
          <td>${(b.size / 1024 / 1024).toFixed(1)} MB</td>
          <td style="text-align:right"><button class="btn btn-secondary btn-sm" onclick="restoreBackup('${escapeHtml(b.name)}', '${when(b.created_at)}')">Restore</button></td>
        </tr>`).join('') : '<tr><td colspan="4" style="color:var(--text-muted);padding:16px">No backups yet. The first daily backup is made a few minutes after NexaDrip starts.</td></tr>'}</tbody>
      </table></div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px">Folder: ${escapeHtml(folder)}</div>`;
  } catch (err) {
    el.innerHTML = `<div style="color:#ef4444">${escapeHtml(err.message)}</div>`;
  }
}

async function backupNow(btn) {
  btn.disabled = true;
  try { await api('POST', '/api/backups'); toast('Backup saved', 'success'); loadBackups(); }
  catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
}

async function restoreBackup(name, when) {
  if (!confirm(`Restore the backup from ${when}?\n\nEverything changed since then (posts, settings, logins) will be replaced. Your current data is kept as a backup first, so you can go back.`)) return;
  try { const r = await api('POST', `/api/backups/${encodeURIComponent(name)}/restore`); toast(r.message, 'success', 10000); loadBackups(); }
  catch (err) { toast(err.message, 'error'); }
}

async function exportBackupFile(btn) {
  const p1 = await askText({ title: 'Passphrase for the backup file', password: true, confirmTwice: true, ok: 'Export',
    message: 'At least 8 characters. You need it to restore the file. Without it nobody can open the file — not even Radixile support.' });
  if (p1 == null) return;
  if (p1.length < 8) return toast('The passphrase needs at least 8 characters.', 'warning');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Preparing…';
  try {
    const res = await fetch('/api/backups/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: p1 }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (error ${res.status}).`);
    const blob = await res.blob();
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'NexaDrip-backup.snbackup';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    toast('Backup file saved. Keep the passphrase somewhere safe.', 'success', 7000);
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = label; }
}

async function restoreFromFile(file, passphrase = '') {
  if (!file) return;
  if (!passphrase && !confirm(`Restore from "${file.name}"?\n\nAll posts, settings, logins and media will be replaced by the ones in this file. Your current data is kept as a backup first.`)) return;
  toast('Checking the backup file…', 'info');
  try {
    const res = await fetch('/api/backups/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Passphrase': encodeURIComponent(passphrase) }, body: file });
    const data = await res.json().catch(() => ({}));
    if (data.code === 'NEEDS_PASSPHRASE' || data.code === 'BAD_PASSPHRASE') {
      const p = await askText({ title: 'Backup passphrase', password: true, ok: 'Restore', message: data.code === 'BAD_PASSPHRASE' ? 'That passphrase didn\u2019t work. Try again:' : 'Enter the passphrase of this backup file:' });
      if (p) return restoreFromFile(file, p);
      return;
    }
    if (!res.ok) throw new Error(data.error || `Restore failed (error ${res.status}).`);
    toast(data.message, 'success', 10000);
    loadBackups();
  } catch (err) { toast(err.message, 'error', 8000); }
}

async function cancelRestore() {
  try { await api('DELETE', '/api/backups/restore'); toast('Restore cancelled', 'success'); loadBackups(); }
  catch (err) { toast(err.message, 'error'); }
}

async function restartForRestore() {
  if (!confirm('Restart NexaDrip now to finish restoring? Everyone will need to sign in again.')) return;
  try { await api('POST', '/api/backups/restart'); toast('Restarting…', 'info', 10000); }
  catch (err) { toast(err.message, 'error'); }
}

// Monthly client report: opens in its own window with "Save as PDF"
function openClientReport() {
  const input = document.getElementById('report-month');
  if (!input.value) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (d.getDate() < 5 ? 1 : 0));
    input.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  window.open(`/api/reports/monthly?month=${encodeURIComponent(input.value)}`, '_blank');
}

// ─────────────────────────────────────────────────────────────────────────────
// 📥 Bulk scheduling (CSV / Excel)
// ─────────────────────────────────────────────────────────────────────────────

function openBulkImport() {
  State.bulkFile = null;
  document.getElementById('bulk-preview').innerHTML = '';
  document.getElementById('bulk-file-name').textContent = 'No file chosen';
  document.getElementById('bulk-import-btn').disabled = true;
  document.getElementById('bulk-import-modal').style.display = 'flex';
}
function closeBulkImport() { document.getElementById('bulk-import-modal').style.display = 'none'; }

function downloadBulkTemplate() {
  const y = new Date().getFullYear() + (new Date().getMonth() > 9 ? 1 : 0);
  const csv = 'date,time,text,platforms,image,first comment,instagram\n'
    + `${y}-12-24,18:00,"Christmas Eve special: free dessert with every meal! 🎄","facebook, instagram",https://example.com/xmas.jpg,#christmas #offer,feed\n`
    + `25/12/${y},9:30 AM,Merry Christmas from all of us!,linkedin,,,\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv' }));
  a.download = 'social-nexus-bulk-template.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function sendBulk(file, dryRun) {
  const res = await fetch(`/api/content/bulk${dryRun ? '?dry_run=1' : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  if (!res.ok && !data.rows) throw new Error(data.error || `The import failed (error ${res.status}).`);
  return { ...data, httpOk: res.ok };
}

async function previewBulkImport(file) {
  if (!file) return;
  State.bulkFile = file;
  document.getElementById('bulk-file-name').textContent = file.name;
  const out = document.getElementById('bulk-preview');
  const btn = document.getElementById('bulk-import-btn');
  btn.disabled = true;
  out.innerHTML = '<span class="spinner"></span> Checking the rows…';
  try {
    const r = await sendBulk(file, true);
    if (!r) return;
    const when = (t) => new Date(t * 1000).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    out.innerHTML = `
      <div style="margin-bottom:8px;font-size:13px">${r.counts.ok} post${r.counts.ok === 1 ? '' : 's'} ready${r.counts.failed ? `, <span style="color:#ef4444">${r.counts.failed} with a problem (skipped)</span>` : ''}.
        ${r.will === 'draft' ? 'They will be saved as <strong>drafts</strong> for someone who can approve them.' : 'They will be <strong>scheduled</strong>.'}</div>
      <div style="max-height:320px;overflow:auto"><table class="analytics-table">
        <thead><tr><th>Row</th><th>When</th><th>Post</th><th>Where</th></tr></thead>
        <tbody>${r.rows.map(x => x.ok
          ? `<tr><td>${x.line}</td><td>${when(x.post.scheduled_at)}</td><td>${escapeHtml(x.post.body.slice(0, 80))}${x.post.body.length > 80 ? '…' : ''}${x.post.image_url ? ' 🖼' : ''}</td><td>${x.post.platforms.map(p => PLATFORMS[p]?.icon || p).join(' ')}</td></tr>`
          : `<tr style="color:#ef4444"><td>${x.line}</td><td colspan="3">⚠️ ${escapeHtml(x.error)}</td></tr>`).join('')}</tbody>
      </table></div>`;
    btn.textContent = r.counts.ok ? `${r.will === 'draft' ? 'Save' : 'Schedule'} ${r.counts.ok} post${r.counts.ok === 1 ? '' : 's'}` : 'Import';
    btn.disabled = !r.counts.ok;
  } catch (err) {
    out.innerHTML = `<div style="color:#ef4444">${escapeHtml(err.message)}</div>`;
  }
}

async function runBulkImport() {
  if (!State.bulkFile) return;
  const btn = document.getElementById('bulk-import-btn');
  btn.disabled = true;
  try {
    const r = await sendBulk(State.bulkFile, false);
    if (!r) return;
    if (!r.httpOk) throw new Error(r.error || 'The import failed.');
    toast(`${r.imported} post${r.imported === 1 ? '' : 's'} ${r.status === 'draft' ? 'saved as drafts' : 'scheduled'}${r.skipped ? `; ${r.skipped} skipped` : ''}`, 'success', 7000);
    closeBulkImport();
    if (State.currentPage === 'calendar') renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error', 8000);
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔑 Recovery code (reset a forgotten password without email)
// ─────────────────────────────────────────────────────────────────────────────

function openRecoveryCode() {
  document.getElementById('recovery-password').value = '';
  document.getElementById('recovery-password').removeAttribute('aria-invalid');
  document.getElementById('recovery-error').hidden = true;
  document.getElementById('recovery-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('recovery-password').focus(), 50);
}

async function makeRecoveryCode(btn) {
  btn.disabled = true;
  try {
    const r = await api('POST', '/users/recovery-code', { password: document.getElementById('recovery-password').value });
    document.getElementById('recovery-body').innerHTML = `
      <p style="margin-top:0;font-size:13px">Write this down or keep it in a password manager. It is shown only now.</p>
      <div style="font-family:monospace;font-size:20px;text-align:center;padding:14px;border:1px dashed var(--border);border-radius:10px;user-select:all">${escapeHtml(r.recovery_code)}</div>`;
    document.getElementById('recovery-footer').innerHTML = '<button class="btn btn-primary" onclick="location.reload()">I have saved it</button>';
    document.getElementById('recovery-nudge')?.remove();
  } catch (err) {
    // Shown in the dialog, under the password box, where the person is looking
    const box = document.getElementById('recovery-error');
    const input = document.getElementById('recovery-password');
    box.textContent = /not right/i.test(err.message)
      ? 'That isn’t your sign-in password. Try again. Forgotten it? An admin can set a new one in Settings → Users & access.'
      : err.message;
    box.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    input.select();
    btn.disabled = false;
  }
}

// A small reminder on the dashboard for accounts without a code
function showRecoveryNudge() {
  if (!State.user || State.user.has_recovery_code || document.getElementById('recovery-nudge')) return;
  try { if (localStorage.getItem('recoveryNudgeHidden') === String(State.user.id)) return; } catch {}
  const page = document.getElementById('page-dashboard');
  if (!page) return;
  const el = document.createElement('div');
  el.id = 'recovery-nudge';
  el.className = 'admin-note';
  el.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px';
  el.innerHTML = '<span>🔑 Make a recovery code, so you can reset your password if you ever forget it.</span><span style="display:flex;gap:6px"><button class="btn btn-primary btn-sm" onclick="openRecoveryCode()">Make code</button><button class="btn btn-secondary btn-sm" onclick="hideRecoveryNudge()">Later</button></span>';
  page.prepend(el);
}
function hideRecoveryNudge() {
  try { localStorage.setItem('recoveryNudgeHidden', String(State.user.id)); } catch {}
  document.getElementById('recovery-nudge')?.remove();
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔗 Client approval by link / WhatsApp (in the Calendar post drawer)
// ─────────────────────────────────────────────────────────────────────────────

async function renderApprovalBox(item) {
  const box = document.getElementById('detail-approval');
  if (!box) return;
  box.innerHTML = '';
  if (['published', 'publishing'].includes(item.status)) return;
  let links = [];
  try { links = await api('GET', `/api/content/${item.id}/approval-links`); } catch {}
  if (State.selectedContentItem?.id !== item.id) return; // another post opened meanwhile
  const open = links.find(l => l.status === 'open');
  const last = links.find(l => l.status === 'approved' || l.status === 'changes');
  const when = (t) => new Date(t * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  box.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px">🔗 Client approval</div>
      ${last ? `<div style="font-size:12.5px;margin-bottom:8px">${last.status === 'approved' ? '✓ Approved' : '✎ Changes asked'} by ${escapeHtml(last.response_name || 'the client')} on ${when(last.responded_at)}${last.response_comment ? `: “${escapeHtml(last.response_comment)}”` : ''}</div>` : ''}
      ${open ? `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Waiting for an answer · link works until ${when(open.expires_at)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="copyApprovalLink('${escapeHtml(open.url)}')">📋 Copy link</button>
          <a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Please review this post before it goes out: ' + open.url)}">💬 Send on WhatsApp</a>
          <button class="btn btn-secondary btn-sm" onclick="withdrawApprovalLink(${open.id}, ${item.id})">Withdraw</button>
        </div>`
      : `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Your client opens a link on their phone and taps Approve or Ask for changes — no account needed. The post is encrypted; only people with the link can see it.</div>
        <button class="btn btn-primary btn-sm" onclick="makeApprovalLink(${item.id}, this)">Get approval link</button>`}
    </div>`;
}

async function makeApprovalLink(itemId, btn) {
  btn.disabled = true;
  btn.textContent = 'Making the link…';
  try {
    const r = await api('POST', `/api/content/${itemId}/approval-link`);
    copyApprovalLink(r.url, true);
    const item = await api('GET', `/api/content/${itemId}`);
    State.selectedContentItem = item;
    renderApprovalBox(item);
    if (State.currentPage === 'calendar') renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error', 8000);
    btn.disabled = false;
    btn.textContent = 'Get approval link';
  }
}

function copyApprovalLink(url, made = false) {
  navigator.clipboard?.writeText(url).then(
    () => toast(made ? 'Link made and copied. Paste it to your client, or use Send on WhatsApp.' : 'Link copied', 'success', 6000),
    () => askText({ title: 'Approval link', message: 'Copy this link:', value: url, readOnly: true }));
}

async function withdrawApprovalLink(linkId, itemId) {
  if (!confirm('Withdraw this link? The client will no longer be able to open it.')) return;
  try {
    await api('DELETE', `/api/content/approval-links/${linkId}`);
    toast('Link withdrawn', 'success');
    renderApprovalBox(await api('GET', `/api/content/${itemId}`));
  } catch (err) { toast(err.message, 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// ⚡ One-click connect (Radixile's approved apps)
// ─────────────────────────────────────────────────────────────────────────────

async function connectOneClick(platform, btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Opening sign-in…';
  try {
    const start = await api('POST', `/auth/connect/${platform}/start`);
    window.open(start.auth_url, '_blank'); // the person's own browser
    btn.textContent = 'Waiting for you to sign in…';
    toast(`Sign in to ${PLATFORMS[platform]?.label || platform} in the browser window that opened, then come back here.`, 'info', 10000);
    const until = Date.now() + 10 * 60 * 1000;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 2500));
      const r = await api('GET', `/auth/connect/session/${encodeURIComponent(start.session_id)}`);
      if (r.status === 'waiting') continue;
      if (r.status !== 'done') throw new Error(r.error || 'The sign-in did not finish. Click Connect to try again.');
      if (r.instagramMissing) toast('Facebook is connected, but no Instagram account is linked to your Facebook Page. Link them in Instagram (Business or Creator account), then connect Instagram again.', 'warning', 12000);
      else if (r.selectPage) toast('Connected. You manage several Facebook Pages: choose one on the Facebook card.', 'success', 9000);
      else if (r.googleBusinessMissing) toast(r.googleBusinessError ? `Google is connected, but its Business Profiles couldn’t be read: ${r.googleBusinessError}` : 'Google is connected, but this Google account doesn’t manage any Business Profile location.', 'warning', 15000);
      else if (r.selectLocation) toast('Google Business is connected. You manage several locations: choose one on the Google Business card.', 'info', 10000);
      else toast(`${PLATFORMS[r.connected]?.label || platform} connected ✓`, 'success');
      await refreshStatus();
      return loadSettings();
    }
    throw new Error('The sign-in took too long. Click Connect to try again.');
  } catch (err) {
    toast(err.message, 'error', 9000);
    btn.disabled = false;
    btn.textContent = label;
  }
}

// One link for the client to approve every draft / waiting post shown on the Calendar
async function shareMonthForApproval(btn) {
  const posts = (State.calendarEvents || []).filter(e => ['draft', 'in_review'].includes(e.status));
  if (!posts.length) return toast('No draft or waiting posts in this view. Plan some posts first (or use Bulk schedule).', 'info', 7000);
  if (posts.length > 50) return toast(`${posts.length} posts are shown: one link holds at most 50. Switch to a shorter view (week).`, 'warning', 8000);
  if (!confirm(`Make one approval link for ${posts.length} post${posts.length === 1 ? '' : 's'} shown on the Calendar?\n\nYour client opens it on their phone and approves or asks for changes for each post. Approved posts with a time are scheduled automatically.`)) return;
  btn.disabled = true;
  try {
    const r = await api('POST', '/api/content/approval-set', { item_ids: posts.map(p => p.id) });
    renderCalendar(State.calendarDate);
    const go = confirm(`Link made for ${r.count} posts and copied.\n\nOpen WhatsApp to send it now?`);
    navigator.clipboard?.writeText(r.url).catch(() => {});
    if (go) window.open(r.whatsapp_url, '_blank');
  } catch (err) {
    toast(err.message, 'error', 8000);
  } finally { btn.disabled = false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// A small question dialog (the desktop app has no prompt())
// askText({ title, message, value, password, confirmTwice, readOnly }) → text or null
// ─────────────────────────────────────────────────────────────────────────────
function askText({ title = '', message = '', value = '', password = false, confirmTwice = false, readOnly = false, ok = 'OK' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-overlay';
    wrap.style.display = 'flex';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header"><div class="modal-title"></div><button class="modal-close" aria-label="Close">✕</button></div>
      <div class="modal-body">
        <p class="ask-msg" style="margin-top:0;font-size:13px;color:var(--text-secondary);white-space:pre-line"></p>
        <input class="form-input ask-1" />
        <input class="form-input ask-2" style="margin-top:8px;display:none" />
        <div class="ask-err" style="color:#ef4444;font-size:12px;margin-top:6px"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary ask-cancel">Cancel</button><button class="btn btn-primary ask-ok"></button></div>
    </div>`;
    wrap.querySelector('.modal-title').textContent = title;
    wrap.querySelector('.ask-msg').textContent = message;
    const i1 = wrap.querySelector('.ask-1'), i2 = wrap.querySelector('.ask-2');
    i1.type = i2.type = password ? 'password' : 'text';
    i1.value = value; i1.readOnly = readOnly;
    if (confirmTwice) { i2.style.display = ''; i2.placeholder = 'Type it again'; }
    wrap.querySelector('.ask-ok').textContent = readOnly ? 'Done' : ok;
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('.ask-cancel').onclick = () => done(null);
    wrap.querySelector('.modal-close').onclick = () => done(null);
    wrap.querySelector('.ask-ok').onclick = () => {
      if (confirmTwice && i1.value !== i2.value) { wrap.querySelector('.ask-err').textContent = 'The two entries don\u2019t match.'; return; }
      done(i1.value);
    };
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter') wrap.querySelector('.ask-ok').click(); if (e.key === 'Escape') done(null); });
    document.body.appendChild(wrap);
    setTimeout(() => { i1.focus(); if (readOnly) i1.select(); }, 30);
  });
}

async function connectBluesky(key, btn) {
  const handle = document.getElementById(`bsky-handle-${key}`).value.trim();
  const app_password = document.getElementById(`bsky-pass-${key}`).value.trim();
  const service = document.getElementById(`bsky-service-${key}`)?.value.trim();
  if (!handle || !app_password) return toast('Enter your Bluesky handle and an app password.', 'warning');
  btn.disabled = true;
  try {
    const r = await api('POST', '/api/config/bluesky/connect', { handle, app_password, service });
    toast(`Bluesky connected as @${r.handle} ✓`, 'success');
    await refreshStatus();
    loadSettings();
  } catch (err) { toast(err.message, 'error', 9000); btn.disabled = false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 💬 Inbox (comments on published posts)
// ─────────────────────────────────────────────────────────────────────────────

function agoSecs(t) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

async function updateInboxBadge() {
  try {
    const r = await api('GET', '/api/inbox/unread-count');
    const b = document.getElementById('inbox-badge');
    if (b) { b.textContent = r.unread > 99 ? '99+' : r.unread; b.style.display = r.unread ? '' : 'none'; }
  } catch {}
}
setInterval(() => { if (State.user && document.visibilityState === 'visible') updateInboxBadge(); }, 5 * 60 * 1000);
setTimeout(() => { if (State.user) updateInboxBadge(); }, 4000);

async function loadInbox() {
  const el = document.getElementById('inbox-list');
  el.innerHTML = '<span class="spinner"></span>';
  try {
    const filter = document.getElementById('inbox-filter').value;
    const r = await api('GET', `/api/inbox${filter ? `?filter=${filter}` : ''}`);
    const items = r?.items || [];
    State.inbox = items;
    el.innerHTML = items.length ? items.map(i => `
      <div class="inbox-item ${i.is_read ? '' : 'unread'}" id="inbox-${i.id}">
        <div class="inbox-head">
          <span>${PLATFORMS[i.platform]?.icon || ''} <strong>${escapeHtml(i.author_name || 'Someone')}</strong></span>
          <span class="inbox-time">${agoSecs(i.created_at)}</span>
        </div>
        <div class="inbox-text">${escapeHtml(i.text)}</div>
        ${i.post_content ? `<div class="inbox-post">On your post: “${escapeHtml(i.post_content)}”</div>` : ''}
        ${i.replied_at
          ? `<div class="inbox-replied">↩ You replied: ${escapeHtml(i.reply_text || '')}</div>`
          : `<div class="inbox-reply">
              <textarea class="form-textarea" id="inbox-reply-${i.id}" rows="2" maxlength="2000" placeholder="Write a reply…"></textarea>
              <div style="display:flex;gap:6px;margin-top:6px">
                <button class="btn btn-primary btn-sm" onclick="sendInboxReply(${i.id}, this)">Reply</button>
                <button class="btn btn-secondary btn-sm" onclick="suggestInboxReply(${i.id}, this)">✨ Suggest a reply</button>
                ${i.is_read ? '' : `<button class="btn btn-secondary btn-sm" onclick="markInboxRead([${i.id}])">Mark read</button>`}
              </div>
            </div>`}
      </div>`).join('')
      : '<div class="empty-state" style="padding:40px">No comments yet. New comments on posts you publish from NexaDrip show up here.</div>';
    updateInboxBadge();
  } catch (err) {
    el.innerHTML = `<div style="color:#ef4444">${escapeHtml(err.message)}</div>`;
  }
}

async function refreshInbox(btn) {
  btn.disabled = true;
  try { const r = await api('POST', '/api/inbox/refresh'); toast(r.added ? `${r.added} new comment${r.added === 1 ? '' : 's'}` : 'No new comments', 'success'); loadInbox(); }
  catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; }
}

async function markInboxRead(ids = null) {
  try { await api('POST', '/api/inbox/read', ids ? { ids } : {}); loadInbox(); } catch (err) { toast(err.message, 'error'); }
}

async function sendInboxReply(id, btn) {
  const text = document.getElementById(`inbox-reply-${id}`).value.trim();
  if (!text) return toast('Write a reply first', 'warning');
  btn.disabled = true;
  try { await api('POST', `/api/inbox/${id}/reply`, { text }); toast('Reply posted ✓', 'success'); loadInbox(); }
  catch (err) { toast(err.message, 'error', 9000); btn.disabled = false; }
}

async function suggestInboxReply(id, btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Thinking…';
  try {
    const r = await api('POST', `/api/inbox/${id}/suggest`);
    const box = document.getElementById(`inbox-reply-${id}`);
    box.value = r.text;
    box.focus();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = label; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔗 Link in bio
// ─────────────────────────────────────────────────────────────────────────────

function bioLinkRow(l = { label: '', url: '' }) {
  const row = document.createElement('div');
  row.className = 'bio-link-row';
  row.innerHTML = '<input class="form-input bio-l-label" placeholder="Label (e.g. Order on WhatsApp)" maxlength="80" /><input class="form-input bio-l-url" placeholder="https://wa.me/91…" /><button class="btn btn-secondary btn-sm" aria-label="Remove link">✕</button>';
  row.querySelector('.bio-l-label').value = l.label; row.querySelector('.bio-l-url').value = l.url;
  row.querySelectorAll('input').forEach(i => { i.oninput = renderBioPreview; });
  row.querySelector('button').onclick = () => { row.remove(); renderBioPreview(); };
  return row;
}
function addBioLink(l) { document.getElementById('bio-links').appendChild(bioLinkRow(l)); renderBioPreview(); }

function bioForm() {
  return {
    slug: document.getElementById('bio-slug').value.trim(),
    title: document.getElementById('bio-title').value.trim(),
    bio: document.getElementById('bio-text').value.trim(),
    color: document.getElementById('bio-color').value,
    avatar_ref: State.bioAvatar || null,
    links: [...document.querySelectorAll('#bio-links .bio-link-row')].map(r => ({ label: r.querySelector('.bio-l-label').value.trim(), url: r.querySelector('.bio-l-url').value.trim() })).filter(l => l.label || l.url),
  };
}

function renderBioPreview() {
  const f = bioForm();
  const el = document.getElementById('bio-preview');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:24px 14px">
    ${f.avatar_ref ? `<img src="${mediaSrc(f.avatar_ref)}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid ${escapeHtml(f.color)}" alt="">` : ''}
    <div style="font-weight:700;font-size:17px;margin:8px 0 4px">${escapeHtml(f.title || 'Your business')}</div>
    <div style="font-size:12px;color:#4b5563;margin-bottom:14px">${escapeHtml(f.bio)}</div>
    ${f.links.map(l => `<div style="background:${escapeHtml(f.color)};color:#fff;border-radius:12px;padding:10px;margin-bottom:8px;font-size:13px;font-weight:600">${escapeHtml(l.label || '…')}</div>`).join('')}
  </div>`;
}

async function loadBio() {
  const page = await api('GET', '/api/bio').catch(() => null);
  document.getElementById('bio-base').textContent = 'license.radixile.com/b/';
  document.getElementById('bio-links').innerHTML = '';
  State.bioAvatar = page?.avatar_ref || null;
  document.getElementById('bio-avatar-name').textContent = State.bioAvatar ? 'chosen ✓' : '';
  document.getElementById('bio-slug').value = page?.slug || '';
  document.getElementById('bio-title').value = page?.title || (await api('GET', '/api/tools/brand-kit').then(b => b?.company_name).catch(() => '')) || '';
  document.getElementById('bio-text').value = page?.bio || '';
  document.getElementById('bio-color').value = page?.color || '#7c3aed';
  (page?.links?.length ? page.links : [{ label: '', url: '' }]).forEach(l => addBioLink(l));
  document.getElementById('bio-unpublish').style.display = page?.url ? '' : 'none';
  const status = document.getElementById('bio-status');
  status.innerHTML = page?.url ? `Live at <a href="${escapeHtml(page.url)}" target="_blank" rel="noopener">${escapeHtml(page.url)}</a> · <span id="bio-stats">…</span>` : 'Not published yet.';
  renderBioPreview();
  if (page?.url) {
    const s = await api('GET', '/api/bio/stats').catch(() => null);
    const el = document.getElementById('bio-stats');
    if (el) el.textContent = s?.views == null ? 'visits unavailable offline' : `${s.views} visits and ${Object.values(s.clicks || {}).reduce((a, b) => a + b, 0)} link clicks in the last 30 days`;
  }
}

function pickBioAvatar() {
  State.mediaPickTarget = 'bio';
  openMediaLibrary();
}

async function publishBio(btn) {
  const f = bioForm();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(f.slug)) return toast('Choose a page name: 3–40 lowercase letters, numbers or dashes.', 'warning');
  if (!f.title) return toast('Give the page a title.', 'warning');
  btn.disabled = true;
  try {
    const r = await api('PUT', '/api/bio', f);
    toast('Page published ✓ Paste the link into your Instagram profile.', 'success', 8000);
    navigator.clipboard?.writeText(r.url).catch(() => {});
    loadBio();
  } catch (err) { toast(err.message, 'error', 8000); }
  finally { btn.disabled = false; }
}

async function unpublishBio() {
  if (!confirm('Take the page offline? The link will stop working.')) return;
  try { await api('DELETE', '/api/bio'); toast('Page taken offline', 'success'); loadBio(); } catch (err) { toast(err.message, 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// 📱 Phone companion
// ─────────────────────────────────────────────────────────────────────────────

async function openCompanion() {
  if (window.State && window.State.server) {
    if (typeof toast === 'function') toast('Phone companion is only for the desktop app.', 'info');
    return;
  }
  let wrap = document.getElementById('companion-modal');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'companion-modal';
    wrap.className = 'modal-overlay';
    wrap.onclick = (e) => { if (e.target === wrap) wrap.style.display = 'none'; };
    wrap.innerHTML = `<div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header"><div class="modal-title">📱 Phone companion</div><button class="modal-close" onclick="document.getElementById('companion-modal').style.display='none'" aria-label="Close">✕</button></div>
      <div class="modal-body">
        <p style="margin-top:0;font-size:13px;color:var(--text-secondary)">See on your phone what needs you: posts waiting for your OK (approve or ask for changes right there), posts that didn\u2019t go out, and what\u2019s coming up. It\u2019s private: encrypted on this PC and opened on your phone with the key in your link. This PC must be running for updates.</p>
        <div id="companion-list"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" onclick="pairPhone(this)">Pair my phone</button></div>
    </div>`;
    document.body.appendChild(wrap);
  }
  wrap.style.display = 'flex';
  const list = document.getElementById('companion-list');
  list.innerHTML = '<span class="spinner"></span>';
  try {
    const rows = await api('GET', '/api/companion');
    list.innerHTML = rows.length ? rows.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">
        <div style="font-size:13px">${escapeHtml(p.label)}<div style="font-size:11px;color:var(--text-muted)">${p.last_push ? `updated ${agoSecs(p.last_push)}` : 'waiting for first update'}</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" data-url="${escapeHtml(p.url)}" onclick="sendPhoneLink(this.dataset.url)">Copy link again</button>
          <button class="btn btn-secondary btn-sm" onclick="unpairPhone(${p.id})">Unpair</button>
        </div>
      </div>`).join('') : '<div style="font-size:13px;color:var(--text-muted)">No phone paired yet.</div>';
  } catch (err) { list.innerHTML = `<div style="color:#ef4444">${escapeHtml(err.message)}</div>`; }
}

async function sendPhoneLink(url) {
  navigator.clipboard?.writeText(url).catch(() => {});
  // Not sent through WhatsApp or other apps: the link itself opens the summary
  askText({ title: 'Your private phone link', message: 'Copied. Get it to your phone privately (for example a note synced to your phone, or your own email), open it there and add it to the home screen. Anyone with this link can see your summary.', value: url, readOnly: true });
}

async function pairPhone(btn) {
  const label = await askText({ title: 'Pair a phone', message: 'A name for this phone:', value: 'My phone', ok: 'Pair' });
  if (label == null) return;
  btn.disabled = true;
  try {
    const r = await api('POST', '/api/companion', { label });
    await openCompanion();
    sendPhoneLink(r.url);
  } catch (err) { toast(err.message, 'error', 8000); }
  finally { btn.disabled = false; }
}

async function unpairPhone(id) {
  if (!confirm('Unpair this phone? Its link stops working.')) return;
  try { await api('DELETE', `/api/companion/${id}`); openCompanion(); } catch (err) { toast(err.message, 'error'); }
}

// Cloud posting available on this licence? (Agency and Full editions)
setTimeout(async () => {
  if (!State.user) return;
  try { State.cloudEnabled = !!(await api('GET', '/api/cloud/status')).enabled; } catch { State.cloudEnabled = false; }
}, 5000);

// ─────────────────────────────────────────────────────────────────────────────
// 🎨 Canva and 💬 WhatsApp Channels (no posting API: open the app with the text)
// ─────────────────────────────────────────────────────────────────────────────

// Canva's ready-sized blank designs for each platform
const CANVA_SIZES = {
  instagram: 'instagram-posts', facebook: 'facebook-posts', linkedin: 'linkedin-posts', pinterest: 'pinterest-pins',
  twitter: 'twitter-posts', threads: 'instagram-posts', bluesky: 'twitter-posts', google_business: 'facebook-posts',
};
function designInCanva() {
  const p = getSelectedPlatforms('compose-platforms')[0] || 'instagram';
  const igFormat = document.getElementById('compose-ig-format')?.value;
  const type = p === 'instagram' && igFormat === 'story' ? 'instagram-stories' : p === 'instagram' && igFormat === 'reel' ? 'instagram-reels' : (CANVA_SIZES[p] || 'social-media');
  window.open(`https://www.canva.com/create/${type}/`, '_blank');
  toast('Design in Canva, then Share → Download (PNG or JPG), and drag the file onto “Photo or video” here.', 'info', 10000);
}

function shareToWhatsApp() {
  const text = document.getElementById('compose-content').value.trim();
  if (!text) return toast('Write the post first', 'warning');
  navigator.clipboard?.writeText(text).catch(() => {});
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  toast('Text copied. In WhatsApp choose your Channel or Status and paste it (add the picture from Downloads if needed).', 'info', 9000);
}
