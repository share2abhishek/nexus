// Social-Nexus app — Create Post (writing, AI help, saving, scheduling).
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// Compose & Post
// ─────────────────────────────────────────────────────────────────────────────

// Character limits for a post's text on each network
const PLATFORM_CHAR_LIMITS = {
  twitter: 280, pinterest: 500, google_business: 1500, instagram: 2200,
  tiktok: 2200, linkedin: 3000, youtube: 5000, facebook: 63206, threads: 500, bluesky: 300,
};
const PLATFORM_NEEDS_MEDIA = { instagram: 'an image', pinterest: 'an image', tiktok: 'a video' };
// Platforms that can't take a video yet (photos are fine)
const PLATFORM_NO_VIDEO = ['linkedin', 'twitter', 'pinterest', 'google_business', 'bluesky'];

// Warnings for the current Compose text/platforms, checked before posting too
function composeWarnings() {
  const opts = document.getElementById('compose-post-options');
  if (opts) {
    const sel = getSelectedPlatforms('compose-platforms');
    opts.style.display = sel.includes('instagram') || sel.includes('facebook') ? '' : 'none';
    document.getElementById('compose-ig-options').style.display = sel.includes('instagram') ? '' : 'none';
  }
  const cloudWrap = document.getElementById('compose-cloud-wrap');
  if (cloudWrap) {
    const sel = getSelectedPlatforms('compose-platforms');
    cloudWrap.style.display = State.cloudEnabled && sel.some(p => ['facebook', 'instagram', 'linkedin', 'pinterest'].includes(p)) ? '' : 'none';
  }
  const typedText = document.getElementById('compose-content').value;
  const content = typeof withSignature === 'function' && typedText.trim() ? withSignature(typedText.trim()) : typedText; // with the signature, as posted
  const mediaRef = composeMediaRefs()[0] || '';
  const hasMedia = !!mediaRef;
  const isVideo = /\.(mp4|mov)(\?|$)/i.test(mediaRef) || State.mediaKinds?.[mediaRef] === 'video';
  const warnings = [];
  for (const p of getSelectedPlatforms('compose-platforms')) {
    const label = PLATFORMS[p]?.label || p;
    const limit = PLATFORM_CHAR_LIMITS[p];
    if (limit && content.length > limit) warnings.push(`${label} allows ${limit} characters — this post has ${content.length}.`);
    if (PLATFORM_NEEDS_MEDIA[p] && !hasMedia) warnings.push(`${label} needs ${PLATFORM_NEEDS_MEDIA[p]} — add an image/video URL.`);
    const dims = State.mediaDims?.[mediaRef];
    if (p === 'instagram' && dims && !isVideo) {
      const ratio = dims[0] / dims[1];
      if (ratio < 0.79 || ratio > 1.92) warnings.push(`Instagram only accepts photos from portrait 4:5 to wide 1.91:1 — this one is ${dims[0]}×${dims[1]}. Crop it first, or Instagram will refuse it.`);
    }
    const igFormat = document.getElementById('compose-ig-format')?.value || 'feed';
    if (p === 'instagram' && igFormat === 'reel' && !composeMediaRefs().some(r => /\.(mp4|mov)(\?|$)/i.test(r) || State.mediaKinds?.[r] === 'video')) warnings.push('An Instagram Reel needs a video.');
    if (isVideo && PLATFORM_NO_VIDEO.includes(p)) warnings.push(`${label} can’t take videos from Social-Nexus yet — use a photo, or post the video from the ${label} app.`);
  }
  return warnings;
}

function updateComposeCharCount() {
  const typedText = document.getElementById('compose-content').value;
  const content = typeof withSignature === 'function' && typedText.trim() ? withSignature(typedText.trim()) : typedText; // with the signature, as posted
  renderComposeMediaPreview();
  composeAiToolsState();
  updateCharCount('compose-char-count', content.length);
  const el = document.getElementById('compose-char-count');
  const warnings = composeWarnings();
  if (el && warnings.length) {
    el.innerHTML += warnings.map(w => `<div style="color:#f59e0b;margin-top:4px">⚠️ ${escapeHtml(w)}</div>`).join('');
  }
}

// 'YYYY-MM-DDTHH:mm' in local time, for <input type=datetime-local>
function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Create Post → When to post: "review" (goes to the Calendar as In review),
// "schedule" or "now". People who can't publish in this workspace only get review.
const POST_MODES = {
  now:      { button: '📤 Publish now',    hint: 'Posts straight away to the platforms you picked.' },
  schedule: { button: '📅 Schedule post',  hint: 'Goes out automatically at the time you pick. You can repeat it every day, week or month.' },
  review:   { button: '📝 Send for review', hint: 'Goes to the Calendar as "In review". Someone who can approve posts checks it and schedules it. Nothing is published yet.' },
  draft:    { button: '💾 Keep as draft',   hint: 'Stays on the Calendar as a draft. Open it there any time to finish it.' },
};
function allowedPostModes() {
  const canPublish = hasWorkspacePermission('content.publish');
  const canSubmit = hasWorkspacePermission('content.submit') || hasWorkspacePermission('content.create');
  const modes = [];
  if (canPublish) modes.push('now', 'schedule');
  if (canSubmit) modes.push('review');
  modes.push('draft');
  return modes.length > 1 ? modes : ['now', 'schedule', 'review', 'draft']; // role not loaded yet: server still checks
}

function setPostMode(mode) {
  const allowed = allowedPostModes();
  if (!allowed.includes(mode)) mode = allowed.includes('schedule') ? 'schedule' : allowed[0];
  State.postMode = mode;
  for (const m of Object.keys(POST_MODES)) {
    const b = document.getElementById(`post-mode-${m}`);
    if (!b) continue;
    b.hidden = !allowed.includes(m);
    b.setAttribute('aria-checked', String(m === mode));
  }
  const hint = document.getElementById('post-mode-hint');
  if (hint) hint.textContent = POST_MODES[mode].hint;
  const picker = document.getElementById('schedule-picker');
  const label = document.getElementById('schedule-label');
  const repeatBox = document.getElementById('repeat-box');
  const submitBtn = document.getElementById('btn-submit-post');
  picker.style.display = mode === 'now' || mode === 'draft' ? 'none' : 'block';
  if (label) label.textContent = mode === 'review' ? 'Suggested time (the approver can change it)' : 'First post';
  if (repeatBox) repeatBox.style.display = mode === 'schedule' ? '' : 'none';
  submitBtn.textContent = POST_MODES[mode].button;

  // Default time: 1 hour from now, in the computer's local time (datetime-local
  // inputs are local; toISOString() would be UTC, i.e. 5½ hours off in India).
  // Keep a time the user already picked.
  const at = document.getElementById('compose-schedule-at');
  if ((mode === 'schedule' || mode === 'review') && (!at.value || new Date(at.value) <= new Date())) at.value = toLocalInputValue(new Date(Date.now() + 3600000));
  if (mode === 'schedule') setTimeout(updateRepeatSummary, 0);
}

// ── Create Post: step 1 (write + save) → step 2 (choose what happens) ─────────
// Step 1 saves the post as a draft (it appears on the Calendar). Step 2 asks:
// publish now, schedule (optionally repeating), send for review, or keep as draft.
State.composeDraftId = null; // the draft saved from this editor (re-saving updates it)

function composeFields() {
  const typed = document.getElementById('compose-content').value.trim();
  const content = typeof withSignature === 'function' ? withSignature(typed) : typed; // the chosen signature, if ticked
  const platforms = getSelectedPlatforms('compose-platforms');
  const media = composeMediaRefs();
  const image_url = media[0] || null;
  const igFormat = document.getElementById('compose-ig-format')?.value || 'feed';
  const firstComment = (document.getElementById('compose-first-comment')?.value || '').trim();
  const opts = {};
  if (media.length > 1) opts.media = media;
  if (igFormat !== 'feed') opts.ig_format = igFormat;
  if (firstComment) opts.first_comment = firstComment;
  if (document.getElementById('compose-cloud')?.checked) opts.cloud = true;
  return { content, platforms, image_url, options: Object.keys(opts).length ? opts : null };
}

// The post's photos/videos in order: library items and/or one web link
function composeMediaRefs() {
  if (State.composeMedia?.length) return [...State.composeMedia];
  const link = document.getElementById('compose-image').value.trim();
  return link ? [link] : [];
}

function setComposeMedia(refs) {
  State.composeMedia = (refs || []).filter(Boolean).slice(0, 10);
  document.getElementById('compose-image').value = State.composeMedia.length === 1 && !/^media:/.test(State.composeMedia[0]) ? State.composeMedia[0] : '';
  if (State.composeMedia.length === 1 && !/^media:/.test(State.composeMedia[0])) State.composeMedia = [];
  updateComposeCharCount();
}

function addComposeMedia(ref) {
  const refs = composeMediaRefs();
  if (refs.includes(ref)) return;
  if (refs.length >= 10) return toast('A post can have at most 10 photos or videos.', 'warning');
  setComposeMedia([...refs, ref]);
}

function resetCompose() {
  State.composeDraftId = null;
  State.composeMedia = [];
  if (document.getElementById('compose-ig-format')) document.getElementById('compose-ig-format').value = 'feed';
  if (document.getElementById('compose-first-comment')) document.getElementById('compose-first-comment').value = '';
  if (document.getElementById('compose-cloud')) document.getElementById('compose-cloud').checked = false;
  document.getElementById('compose-content').value = '';
  document.getElementById('compose-image').value = '';
  document.getElementById('compose-content').dispatchEvent(new Event('input'));
  document.getElementById('compose-repeat').value = 'none';
  document.getElementById('compose-repeat-until').value = '';
  document.getElementById('compose-schedule-at').value = '';
  document.getElementById('compose-ai-prompt').value = '';
  State.composeUndo = null;
  State.composeSavedText = '';
  State.composeEditing = null;
  const editing = document.getElementById('compose-editing');
  if (editing) editing.hidden = true;
  composeAiSeq++; // a reply still on its way belongs to the old post: drop it
  if (composeAiBusy) composeAiSetBusy(false, '');
  composeAiToolsState();
}

// True when the editor holds text that isn't saved anywhere yet
function composeHasUnsaved() {
  // Editing a saved post: platform and image changes count too
  if (State.composeEditing) return composeSnapshot() !== State.composeEditing.saved;
  const text = document.getElementById('compose-content').value.trim();
  return !!text && text !== (State.composeSavedText || '').trim();
}
function composeSnapshot() {
  const { content, platforms, image_url, options } = composeFields();
  return JSON.stringify([content, [...platforms].sort(), image_url || '', options || null]);
}

// Put new text in Create Post as a NEW post (so saving doesn't overwrite an
// earlier draft from this editor) and open the page.
// Returns false (and changes nothing) if the person keeps their unsaved text.
function startNewCompose({ text = '', platforms = null, image_url = '' } = {}) {
  if (composeHasUnsaved() && !confirm('Create Post has text you haven\u2019t saved. Replace it with the new post?')) {
    navigateTo('compose');
    return false;
  }
  resetCompose();
  if (image_url) { if (/^media:/.test(image_url)) State.composeMedia = [image_url]; else document.getElementById('compose-image').value = image_url; }
  document.getElementById('compose-content').value = text;
  if (platforms?.length) {
    document.querySelectorAll('#compose-platforms .platform-toggle').forEach(el => {
      el.classList.toggle('selected', platforms.includes(el.dataset.platform));
    });
  }
  navigateTo('compose');
  updateComposeCharCount();
  composeAiToolsState();
  return true;
}

// Open a saved post (from the Calendar) in Create Post. Saving updates that
// post instead of making a new one. Only draft, in-review and failed posts can
// be edited (the server checks too).
State.composeEditing = null; // { id, status } of the saved post being edited
const EDIT_STATUS_TEXT = {
  draft: 'a draft',
  in_review: 'a post waiting for review — saving keeps it in review',
  failed: 'a post that failed to publish — saving turns it back into a draft',
};
function startEditCompose(item) {
  if (composeHasUnsaved()) {
    // Same post with changes not saved yet: just go back to them
    if (State.composeEditing?.id === item.id) { navigateTo('compose'); return true; }
    if (!confirm('Create Post has changes you haven’t saved. Replace them with the post you’re editing?')) {
      navigateTo('compose');
      return false;
    }
  }
  resetCompose();
  State.composeDraftId = item.id;
  State.composeSavedText = item.body || '';
  document.getElementById('compose-content').value = item.body || '';
  const itemMedia = item.options?.media?.length ? item.options.media : (item.image_url ? [item.image_url] : []);
  if (itemMedia.length === 1 && !/^media:/.test(itemMedia[0])) document.getElementById('compose-image').value = itemMedia[0];
  else State.composeMedia = [...itemMedia];
  document.getElementById('compose-ig-format').value = item.options?.ig_format || 'feed';
  document.getElementById('compose-first-comment').value = item.options?.first_comment || '';
  document.getElementById('compose-cloud').checked = !!item.options?.cloud;
  const platforms = Array.isArray(item.platforms) ? item.platforms : [];
  document.querySelectorAll('#compose-platforms .platform-toggle').forEach(el => {
    el.classList.toggle('selected', platforms.includes(el.dataset.platform));
  });
  // Keep the time the author suggested (step 2 offers it for review/schedule)
  if (item.scheduled_at && item.scheduled_at * 1000 > Date.now()) {
    document.getElementById('compose-schedule-at').value = toLocalInputValue(new Date(item.scheduled_at * 1000));
  }
  State.composeEditing = {
    id: item.id, status: item.status, title: postTitle(item), saved: composeSnapshot(),
    updated_at: item.updated_at, workspaceId: currentWorkspaceId, series: !!item.series_id,
  };
  composeEditingBanner();
  navigateTo('compose');
  updateComposeCharCount();
  composeAiToolsState();
  return true;
}

function composeEditingBanner() {
  const e = State.composeEditing;
  document.getElementById('compose-editing-text').textContent =
    `✏️ Editing ${EDIT_STATUS_TEXT[e.status] || 'a saved post'}: “${e.title}”` +
    (e.series ? ' · part of a repeating series — saving makes this one a separate post' : '');
  document.getElementById('compose-editing').hidden = false;
}

// Warn before quitting or reloading with unsaved changes in Create Post
// (the desktop app shows its own Leave/Stay dialog for this)
window.addEventListener('beforeunload', (e) => {
  if (composeHasUnsaved()) { e.preventDefault(); e.returnValue = ''; }
});

function leaveEditCompose() {
  if (startNewCompose()) document.getElementById('compose-content').focus();
}

// ── Create Post: AI writes or edits the text box ──────────────────────────────
// Every AI change can be undone with one click until the person edits the text.
State.composeUndo = null; // { before, after }
State.composeSavedText = ''; // text last saved as a draft from this editor
let composeAiBusy = false;
let composeAiSeq = 0; // bumped for every AI call and every new post; stale replies are ignored

function composeAiToolsState() {
  const box = document.getElementById('compose-content');
  if (!box) return;
  const hasText = !!box.value.trim();
  document.querySelectorAll('#compose-ai-tools [data-ai-action]').forEach(b => { b.disabled = composeAiBusy || !hasText; });
  const writeBtn = document.getElementById('btn-compose-ai-write');
  if (writeBtn) writeBtn.disabled = composeAiBusy;
  // Saving while the AI is still changing the text would save the old text
  const saveBtn = document.getElementById('btn-save-post');
  if (saveBtn && !saveBtn.querySelector('.spinner')) saveBtn.disabled = composeAiBusy;
  document.getElementById('compose-platforms')?.classList.toggle('is-locked', composeAiBusy);
  const undo = document.getElementById('btn-compose-ai-undo');
  if (undo) undo.style.display = !composeAiBusy && State.composeUndo && box.value === State.composeUndo.after ? '' : 'none';
}

function composeAiSetBusy(busy, message = '') {
  composeAiBusy = busy;
  const status = document.getElementById('compose-ai-status');
  status.replaceChildren();
  if (busy) {
    const sp = document.createElement('span');
    sp.className = 'spinner';
    status.append(sp, ` ${message}`);
  } else if (message) {
    status.textContent = message;
  }
  document.getElementById('compose-content').readOnly = busy;
  composeAiToolsState();
}

function composeAiApply(newText, message) {
  const box = document.getElementById('compose-content');
  State.composeUndo = { before: box.value, after: newText };
  box.value = newText;
  updateComposeCharCount();
  composeAiSetBusy(false, message);
}

function composeAiSourceNote(model) {
  if (!model) return '';
  const m = String(model);
  return m.startsWith('ollama')
    ? ` Written by Local AI (${m.replace(/^ollama:?/, '') || 'Ollama'}) on this PC.`
    : ` Written by ${m} (online service).`;
}

function composeAiModel() {
  const sel = document.getElementById('compose-ai-model-select');
  if (sel && sel.value) return sel.value;
  return (typeof ModelState !== 'undefined' && ModelState.textModel?.id) || null;
}

function onComposeModelSelect(val) {
  if (typeof ModelState !== 'undefined' && ModelState.available?.text) {
    const found = ModelState.available.text.find(m => m.id === val);
    if (found) ModelState.textModel = found;
  }
}
window.onComposeModelSelect = onComposeModelSelect;

async function composeAiWrite(promptOverride) {
  if (composeAiBusy) return;
  const input = document.getElementById('compose-ai-prompt');
  const prompt = (promptOverride ?? input.value).trim();
  if (!prompt) { input.focus(); return toast('Tell the AI what the post should say', 'warning'); }
  const platforms = getSelectedPlatforms('compose-platforms');
  const seq = ++composeAiSeq;
  composeAiSetBusy(true, 'Writing… (can take up to a minute)');
  try {
    const data = await api('POST', '/api/generate', {
      prompt, platforms, single: true, max_tokens: 700, type: 'social_post',
      tone: document.getElementById('compose-ai-tone').value,
      model: composeAiModel(),
    });
    if (seq !== composeAiSeq) return;
    if (!String(data.content || '').trim()) throw new Error('The AI returned nothing — try again.');
    const had = !!document.getElementById('compose-content').value.trim();
    composeAiApply(data.content, (had ? 'Replaced your text — Undo brings it back.' : 'Done — check it and edit anything you like.') + composeAiSourceNote(data.model));
  } catch (err) {
    if (seq !== composeAiSeq) return;
    composeAiSetBusy(false, '');
    toast(err.message, 'error');
  }
}

const COMPOSE_AI_LABELS = { rewrite: 'Improving…', shorten: 'Shortening…', hashtags: 'Finding hashtags…' };

async function composeAiAssist(action) {
  if (composeAiBusy) return;
  const box = document.getElementById('compose-content');
  const text = box.value.trim();
  if (!text) return toast('Write something first', 'warning');
  const platforms = getSelectedPlatforms('compose-platforms');
  const seq = ++composeAiSeq;
  composeAiSetBusy(true, COMPOSE_AI_LABELS[action] || 'Working…');
  try {
    const data = await api('POST', '/api/assist', {
      action, text, platform: platforms.length === 1 ? platforms[0] : undefined, model: composeAiModel(),
    });
    if (seq !== composeAiSeq) return;
    const result = String(data.text || '').trim();
    if (!result) throw new Error('The AI returned nothing — try again.');
    let next = result;
    if (action === 'hashtags') {
      // Keep only real #tags (small models sometimes answer with a sentence instead),
      // skip ones already in the post, and add them at the end
      const have = new Set((box.value.match(/#[\p{L}\p{M}\p{N}_]+/gu) || []).map(t => t.toLowerCase()));
      const tags = [...new Set(result.match(/#[\p{L}\p{M}\p{N}_]+/gu) || [])].filter(t => !have.has(t.toLowerCase()));
      if (!tags.length) throw new Error('The AI didn’t suggest any new hashtags — try again, or pick another AI model.');
      next = `${box.value.replace(/\s+$/, '')}\n\n${tags.slice(0, 10).join(' ')}`;
    }
    composeAiApply(next, 'Done — Undo brings back the previous text.' + composeAiSourceNote(data.model));
  } catch (err) {
    if (seq !== composeAiSeq) return;
    composeAiSetBusy(false, '');
    toast(err.message, 'error');
  }
}

function composeAiUndo() {
  const box = document.getElementById('compose-content');
  if (!State.composeUndo || box.value !== State.composeUndo.after) return;
  box.value = State.composeUndo.before;
  State.composeUndo = null;
  updateComposeCharCount();
  document.getElementById('compose-ai-status').textContent = 'Previous text restored.';
  composeAiToolsState();
}

async function savePostAndContinue() {
  if (composeAiBusy) return toast('Wait for the AI to finish first', 'info');
  const { content, platforms, image_url, options } = composeFields();
  if (!content) return toast('Write your post first', 'warning');
  if (!platforms.length) return toast('Pick at least one platform', 'warning');
  const btn = document.getElementById('btn-save-post');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';
  try {
    const editing = State.composeEditing;
    if (editing) {
      // A post opened from the Calendar: never save a second copy of it
      let updated;
      try {
        if (editing.workspaceId !== currentWorkspaceId) throw new Error('you switched to another workspace');
        const patch = { body: content, platforms, image_url, options, expected_updated_at: editing.updated_at };
        if (content !== (State.composeSavedText || '').trim()) patch.title = null; // name follows the new text
        updated = await api('PATCH', `/api/content/${editing.id}`, patch);
      } catch (err) {
        // Keep the person's work: offer to save it as a separate new draft
        if (editing.workspaceId === currentWorkspaceId
            && confirm(`Couldn’t save your changes to the existing post: ${err.message}\n\nSave your text as a new draft instead?`)) {
          State.composeEditing = null;
          State.composeDraftId = null;
          document.getElementById('compose-editing').hidden = true;
          const created = await api('POST', '/api/content', { body: content, platforms, image_url, options });
          State.composeDraftId = created.id;
          State.composeSavedText = content;
          return openPostNext();
        }
        throw new Error(`Couldn’t save your changes: ${err.message}. Your text is still here to copy.`);
      }
      State.composeSavedText = content;
      editing.status = updated.status;
      editing.updated_at = updated.updated_at;
      editing.title = postTitle(updated);
      editing.saved = composeSnapshot();
      composeEditingBanner(); // a failed post is a draft again now
      if (updated.status === 'in_review') {
        // Still waiting for a reviewer: nothing more to choose here
        resetCompose();
        toast('Changes saved. The post is still waiting for review on the Calendar.', 'success', 6000);
        navigateTo('calendar');
        return;
      }
    } else {
      if (State.composeDraftId) {
        try {
          await api('PATCH', `/api/content/${State.composeDraftId}`, { body: content, platforms, image_url, options });
        } catch { State.composeDraftId = null; } // gone or no longer editable: save a new one
      }
      if (!State.composeDraftId) {
        const created = await api('POST', '/api/content', { body: content, platforms, image_url, options });
        State.composeDraftId = created.id;
      }
      State.composeSavedText = content;
    }
    openPostNext();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save &amp; continue →';
  }
}

function openPostNext() {
  const { content, platforms } = composeFields();
  const preview = document.getElementById('post-next-preview');
  preview.replaceChildren();
  const text = document.createElement('div');
  text.className = 'next-preview-text';
  text.textContent = content.length > 220 ? `${content.slice(0, 220)}…` : content;
  const where = document.createElement('div');
  where.className = 'next-preview-meta';
  where.textContent = `To: ${platforms.map(p => PLATFORMS[p]?.label || p).join(', ')} · ${State.composeEditing ? 'changes saved (draft)' : 'saved as a draft'}`;
  preview.append(text, where);
  // Offer the most likely next step for this person
  const allowed = allowedPostModes();
  setPostMode(allowed.includes(State.postMode) && State.postMode !== 'draft' ? State.postMode : (allowed.includes('schedule') ? 'schedule' : 'review'));
  const modal = document.getElementById('post-next-modal');
  // Page sections are animated (transform), which would trap a fixed overlay inside them
  if (modal.parentElement !== document.body) document.body.appendChild(modal);
  modal.style.display = 'flex';
  modal.querySelector('.seg[aria-checked="true"]')?.focus();
}

function closePostNext() {
  document.getElementById('post-next-modal').style.display = 'none';
}

async function submitPost() {
  const id = State.composeDraftId;
  if (!id) return closePostNext();
  const { platforms } = composeFields();
  const mode = State.postMode;

  if (mode === 'draft') {
    closePostNext();
    resetCompose();
    toast('Kept as a draft. Find it on the Calendar whenever you’re ready.', 'success', 6000);
    return;
  }
  if (mode === 'now') {
    const warnings = composeWarnings();
    if (warnings.length) return toast(warnings.join(' '), 'warning', 8000);
    const names = platforms.map(p => PLATFORMS[p]?.label || p).join(', ');
    if (!confirm(`Publish this post to ${names} now?\n\nIt goes live straight away and can't be undone from here.`)) return;
  }

  let schedule = null;
  if (mode === 'schedule') {
    const at = document.getElementById('compose-schedule-at').value;
    if (!at || new Date(at) <= new Date()) return toast('Pick a time in the future', 'warning');
    const rep = readRepeat();
    if (rep?.error) return toast(rep.error, 'warning');
    schedule = {
      scheduled_at: Math.floor(new Date(at).getTime() / 1000),
      repeat: rep ? { every: rep.every, ...(rep.until ? { until: rep.until } : { count: rep.count }) } : undefined,
    };
  }

  const btn = document.getElementById('btn-submit-post');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${mode === 'now' ? 'Publishing…' : mode === 'review' ? 'Sending…' : 'Scheduling…'}`;
  try {
    if (mode === 'review') {
      const at = document.getElementById('compose-schedule-at').value;
      if (at && new Date(at) > new Date()) await api('PATCH', `/api/content/${id}`, { scheduled_at: Math.floor(new Date(at).getTime() / 1000) });
      await api('PATCH', `/api/content/${id}/status`, { toStatus: 'in_review' });
      toast('Sent for review. It’s on the Calendar as "In review" until someone approves it.', 'success', 6000);
    } else if (mode === 'now') {
      const data = await api('POST', `/api/content/${id}/publish`);
      const ok = data.results.filter(r => r.success).map(r => PLATFORMS[r.platform]?.label || r.platform);
      const bad = data.results.filter(r => !r.success);
      if (ok.length) toast(`Published to ${ok.join(', ')}`, 'success');
      bad.forEach(r => toast(`${PLATFORMS[r.platform]?.label || r.platform || 'Post'}: ${r.error}`, 'error', 9000));
      data.results.filter(r => r.success && r.warning).forEach(r => toast(`${PLATFORMS[r.platform]?.label || r.platform}: ${r.warning}`, 'warning', 9000));
      if (!ok.length) toast('Nothing was published. The post is on the Calendar as "Failed": fix the problem, then press Retry there.', 'warning', 9000);
    } else {
      const data = await api('POST', `/api/content/${id}/schedule`, schedule);
      const fmt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      toast(data.series_id
        ? `Scheduled ${data.count} posts (${REPEAT_LABEL[data.every].toLowerCase()}), from ${fmt(data.first_at)} to ${fmt(data.last_at)}`
        : `Scheduled for ${fmt(schedule.scheduled_at * 1000)}`, 'success', 6000);
    }
    closePostNext();
    resetCompose();
    loadScheduled();
  } catch (err) {
    toast(err.message, 'error', 8000);
  } finally {
    btn.disabled = false;
    btn.innerHTML = POST_MODES[State.postMode]?.button || '📅 Schedule post';
    if (State.postMode === 'schedule') updateRepeatSummary();
  }
}

async function loadScheduled() {
  try {
    const [posts, failed] = await Promise.all([
      api('GET', '/api/posts/scheduled'),
      api('GET', '/api/posts/scheduled/failed').catch(() => []),
    ]);
    State.scheduledPosts = posts;
    renderScheduledList(posts, failed);
  } catch {}
}

async function retryScheduled(id) {
  try {
    await api('POST', `/api/posts/scheduled/${id}/retry`);
    toast('Will try again in about a minute', 'info');
    loadScheduled();
  } catch (err) { toast(err.message, 'error'); }
}

function renderFailedScheduled(failed) {
  if (!failed.length) return '';
  return `<div style="margin-top:14px;font-size:12px;font-weight:600;color:#ef4444">⚠️ Failed in the last 14 days</div>` +
    failed.map(post => {
      const dt = new Date(post.scheduled_at * 1000);
      const errors = (Array.isArray(post.result) ? post.result : []).filter(r => !r.success)
        .map(r => `${PLATFORMS[r.platform]?.icon || ''} ${escapeHtml(r.error || 'failed')}`).join('<br>');
      return `
      <div class="scheduled-item" style="border-left:3px solid #ef4444">
        <div class="scheduled-time">
          <div class="scheduled-time-date">${dt.toLocaleDateString('en', {month:'short', day:'numeric'})}</div>
          <div class="scheduled-time-hour">${dt.toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'})}</div>
        </div>
        <div class="scheduled-content">
          <div class="scheduled-text">${escapeHtml(post.content.substring(0, 120))}${post.content.length > 120 ? '…' : ''}</div>
          <div style="font-size:11px;color:#ef4444;margin-top:4px">${errors || 'Failed'}</div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="retryScheduled(${post.id})" title="Try again">🔁 Retry</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="cancelScheduled(${post.id})" title="Delete">🗑</button>
      </div>`;
    }).join('');
}

function renderScheduledList(posts, failed = []) {
  const list = document.getElementById('scheduled-list');
  if (!posts.length) {
    list.innerHTML = `<div class="empty-state" style="padding:30px 0">
      <div class="empty-icon">📅</div>
      <div class="empty-title">No scheduled posts</div>
      <div class="empty-desc">Schedule a post to see it here.</div>
    </div>` + renderFailedScheduled(failed);
    return;
  }

  // A repeating schedule shows once: its next post, how many are left and when it ends
  const seen = new Map();
  for (const post of posts) {
    if (!post.series_id) continue;
    const g = seen.get(post.series_id) || { left: 0, last: 0 };
    g.left++; g.last = Math.max(g.last, post.scheduled_at);
    seen.set(post.series_id, g);
  }
  const shown = new Set();
  const rows = posts.filter(p => !p.series_id || (!shown.has(p.series_id) && shown.add(p.series_id)));

  list.innerHTML = rows.map(post => {
    const dt = new Date(post.scheduled_at * 1000);
    const platforms = Array.isArray(post.platforms) ? post.platforms : [];
    const g = post.series_id ? seen.get(post.series_id) : null;
    const seriesHtml = g ? `<div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span class="series-chip">🔁 ${escapeHtml(REPEAT_LABEL[post.series_every] || 'Repeats')}</span>
        <span style="font-size:11px;color:var(--text-muted)">${g.left} post${g.left === 1 ? '' : 's'} left · last on ${new Date(g.last * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      </div>` : '';
    const actions = g
      ? `<button class="btn btn-secondary btn-sm" onclick="stopSeries(${jsAttr(post.series_id)}, ${g.left})" title="Remove the posts that haven't gone out yet">Stop series</button>`
      : `<button class="btn btn-danger btn-sm btn-icon" onclick="cancelScheduled(${post.id})" title="Cancel" aria-label="Cancel this post">🗑</button>`;
    return `
      <div class="scheduled-item">
        <div class="scheduled-time">
          <div class="scheduled-time-date">${dt.toLocaleDateString('en', {month:'short', day:'numeric'})}</div>
          <div class="scheduled-time-hour">${dt.toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'})}</div>
        </div>
        <div class="scheduled-content">
          <div class="scheduled-text">${escapeHtml(post.content.substring(0, 120))}${post.content.length > 120 ? '…' : ''}</div>
          <div class="scheduled-platforms">
            ${platforms.map(p => `<span class="scheduled-platform-tag">${PLATFORMS[p]?.icon || ''} ${escapeHtml(PLATFORMS[p]?.label || p)}</span>`).join('')}
          </div>
          ${seriesHtml}
        </div>
        ${actions}
      </div>`;
  }).join('') + renderFailedScheduled(failed);
}

// ── Repeating schedules ─────────────────────────────────────────────────────
const REPEAT_LABEL = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };

// Same rules as services/recurrence.js (the server re-checks everything)
function repeatDates(start, every, { count, until }) {
  const out = [];
  const max = 365;
  let untilDate = null;
  if (until) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until);
    if (!m) return { error: 'Pick an end date.' };
    untilDate = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
    if (untilDate < start) return { error: 'The end date is before the first post.' };
    if ((untilDate - start) / 86400000 > 731) return { error: 'A repeating schedule can run for up to 2 years.' };
  } else if (!Number.isInteger(count) || count < 2) return { error: 'Choose how many times to post (at least 2).' };
  else if (count > max) return { error: `A repeating schedule can have up to ${max} posts.` };
  const limit = until ? max : count;
  for (let i = 0; i < limit; i++) {
    const d = new Date(start.getTime());
    if (every === 'daily') d.setDate(start.getDate() + i);
    else if (every === 'weekly') d.setDate(start.getDate() + 7 * i);
    else {
      const total = start.getMonth() + i, y = start.getFullYear() + Math.floor(total / 12), mo = total % 12;
      d.setFullYear(y, mo, Math.min(start.getDate(), new Date(y, mo + 1, 0).getDate()));
    }
    if (untilDate && d > untilDate) break;
    if ((d - start) / 86400000 > 731) break;
    out.push(d);
  }
  if (out.length < 2) return { error: 'That end date leaves only one post. Choose a later date, or set Repeat to "Does not repeat".' };
  if (until && out.length >= max) return { error: `That is more than ${max} posts. Choose an earlier end date.` };
  return { dates: out };
}

// Reads the Repeat controls. Returns null (no repeat), { error }, or { every, count|until, dates }
function readRepeat() {
  const every = document.getElementById('compose-repeat')?.value || 'none';
  if (every === 'none') return null;
  const startStr = document.getElementById('compose-schedule-at').value;
  if (!startStr) return { error: 'Pick the date and time of the first post.' };
  const byDate = document.querySelector('input[name="repeat-end"]:checked')?.value === 'until';
  const opts = byDate
    ? { until: document.getElementById('compose-repeat-until').value }
    : { count: parseInt(document.getElementById('compose-repeat-count').value, 10) };
  const r = repeatDates(new Date(startStr), every, opts);
  return r.error ? r : { every, ...opts, dates: r.dates };
}

function updateRepeatSummary() {
  const every = document.getElementById('compose-repeat')?.value || 'none';
  const endBox = document.getElementById('repeat-end');
  const box = document.getElementById('repeat-summary');
  if (!box || !endBox) return;
  endBox.style.display = every === 'none' ? 'none' : 'block';
  // Sensible default end date: the day of the 5th post
  const untilInput = document.getElementById('compose-repeat-until');
  const startStr = document.getElementById('compose-schedule-at').value;
  if (every !== 'none' && untilInput && !untilInput.value && startStr) {
    const r5 = repeatDates(new Date(startStr), every, { count: 5 });
    if (r5.dates) {
      const d = r5.dates[4];
      untilInput.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  const btn = document.getElementById('btn-submit-post');
  const r = readRepeat();
  if (!r) {
    box.className = 'repeat-summary'; box.textContent = '';
    if (btn && State.postMode === 'schedule' && !btn.disabled) btn.textContent = '📅 Schedule post';
    return;
  }
  if (r.error) { box.className = 'repeat-summary err'; box.textContent = r.error; return; }
  const first = r.dates[0], last = r.dates[r.dates.length - 1];
  const time = first.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const when = r.every === 'daily' ? `every day at ${time}`
    : r.every === 'weekly' ? `every ${first.toLocaleDateString('en-IN', { weekday: 'long' })} at ${time}`
    : `on day ${first.getDate()} of every month at ${time}${first.getDate() > 28 ? ' (or the last day of shorter months)' : ''}`;
  const fmt = (d) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  box.className = 'repeat-summary ok';
  box.textContent = `${r.dates.length} posts, ${when}. First: ${fmt(first)}. Last: ${fmt(last)}, then the schedule ends.`;
  if (btn && State.postMode === 'schedule' && !btn.disabled) btn.textContent = `📅 Schedule ${r.dates.length} posts`;
}

async function stopSeries(seriesId, left) {
  const what = left == null ? 'All its posts that haven\'t gone out yet' : `The ${left} post${left === 1 ? '' : 's'} that haven't gone out yet`;
  if (!confirm(`Stop this repeating schedule?\n\n${what} will be removed. Posts already published stay.`)) return;
  try {
    const r = await api('DELETE', `/api/posts/series/${encodeURIComponent(seriesId)}`);
    toast(`Stopped: ${r.removed} upcoming post${r.removed === 1 ? '' : 's'} removed`, 'success');
    loadScheduled();
    if (State.currentPage === 'calendar') renderCalendar(State.calendarDate);
  } catch (err) { toast(err.message, 'error'); }
}

async function cancelScheduled(id) {
  if (!confirm('Cancel this scheduled post?')) return;
  try {
    await api('DELETE', `/api/posts/scheduled/${id}`);
    toast('Scheduled post cancelled', 'info');
    loadScheduled();
    if (State.currentPage === 'calendar') renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error');
  }
}
