// Content Studio: web pages, text files or pasted text -> a post per network (heading, text,
// hashtags) -> reviewed by the person -> scheduled. Server: /api/content/studio/*.
const Studio = { sources: [], posts: [] };
const STUDIO_MAX_FILE = 5 * 1024 * 1024;

function studioPlatformList() {
  return Object.keys(PLATFORMS).filter((k) => !PLATFORMS[k].hidden);
}

async function openContentStudio() {
  // Coming back from Brand kit: keep the posts that were being reviewed, with the new colours
  if (Studio.resume && Studio.posts.length) {
    Studio.resume = false;
    await studioLoadBrand();
    studioRenderCards([]);
    studioShowStep(2);
    studioLoadTray();
    studioReplan();
    document.getElementById('studio-modal').style.display = 'flex';
    return;
  }
  Studio.posts = [];
  Studio.editSeries = null;
  Studio.scopeAll = false;
  { const sc = document.getElementById('studio-scope'); if (sc) sc.value = 'one'; }
  studioShowStep(1);
  const box = document.getElementById('studio-platforms');
  if (box && !box.children.length) {
    box.innerHTML = studioPlatformList().map((k) =>
      `<label style="display:inline-flex;gap:5px;align-items:center;font-size:13px;border:1px solid var(--border);border-radius:8px;padding:5px 10px;cursor:pointer"><input type="checkbox" class="studio-plat" value="${k}" checked> ${escapeHtml(PLATFORMS[k].label)}</label>`).join('');
  }
  studioRenderSources();
  studioLoadChoices();
  if (typeof studioLoadTray === 'function') studioLoadTray(true);
  studioLoadTemplates();
  document.getElementById('studio-modal').style.display = 'flex';
}

// Saved templates: pick one to start from, or save a finished post as a template
async function studioLoadTemplates() {
  const sel = document.getElementById('studio-templates');
  if (!sel) return;
  try {
    const list = await api('GET', '/api/tools/templates');
    Studio.templates = list;
    sel.innerHTML = '<option value="">Start from a saved template…</option>' + list.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    sel.style.display = list.length ? '' : 'none';
  } catch { sel.style.display = 'none'; }
}
function studioUseTemplate(sel) {
  const t = (Studio.templates || []).find((x) => String(x.id) === sel.value);
  sel.value = '';
  if (!t) return;
  const ta = document.getElementById('studio-paste');
  ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + t.content;
  ta.focus();
}
async function studioSaveTemplate(i) {
  const p = Studio.posts[i]; if (!p || !String(p.text || '').trim()) return;
  const name = String(await askText({ title: 'Save as template', message: 'Name this template', value: String(p.heading || p.title || p.text).replace(/\s+/g, ' ').slice(0, 50), ok: 'Save' }) || '').trim();
  if (!name) return;
  try {
    await api('POST', '/api/tools/templates', { name, content: p.text.trim(), type: 'social_post', tags: p.platform || '' });
    toast('Saved as a template. Find it under Templates.', 'success');
    studioLoadTemplates();
  } catch (err) { toast(err.message, 'error'); }
}
function closeContentStudio() { document.getElementById('studio-modal').style.display = 'none'; }

// "Edit in Studio" on a draft: every draft saved together in that session comes back as one batch
async function studioEditSeries(seriesId) {
  try {
    const res = await api('GET', `/api/content/studio/series/${encodeURIComponent(seriesId)}`);
    await studioLoadBrand();
    await studioLoadTray(true);
    Studio.editSeries = res.series_id;
    Studio.resume = false;
    Studio.posts = res.posts.map((r) => {
      const p = { platform: r.platform, text: r.text, title: r.title, heading: r.title, limit: r.limit, can_post: true, keep: true, at: r.at };
      studioPicInit(p);
      const lib = r.media ? (State.studioLib || {})[r.media] : null;
      if (r.media) {
        // The saved picture comes back as the post's own picture; it can be replaced or edited
        p.pic.on = true;
        p.pic.own = { ref: r.media, url: lib ? lib.url : mediaSrc(r.media), kind: lib ? lib.kind : 'image' };
      } else p.pic.on = false;
      return p;
    });
    if (typeof closeContentDetail === 'function') closeContentDetail();
    studioRenderCards([]);
    studioShowStep(2);
    if (typeof studioRenderTimes === 'function') studioRenderTimes();
    studioPreflight();
    document.getElementById('studio-modal').style.display = 'flex';
    toast(`${Studio.posts.length} draft${Studio.posts.length === 1 ? '' : 's'} from one session are open together. Saving replaces them.`, 'info', 6000);
  } catch (err) { toast(err.message || 'Could not open these drafts.', 'error', 7000); }
}

// One screen: this only shows or hides the "your posts will appear here" hint and the picture tools
function studioShowStep(n) {
  Studio.step = n;
  const has = Studio.posts.length > 0;
  const set = (id, d) => { const el = document.getElementById(id); if (el) el.style.display = d; };
  set('studio-empty', has ? 'none' : '');
  set('studio-pic-tools', has ? 'flex' : 'none');
  if (!has) {
    const t = document.getElementById('studio-times'); if (t) t.innerHTML = '';
    const c = document.getElementById('studio-check'); if (c) c.innerHTML = '';
    const k = document.getElementById('studio-cards'); if (k) k.innerHTML = '';
  }
}

// How many posts to write for each network (1 to 30; fewer when many networks are picked)
function studioCountStep(d) {
  const el = document.getElementById('studio-count');
  const nets = Math.max(1, document.querySelectorAll('.studio-plat:checked').length);
  const max = Math.max(1, Math.min(30, Math.floor(60 / nets)));
  el.value = Math.max(1, Math.min(max, (Math.floor(Number(el.value)) || 1) + d));
}

function studioRenderSources() {
  const el = document.getElementById('studio-sources');
  if (!el) return;
  el.innerHTML = Studio.sources.length
    ? Studio.sources.map((s, i) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:13px"><span>📄 ${escapeHtml(s.name)} <span style="color:var(--text-muted)">· ${s.text.length.toLocaleString()} characters</span></span><a href="#" onclick="studioRemoveSource(${i});return false">Remove</a></div>`).join('')
    : '<div style="font-size:12.5px;color:var(--text-muted)">Nothing added yet.</div>';
}
// ── AI set-up pop-up (so nobody has to leave the Studio) ──
const STUDIO_AI_FIELDS = { 'studio-ai-google': 'google_ai_key', 'studio-ai-groq': 'groq_key', 'studio-ai-openrouter': 'openrouter_key', 'studio-ai-mistral': 'mistral_key', 'studio-ai-anthropic': 'anthropic_key' };
async function studioAiOpen(msg) {
  const failed = /providers failed/i.test(msg || '');
  document.getElementById('studio-ai-msg').textContent = String(msg || '').replace(/\n?Try again in a minute.*$/s, '').trim()
    + (failed ? '\nYour saved keys are listed below. A key that was rejected needs replacing; a busy or rate-limited one just needs a minute, or add a second provider.' : '');
  Object.keys(STUDIO_AI_FIELDS).forEach((id) => { const el = document.getElementById(id); el.value = ''; el.placeholder = el.dataset.ph || (el.dataset.ph = el.placeholder); });
  document.getElementById('studio-ai').style.display = 'flex';
  // Show which keys are already saved (masked) so nobody pastes the same one again
  try {
    const s = await api('GET', '/users/settings');
    for (const [id, key] of Object.entries(STUDIO_AI_FIELDS)) {
      if (s[key]) document.getElementById(id).placeholder = `Saved ${s[key]}. Paste a new key to replace it`;
    }
  } catch {}
}
function studioAiClose() { document.getElementById('studio-ai').style.display = 'none'; }
async function studioAiSave() {
  const body = {};
  for (const [id, key] of Object.entries(STUDIO_AI_FIELDS)) { const v = document.getElementById(id).value.trim(); if (v) body[key] = v; }
  if (!Object.keys(body).length) return toast('Paste at least one key.', 'info');
  const btn = document.getElementById('studio-ai-save');
  btn.disabled = true;
  try {
    await api('POST', '/users/settings', body);
    studioAiClose();
    if (typeof refreshAiStatus === 'function') refreshAiStatus();
    toast('AI key saved. Writing your posts…', 'success', 3000);
    studioGenerate();
  } catch (err) { toast(err.message || 'Could not save the key.', 'error', 6000); }
  finally { btn.disabled = false; }
}

function studioRemoveSource(i) { Studio.sources.splice(i, 1); studioRenderSources(); }

async function studioAddFiles(files) {
  for (const f of Array.from(files || [])) {
    if (f.size > STUDIO_MAX_FILE) { toast(`${f.name} is too big (over 5 MB).`, 'warning'); continue; }
    try {
      // The server reads Excel, CSV, HTML, text and anything else that holds text
      const res = await fetch('/api/content/studio/read-file', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) }, body: f,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not read ${f.name}.`);
      Studio.sources.push({ name: f.name, text: data.text });
    } catch (err) { toast(err.message || `Could not read ${f.name}.`, 'warning', 6000); }
  }
  studioRenderSources();
}
function studioAddPasted() {
  const ta = document.getElementById('studio-paste');
  const text = (ta.value || '').trim();
  if (text.length < 20) return toast('Paste at least a sentence of text first.', 'info');
  Studio.sources.push({ name: `Pasted text ${Studio.sources.filter((s) => /^Pasted/.test(s.name)).length + 1}`, text });
  ta.value = '';
  studioRenderSources();
}

// Moving placeholders in the middle panel while the posts are written
let studioBusyTimer = null;
function studioBusy(on, n) {
  const busy = document.getElementById('studio-busy');
  if (!busy) return;
  clearInterval(studioBusyTimer);
  busy.style.display = on ? 'block' : 'none';
  const empty = document.getElementById('studio-empty');
  if (on) {
    if (empty) empty.style.display = 'none';
    document.getElementById('studio-cards').style.display = 'none';
    const steps = ['Reading your content…', 'Finding the best ideas…', `Writing ${n} post${n === 1 ? '' : 's'}…`, 'Matching each network’s style…', 'Almost there…'];
    let k = 0;
    const t = document.getElementById('studio-busy-text');
    t.textContent = steps[0];
    studioBusyTimer = setInterval(() => { k = Math.min(k + 1, steps.length - 1); t.textContent = steps[k]; }, 4000);
  } else {
    document.getElementById('studio-cards').style.display = '';
    if (empty && !Studio.posts.length) empty.style.display = '';
  }
}
async function studioGenerate() {
  // Text left in the paste box counts too
  if ((document.getElementById('studio-paste').value || '').trim().length >= 20) studioAddPasted();
  const platforms = Array.from(document.querySelectorAll('.studio-plat:checked')).map((c) => c.value);
  if (!Studio.sources.length) return toast('Add a file or paste some text first.', 'info');
  if (!platforms.length) return toast('Pick at least one platform.', 'info');
  studioSaveChoices();
  const btn = document.getElementById('studio-generate-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Writing… (can take a minute)';
  studioBusy(true, Math.floor(Number(document.getElementById('studio-count').value)) || 1);
  try {
    const res = await api('POST', '/api/content/studio/generate', {
      sources: Studio.sources, platforms, language: document.getElementById('studio-language').value.trim(),
      count: Math.floor(Number(document.getElementById('studio-count').value)) || 1,
    });
    Studio.posts = (res.posts || []).map((p) => ({ ...p, title: p.heading, keep: p.can_post }));
    Studio.posts.forEach(studioPicInit);
    await studioLoadBrand();
    studioRenderCards(res.problems || []);
    const d = new Date(Date.now() + 3600 * 1000);
    d.setMinutes(0, 0, 0);
    document.getElementById('studio-start').value = studioLocalInput(d.getTime() / 1000);
    studioShowStep(2);
    studioLoadTray();
    studioReplan();
  } catch (err) {
    // An AI problem is fixed right here: a pop-up to paste a key, then the posts are written again
    if (/AI provider|AI isn|AI isn’t|Settings → AI|No AI/i.test(err.message || '')) studioAiOpen(err.message);
    else toast(err.message || 'Could not write the posts.', 'error', 7000);
  } finally {
    studioBusy(false);
    btn.disabled = false;
    btn.textContent = label;
  }
}

const studioAsk = async (msg) => (typeof askConfirm === 'function' ? askConfirm(msg) : confirm(msg));
// Write the posts yourself: one post per ticked network with your own text, no AI needed
async function studioWriteMyself() {
  const platforms = Array.from(document.querySelectorAll('.studio-plat:checked')).map((c) => c.value);
  if (!platforms.length) return toast('Pick at least one platform.', 'info');
  const ta = document.getElementById('studio-paste');
  const text = (ta.value || '').trim();
  if ((Studio.posts || []).some((p) => String(p.text || '').trim() || (p.pic && p.pic.own)) && !(await studioAsk('This replaces the posts you have now. Continue?'))) return;
  Studio.editSeries = null;
  Studio.posts = platforms.map((platform) => {
    const p = { platform, text, title: '', heading: '', limit: (typeof PLATFORM_CHAR_LIMITS !== 'undefined' && PLATFORM_CHAR_LIMITS[platform]) || null, can_post: true, keep: true };
    studioPicInit(p);
    p.pic.on = false; // no made picture unless you ask for one
    return p;
  });
  studioSaveChoices();
  await studioLoadBrand();
  studioRenderCards([]);
  const d = new Date(Date.now() + 3600 * 1000);
  d.setMinutes(0, 0, 0);
  document.getElementById('studio-start').value = studioLocalInput(d.getTime() / 1000);
  studioShowStep(2);
  studioLoadTray();
  studioReplan();
  if (!text) toast('Type your post in each box. You can add a picture too.', 'info', 5000);
}

// ── Pictures: a branded image per post, drawn on this PC by the Post designer ──
const STUDIO_PIC_SIZE = { instagram: 'square', facebook: 'square', threads: 'square', pinterest: 'portrait' };
const STUDIO_COLORS = { linkedin: '#0a66c2', facebook: '#1877f2', instagram: '#e1306c', twitter: '#111827', threads: '#6b7280', bluesky: '#0085ff', pinterest: '#e60023', google_business: '#34a853', youtube: '#ff0000', tiktok: '#14b8a6' };
const STUDIO_PIC_STYLES = { announce: 'Announcement', offer: 'Offer / sale', tip: 'Tip or quote', festival: 'Festival greeting' };

async function studioLoadBrand() {
  if (typeof renderDesign !== 'function') return;
  try { Designer.brand = await api('GET', '/api/tools/brand-kit'); } catch { Designer.brand = {}; }
  Designer.photo = null;
  try { await loadBrandLogo(Designer.brand?.logo_url); await ensureBrandFont(); } catch {}
}
function studioPicInit(p) {
  const firstLine = String(p.text || '').split(/\n/).map((l) => l.trim()).find(Boolean) || '';
  p.pic = { on: !!p.can_post, logo: true, template: 'announce', look: 0, headline: String(p.title || firstLine).slice(0, 90) };
}
// The post's first sentence, without hashtags or links, becomes the picture's small text
function studioPicDetails(text, headline) {
  let lines = String(text || '').replace(/#\S+/g, '').replace(/https?:\/\/\S+/g, '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] && lines[0].toLowerCase() === String(headline).toLowerCase()) lines = lines.slice(1);
  const all = lines.join(' ');
  const first = (all.match(/^.*?[.!?](\s|$)/) || [all])[0].trim();
  return first.length > 110 ? first.slice(0, 107).replace(/\s+\S*$/, '') + '…' : first;
}
// Colour looks made from the Brand kit's three colours: each puts a different one in front
function studioBrandColors() {
  const d = designDefaults();
  return [d.c1, d.c2, d.c3];
}
function studioPicSettings(p) {
  const d = designDefaults();
  const [a, b, c] = [d.c1, d.c2, d.c3];
  const looks = [[a, b, c], [b, c, a], [c, a, b]];
  const [c1, c2, c3] = looks[p.pic.look] || looks[0];
  const tagline = String(Designer.brand?.tagline || '').slice(0, 30);
  return { ...d, c1, c2, c3, fullBg: true, showLogo: !!p.pic.logo, size: STUDIO_PIC_SIZE[p.platform] || 'wide', template: p.pic.template, logoPos: p.pic.logoPos || undefined, line: String(p.pic.line || '').trim(), headline: p.pic.headline, details: studioPicDetails(p.text, p.pic.headline), cta: p.pic.template === 'offer' ? tagline : '' };
}
// ── Preview of the selected post, shown on the right ──
function studioSelect(i) {
  if (!Studio.posts[i]) return;
  Studio.sel = i;
  document.querySelectorAll('.studio-card').forEach((el, k) => { el.style.boxShadow = k === i ? '0 0 0 2px var(--studio-c)' : 'none'; });
  studioPreview();
}
function studioPreview() {
  const box = document.getElementById('studio-preview');
  const i = Studio.sel || 0;
  const p = Studio.posts[i];
  if (!box) return;
  if (!p) { box.innerHTML = '<div style="font-size:12.5px;color:var(--text-muted)">Click a post to see how it will look.</div>'; return; }
  const pm = PLATFORMS[p.platform] || { label: p.platform };
  let media = '';
  if (p.pic && p.pic.on) {
    if (p.pic.own && p.pic.own.kind === 'video') media = `<video src="${escapeHtml(p.pic.own.url)}" muted controls style="width:100%;display:block"></video>`;
    else {
      const c = document.getElementById(`studio-pic-${i}`);
      let src = p.pic.own ? p.pic.own.url : '';
      try { if (c && c.width > 1) src = c.toDataURL('image/png'); } catch {}
      if (src) media = `<img src="${escapeHtml(src)}" alt="Picture" style="width:100%;display:block">`;
    }
  }
  const when = Number.isFinite(p.at) ? new Date(p.at * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Time not set yet';
  box.innerHTML = `<div style="border:1px solid var(--border);border-top:4px solid ${STUDIO_COLORS[p.platform] || '#7c3aed'};border-radius:10px;overflow:hidden;background:var(--bg-card,#fff)">
    <div style="padding:8px 10px;font-size:12.5px;font-weight:700;display:flex;justify-content:space-between"><span>${escapeHtml(pm.label)}</span><span style="font-weight:400;color:var(--text-muted)">${escapeHtml(when)}</span></div>
    ${media}
    <div style="padding:10px;font-size:13px;white-space:pre-wrap;word-break:break-word;max-height:30vh;overflow:auto">${escapeHtml(p.text)}</div>
  </div>`;
}
// One place for every picture setting. With "All posts" chosen, the change goes to every post's picture
// (the headline always stays with its own post).
function studioPicApply(i, key, v) {
  const all = Studio.scopeAll && key !== 'headline';
  const targets = all ? Studio.posts.map((p, k) => k).filter((k) => Studio.posts[k].can_post && Studio.posts[k].pic) : [i];
  targets.forEach((k) => { Studio.posts[k].pic[key] = v; });
  if (targets.length > 1) { // many cards: wait until typing pauses before redrawing them all
    clearTimeout(Studio.applyTimer);
    Studio.applyTimer = setTimeout(() => studioRenderCards([]), 300);
  } else studioPicDraw(i);
}
function studioPicLogo(i, on) { studioPicApply(i, 'logo', on); }
function studioScope(v) {
  Studio.scopeAll = v === 'all';
  toast(Studio.scopeAll ? 'Picture changes now apply to all posts (headlines stay separate).' : 'Picture changes now apply to this post only.', 'info', 4000);
}
// Go to Brand kit to change colours, font or logo; the posts being reviewed are kept
function studioOpenBrand() {
  Studio.resume = true;
  closeContentStudio();
  if (typeof navigateTo === 'function') navigateTo('brand');
  studioBackBar(true);
}
// A button that stays on screen while you are in Brand kit and takes you back to the Studio
function studioBackBar(on) {
  let bar = document.getElementById('studio-back-bar');
  if (!on) { if (bar) bar.remove(); return; }
  if (bar) return;
  bar = document.createElement('div');
  bar.id = 'studio-back-bar';
  bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:1100;display:flex;gap:10px;align-items:center;background:#111827;color:#fff;border-radius:999px;padding:8px 10px 8px 16px;box-shadow:0 8px 30px #0006;font-size:14px';
  bar.innerHTML = '<span>Update your colours, font and logo, then</span><button class="btn btn-primary btn-sm" onclick="studioBackToStudio()">← Back to Content Studio</button><button class="btn btn-secondary btn-sm" onclick="studioBackBar(false);Studio.resume=false" aria-label="Dismiss">✕</button>';
  document.body.appendChild(bar);
}
function studioBackToStudio() {
  studioBackBar(false);
  openContentStudio();
}
function studioPicLook(i, look) {
  document.querySelectorAll(`#studio-picbox-${i} .studio-look`).forEach((b) => { b.style.outline = Number(b.dataset.look) === look ? '2px solid var(--text)' : 'none'; });
  studioPicApply(i, 'look', look);
}
function studioBrandNote() {
  const b = Designer.brand || {};
  const sw = studioBrandColors().map((c) => `<span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${escapeHtml(c)};border:1px solid var(--border);vertical-align:middle"></span>`).join(' ');
  return b.primary_color || b.company_name || b.logo_url
    ? `Pictures use your Brand kit: ${sw} ${escapeHtml(b.font_name || 'Inter')}${b.logo_url ? ', your logo' : ', no logo added yet'}. <a href="#" onclick="studioOpenBrand();return false">Update colours, font or logo</a>`
    : `Your Brand kit is empty, so pictures use default colours and no logo. <a href="#" onclick="studioOpenBrand();return false">Set your colours, font and logo</a> so they look like you.`;
}
function studioPicDraw(i) {
  const p = Studio.posts[i];
  const c = document.getElementById(`studio-pic-${i}`);
  if (!c || !p || !p.pic || !p.pic.on || typeof renderDesign !== 'function') return;
  if (p.pic.own) {
    // The person's own image: shown as it is, nothing drawn over it
    const img = new Image();
    img.onload = () => { c.width = 480; c.height = Math.round(480 * (img.naturalHeight / img.naturalWidth)) || 270; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); if (Studio.sel === i) studioPreview(); };
    img.src = p.pic.own.url;
    return;
  }
  try { renderDesign(c, studioPicSettings(p)); } catch {}
  if (Studio.sel === i) studioPreview();
}
// ── Media tray: everything in the media library, shown inside the Studio ──
// Drag a picture or video onto a post, or click it to add it to the post you are on.
async function studioLoadTray(force) {
  if (!State.studioMediaItems || force) {
    try { State.studioMediaItems = (await api('GET', '/api/media-library')).filter((a) => a.kind === 'image' || a.kind === 'video'); }
    catch { State.studioMediaItems = []; }
    State.studioLib = Object.fromEntries(State.studioMediaItems.map((a) => [a.ref, { url: a.url, kind: a.kind }]));
  }
  studioRenderTray();
}
function studioTrayItems(clickJs) {
  const items = State.studioMediaItems || [];
  if (!items.length) return '<span style="font-size:12px;color:var(--text-muted)">Nothing in your media library yet. Drop pictures or videos here to add them.</span>';
  return items.slice(0, 80).map((a) => {
    const name = escapeHtml(a.original_name || (a.kind === 'video' ? 'Video' : 'Image'));
    const thumb = a.kind === 'video'
      ? `<video src="${escapeHtml(a.url)}" muted preload="metadata" style="width:100%;height:100%;object-fit:contain"></video><span style="position:absolute;right:3px;bottom:3px;background:#000a;color:#fff;font-size:10px;border-radius:4px;padding:0 4px">▶</span>`
      : `<img src="${escapeHtml(a.url)}" alt="${name}" loading="lazy" style="width:100%;height:100%;object-fit:contain;display:block">`;
    return `<div draggable="true" title="${name}" ondragstart="studioTrayDrag(event,'${escapeHtml(a.ref)}')" onclick="${clickJs}('${escapeHtml(a.ref)}')" style="position:relative;width:74px;height:60px;flex:none;border-radius:8px;overflow:hidden;border:2px solid transparent;cursor:grab;background:repeating-conic-gradient(#8883 0 25%,#fff3 0 50%) 0 0/10px 10px" onmouseover="this.style.borderColor='#7c3aed'" onmouseout="this.style.borderColor='transparent'">${thumb}${clickJs === 'studioTrayClick' ? `<button type="button" title="${a.kind === 'video' ? 'Edit this video' : 'Edit this picture'}" aria-label="${a.kind === 'video' ? 'Edit this video' : 'Edit this picture'}" onclick="event.stopPropagation();${a.kind === 'video' ? `studioEditVideo(${jsAttr(a.url)},-1,${jsAttr(a.original_name || 'video')})` : `studioEditPhoto(${jsAttr(a.url)})`}" style="position:absolute;left:3px;top:3px;border:0;border-radius:4px;background:#000a;color:#fff;font-size:11px;padding:0 4px;cursor:pointer">✏️</button>` : ''}</div>`;
  }).join('');
}
function studioRenderTray() {
  const el = document.getElementById('studio-tray-items');
  if (el) el.innerHTML = studioTrayItems('studioTrayClick');
  const ed = document.getElementById('studio-ed-tray');
  if (ed) ed.innerHTML = studioTrayItems('studioEdTrayClick');
}
function studioTrayDrag(ev, ref) { ev.dataTransfer.setData('text/studio-media', ref); ev.dataTransfer.effectAllowed = 'copy'; }
// Files dropped (or chosen) on the tray go to the media library first
async function studioTrayUpload(files) {
  const list = Array.from(files || []).slice(0, 10);
  for (const f of list) {
    try { await uploadMediaFile(f); } catch (err) { toast(err.message, 'warning', 6000); }
  }
  if (list.length) { await studioLoadTray(true); toast('Added to your media library.', 'success', 2500); }
}
function studioTrayDropFiles(ev) {
  ev.preventDefault();
  ev.currentTarget.style.outline = 'none';
  if (ev.dataTransfer.files && ev.dataTransfer.files.length) studioTrayUpload(ev.dataTransfer.files);
}
// Attach a library item to a post as its picture or video
function studioAttachMedia(i, ref) {
  const m = (State.studioLib || {})[ref];
  const p = Studio.posts[i];
  if (!m || !p || !p.pic || !p.can_post) return;
  // A picture goes on top of the post's picture in the editor, where it can be moved and resized.
  // (Videos cannot be edited, so they still replace it.)
  if (m.kind === 'image' && typeof studioEditPicture === 'function') {
    p.pic.on = true;
    studioEditPicture(i).then((ok) => {
      if (ok && typeof studioEdAddUrl === 'function' && StudioEd.canvas && StudioEd.post === i) {
        studioEdAddUrl(m.url);
        toast('Drag the picture to move it, pull a corner to resize it, then press "Use this picture".', 'info', 7000);
      }
    });
    return;
  }
  p.pic.on = true;
  p.pic.own = { ref, url: m.url, kind: m.kind };
  studioRenderCards([]);
}
function studioTrayClick(ref) { // click: put it on the first post that still has no own media
  const i = Studio.posts.findIndex((p) => p.keep && p.can_post && p.pic && !p.pic.own);
  if (i < 0) return toast('Drag it onto the post you want.', 'info', 3000);
  studioAttachMedia(i, ref);
}
function studioDropOnPost(ev, i) {
  ev.preventDefault();
  ev.currentTarget.style.outline = 'none';
  const ref = ev.dataTransfer.getData('text/studio-media');
  if (ref) return studioAttachMedia(i, ref);
  const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (f) studioOwnImage(i, f);
}
// No posts yet: dropping a library item here starts posts for the ticked networks and puts it on the first one
async function studioDropStart(ev) {
  ev.preventDefault();
  const ref = ev.dataTransfer.getData('text/studio-media');
  if (!ref) return;
  await studioWriteMyself();
  const i = Studio.posts.findIndex((p) => p.can_post && p.pic);
  if (i >= 0) studioAttachMedia(i, ref);
}
function studioEdTrayClick(ref) {
  const m = (State.studioLib || {})[ref];
  if (m && m.kind === 'image' && typeof studioEdAddUrl === 'function') studioEdAddUrl(m.url);
  else toast('Only pictures can go inside the editor.', 'info', 3000);
}
async function studioOwnImage(i, file) {
  if (!file) return;
  if (!/^(image|video)\//.test(file.type)) return toast('Pick a picture or video file.', 'warning');
  try {
    const asset = await uploadMediaFile(file);
    if (!asset || !asset.ref) throw new Error('The file could not be saved to your media library.');
    Studio.posts[i].pic.on = true;
    Studio.posts[i].pic.own = { ref: asset.ref, url: asset.url || URL.createObjectURL(file), kind: asset.kind || (/^video/.test(file.type) ? 'video' : 'image') };
    studioLoadTray(true);
    studioRenderCards([]);
  } catch (err) { toast(err.message || 'Could not add the file.', 'error', 6000); }
}
function studioOwnClear(i) { delete Studio.posts[i].pic.own; studioRenderCards([]); }
function studioPicToggle(i, on) {
  Studio.posts[i].pic.on = on;
  const box = document.getElementById(`studio-picbox-${i}`);
  if (box) box.style.display = on ? 'flex' : 'none';
  studioPicDraw(i);
}
function studioPicSet(i, key, v) { studioPicApply(i, key, v); }
function studioPicAll(on) {
  Studio.posts.forEach((p, i) => {
    if (!p.can_post || !p.pic) return;
    const cb = document.getElementById(`studio-pic-on-${i}`);
    if (cb) cb.checked = on;
    studioPicToggle(i, on);
  });
}
// Draws the picture, saves it to the media library and returns its reference
async function studioMakePicture(p) {
  const canvas = document.createElement('canvas');
  renderDesign(canvas, studioPicSettings(p));
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not make a picture. Untick “Add a picture” on that post and try again.');
  const asset = await uploadMediaFile(new File([blob], `studio-${p.platform}-${Date.now()}.png`, { type: 'image/png' }));
  if (!asset || !asset.ref) throw new Error('The picture could not be saved to your media library.');
  return asset.ref;
}

function studioRenderCards(problems) {
  document.getElementById('studio-problems').innerHTML = problems.length
    ? `<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.4);border-radius:8px;padding:8px 12px;font-size:12.5px;white-space:pre-line;margin-bottom:10px">${problems.map((p) => `${escapeHtml(p.source)}: ${escapeHtml(p.error)}`).join('<br>')}</div>` : '';
  const bySource = {};
  Studio.posts.forEach((p, i) => { (bySource[p.source] = bySource[p.source] || []).push([p, i]); });
  document.getElementById('studio-cards').innerHTML = Object.keys(bySource).map((src) =>
    `<div style="font-weight:700;margin:12px 0 6px">📄 ${escapeHtml(src)}</div>` + bySource[src].map(([p, i]) => {
      const pm = PLATFORMS[p.platform] || { label: p.platform };
      const vid = p.pic && p.pic.own && p.pic.own.kind === 'video';
      return `<div class="studio-card" onclick="studioSelect(${i})" onfocusin="studioSelect(${i})" ondragover="event.preventDefault();this.style.outline='2px dashed #7c3aed'" ondragleave="this.style.outline='none'" ondrop="this.style.outline='none';studioDropOnPost(event,${i})" style="--studio-c:${STUDIO_COLORS[p.platform] || '#7c3aed'};border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
          <label style="display:flex;gap:6px;align-items:center;font-weight:600;font-size:13px"><input type="checkbox" ${p.keep ? 'checked' : ''} ${p.can_post ? '' : 'disabled'} onchange="studioToggle(${i},this.checked)"> ${escapeHtml(pm.label)}</label>
          <span style="display:flex;gap:10px;align-items:center"><a href="#" onclick="event.stopPropagation();studioSaveTemplate(${i});return false" style="font-size:11.5px" title="Keep this text to reuse later">💾 Save as template</a><span id="studio-count-${i}" style="font-size:11.5px"></span></span>
        </div>
        ${p.can_post ? '' : '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Posting here is not available yet. Copy the text instead.</div>'}
        <textarea class="form-textarea" rows="6" style="width:100%" oninput="studioEdit(${i},this.value)">${escapeHtml(p.text)}</textarea>
        ${p.can_post && p.pic && typeof renderDesign === 'function' ? `<div style="margin-top:8px">
          <label style="display:inline-flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="studio-pic-on-${i}" ${p.pic.on ? 'checked' : ''} onchange="studioPicToggle(${i},this.checked)"> 🖼️ Add a picture in your brand colours</label>
          <div id="studio-picbox-${i}" style="display:${p.pic.on ? 'flex' : 'none'};gap:10px;align-items:flex-start;flex-wrap:wrap;margin-top:8px">
            ${vid ? `<video src="${escapeHtml(p.pic.own.url)}" muted controls style="width:160px;border-radius:8px"></video>` : ''}
            <canvas id="studio-pic-${i}" style="width:${vid ? 0 : 160}px;height:auto;border-radius:8px;border:1px solid var(--border);${vid ? 'display:none' : ''}"></canvas>
            <div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:200px">
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('studio-own-${i}').click()">${p.pic.own ? 'Change my picture or video' : 'Use my own picture or video'}</button>
                <input type="file" id="studio-own-${i}" accept="image/*,video/mp4,video/quicktime" hidden onchange="studioOwnImage(${i},this.files[0])">
                ${vid ? `<button type="button" class="btn btn-primary btn-sm" onclick="studioEditVideo(${jsAttr(p.pic.own.url)},${i},'video')">✂️ Edit video</button>` : `<button type="button" class="btn btn-primary btn-sm" onclick="studioEditPicture(${i})">Edit picture</button>`}
                ${p.pic.own ? `<a href="#" onclick="studioOwnClear(${i});return false" style="font-size:12px">Use the made picture instead</a>` : ''}
              </div>
              <input type="text" class="form-input" maxlength="90" value="${escapeHtml(p.pic.headline)}" aria-label="Picture headline" onchange="studioPicSet(${i},'headline',this.value)">
              <select class="form-select" aria-label="Picture style" onchange="studioPicSet(${i},'template',this.value)">${Object.keys(STUDIO_PIC_STYLES).map((k) => `<option value="${k}" ${p.pic.template === k ? 'selected' : ''}>${STUDIO_PIC_STYLES[k]}</option>`).join('')}</select>
              <label style="display:inline-flex;gap:6px;align-items:center;font-size:12.5px"><input type="checkbox" ${p.pic.logo ? 'checked' : ''} ${Designer.logo ? '' : 'disabled'} onchange="studioPicLogo(${i},this.checked)"> Add my logo</label>
              <label style="display:inline-flex;gap:6px;align-items:center;font-size:12.5px">Logo position
                <select class="form-select" style="width:auto;padding:3px 8px;font-size:12.5px" onchange="studioPicSet(${i},'logoPos',this.value)">${[['', 'Automatic'], ['tl', 'Top left'], ['tc', 'Top middle'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']].map(([v, l]) => `<option value="${v}" ${(p.pic.logoPos || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <input type="text" class="form-input" maxlength="80" value="${escapeHtml(p.pic.line || '')}" placeholder="Line on every picture, e.g. Call +91 98765 43210" aria-label="Line shown on the picture" onchange="studioPicSet(${i},'line',this.value)">
              ${Designer.logo ? '' : `<div style="font-size:12px;color:var(--warning,#b45309)">${escapeHtml(Designer.logoNote || (Designer.brand && Designer.brand.logo_url ? 'Your logo could not be loaded.' : 'No logo in your Brand kit yet.'))} <a href="#" onclick="studioOpenBrand();return false">Add or fix your logo</a></div>`}
              <div style="display:flex;gap:6px;align-items:center;font-size:12px" aria-label="Colour look">Colours
                ${[0, 1, 2].map((n) => { const cs = studioBrandColors(); const l = [[0, 1], [1, 2], [2, 0]][n]; return `<button type="button" class="studio-look" data-look="${n}" title="Colour look ${n + 1}" onclick="studioPicLook(${i},${n})" style="width:30px;height:22px;border-radius:6px;border:1px solid var(--border);cursor:pointer;padding:0;background:linear-gradient(90deg,${escapeHtml(cs[l[0]])} 50%,${escapeHtml(cs[l[1]])} 50%);${p.pic.look === n ? 'outline:2px solid var(--text)' : ''}"></button>`; }).join('')}
              </div>
            </div>
          </div>
        </div>` : ''}
      </div>`;
    }).join('')).join('');
  const note = document.getElementById('studio-brand-note');
  if (note) note.innerHTML = studioBrandNote();
  Studio.posts.forEach((_, i) => { studioCount(i); studioPicDraw(i); });
  studioShowStep(2);
  studioSelect(Math.min(Studio.sel || 0, Studio.posts.length - 1));
}
function studioCount(i) {
  const p = Studio.posts[i];
  const el = document.getElementById(`studio-count-${i}`);
  if (!el) return;
  const over = p.limit && p.text.length > p.limit;
  el.textContent = `${p.text.length}${p.limit ? ' / ' + p.limit : ''}`;
  el.style.color = over ? '#ef4444' : 'var(--text-muted)';
}
function studioEdit(i, v) { Studio.posts[i].text = v; studioCount(i); if (Studio.sel === i) studioPreview(); }
function studioToggle(i, on) { Studio.posts[i].keep = on; if (typeof studioReplan === 'function') studioReplan(); }

function studioChosen() { return Studio.posts.filter((p) => p.keep && p.can_post); }

// ── Step 3: when each post goes out ──
const studioLocalInput = (sec) => { const d = new Date(sec * 1000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
function studioToWhen() {
  const chosen = studioChosen();
  if (!chosen.length) return toast('Tick at least one post.', 'info');
  const over = chosen.find((p) => p.limit && p.text.length > p.limit);
  if (over) return toast(`The ${(PLATFORMS[over.platform] || {}).label || over.platform} post is over its limit. Shorten it.`, 'warning', 6000);
  studioShowStep(3);
  studioReplan();
}
// Plans every chosen post from the first time and the gap, then lets each be changed
function studioReplan() {
  const chosen = studioChosen();
  const first = Math.floor(new Date(document.getElementById('studio-start').value).getTime() / 1000);
  const mode = document.getElementById('studio-interval').value;
  const days = { weekdays: [1, 2, 3, 4, 5], mwf: [1, 3, 5] }[mode];
  if (days && Number.isFinite(first)) {
    // Fixed days of the week, at the same time of day as the first post
    const d = new Date(first * 1000);
    chosen.forEach((p) => {
      while (!days.includes(d.getDay())) d.setDate(d.getDate() + 1);
      p.at = Math.floor(d.getTime() / 1000);
      d.setDate(d.getDate() + 1);
    });
  } else {
    const gap = (Number(mode) || 24) * 3600;
    chosen.forEach((p, k) => { p.at = Number.isFinite(first) ? first + k * gap : null; });
  }
  studioRenderTimes();
}
// "Post now": the first goes out in a minute, the rest two minutes apart so no network is flooded
function studioPostNow() {
  const now = Math.floor(Date.now() / 1000) + 60;
  studioChosen().forEach((p, k) => { p.at = now + k * 120; });
  studioSchedule('scheduled');
}
// Plain checks before anything is saved: times in the past, text over a limit, posts that cannot go out
function studioPreflight() {
  const chosen = studioChosen();
  const now = Math.floor(Date.now() / 1000);
  const notes = [];
  const past = chosen.filter((p) => !Number.isFinite(p.at) || p.at < now + 60).length;
  if (past) notes.push({ text: `${past} post${past === 1 ? ' has' : 's have'} a time that has passed or is missing.`, fix: 'Move them to later', fn: 'studioFixTimes()' });
  const over = chosen.filter((p) => p.limit && p.text.length > p.limit).length;
  if (over) notes.push({ text: `${over} post${over === 1 ? ' is' : 's are'} over the network's length limit. Go back and shorten ${over === 1 ? 'it' : 'them'}.` });
  const needMedia = (typeof PLATFORM_NEEDS_MEDIA !== 'undefined') ? chosen.filter((p) => PLATFORM_NEEDS_MEDIA[p.platform] && !(p.pic && p.pic.on)) : [];
  if (needMedia.length) notes.push({ text: `${needMedia.map((p) => (PLATFORMS[p.platform] || { label: p.platform }).label).join(', ')} need${needMedia.length === 1 ? 's' : ''} a picture or video. Tick "Add a picture" on ${needMedia.length === 1 ? 'that post' : 'those posts'} or they will fail to publish.` });
  const skipped = Studio.posts.filter((p) => !p.can_post).length;
  if (skipped) notes.push({ text: `${skipped} post${skipped === 1 ? ' is' : 's are'} for networks that cannot be posted to yet. ${skipped === 1 ? 'It is' : 'They are'} left out.` });
  const el = document.getElementById('studio-check');
  if (!el) return;
  el.innerHTML = notes.length
    ? `<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.4);border-radius:8px;padding:8px 12px;font-size:12.5px">${notes.map((n) => `<div>${escapeHtml(n.text)} ${n.fn ? `<a href="#" onclick="${n.fn};return false">${n.fn ? n.fix : ''}</a>` : ''}</div>`).join('')}</div>`
    : `<div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.4);border-radius:8px;padding:8px 12px;font-size:12.5px">All ${chosen.length} post${chosen.length === 1 ? '' : 's'} look ready.</div>`;
}
function studioFixTimes() {
  const now = Math.floor(Date.now() / 1000) + 3600;
  const first = Math.floor(new Date(document.getElementById('studio-start').value).getTime() / 1000);
  if (!Number.isFinite(first) || first < now) document.getElementById('studio-start').value = studioLocalInput(now);
  studioReplan();
}
// Remember the last choices so the next run starts the same way
function studioSaveChoices() {
  try {
    localStorage.setItem('studioChoices', JSON.stringify({
      platforms: Array.from(document.querySelectorAll('.studio-plat:checked')).map((c) => c.value),
      count: document.getElementById('studio-count').value, language: document.getElementById('studio-language').value,
      gap: document.getElementById('studio-interval').value,
    }));
  } catch {}
}
function studioLoadChoices() {
  try {
    const c = JSON.parse(localStorage.getItem('studioChoices') || 'null');
    if (!c) return;
    if (Array.isArray(c.platforms) && c.platforms.length) document.querySelectorAll('.studio-plat').forEach((b) => { b.checked = c.platforms.includes(b.value); });
    if (c.count) document.getElementById('studio-count').value = c.count;
    if (c.language) document.getElementById('studio-language').value = c.language;
    if (c.gap) document.getElementById('studio-interval').value = c.gap;
  } catch {}
}
function studioRenderTimes() {
  studioPreflight();
  const chosen = studioChosen();
  const n = chosen.length;
  document.getElementById('studio-when').textContent = `${n} post${n === 1 ? '' : 's'}`;
  document.getElementById('studio-times').innerHTML = chosen.map((p, k) => {
    const pm = PLATFORMS[p.platform] || { label: p.platform };
    const preview = String(p.title || p.text || '').replace(/\s+/g, ' ').slice(0, 60);
    return `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span style="min-width:24px;color:var(--text-muted)">${k + 1}</span>
      <input type="datetime-local" class="form-input" value="${p.at ? studioLocalInput(p.at) : ''}" aria-label="Time for post ${k + 1}" onchange="studioSetTime(${k},this.value)">
      <span style="font-weight:600">${escapeHtml(pm.label)}</span>
      <span style="color:var(--text-muted);flex:1;min-width:140px">${escapeHtml(preview)}</span>
    </div>`;
  }).join('');
}
function studioSetTime(k, v) {
  const t = Math.floor(new Date(v).getTime() / 1000);
  studioChosen()[k].at = Number.isFinite(t) ? t : null;
  studioPreflight();
}

async function studioSchedule(status) {
  const chosen = studioChosen();
  if (!chosen.length) return toast('Tick at least one post.', 'info');
  if (chosen.some((p) => !Number.isFinite(p.at))) return toast('Pick a time for every post.', 'info');
  const btns = ['studio-draft-btn', 'studio-schedule-btn', 'studio-now-btn'].map((id) => document.getElementById(id)).filter(Boolean);
  try {
    const withPic = chosen.filter((p) => p.pic && p.pic.on);
    if (withPic.length) {
      btns.forEach((b) => { b.disabled = true; });
      let n = 0;
      for (const p of withPic) {
        toast(`Making picture ${++n} of ${withPic.length}…`, 'info', 1500);
        p.media = [p.pic.own ? p.pic.own.ref : await studioMakePicture(p)];
      }
    }
    const res = await api('POST', '/api/content/studio/schedule', {
      posts: chosen.map((p) => ({ platform: p.platform, text: p.text, title: p.title, media: p.pic && p.pic.on ? p.media : undefined, at: p.at })),
      status,
      replace_series_id: Studio.editSeries || undefined,
    });
    Studio.editSeries = null;
    const miss = (res.no_account || []).map((k) => (PLATFORMS[k] || {}).label || k);
    toast(`${res.total} post${res.total === 1 ? '' : 's'} ${res.status === 'scheduled' ? 'scheduled' : 'saved as drafts'}.${miss.length ? ` Connect ${miss.join(', ')} in Accounts so they can go out.` : ''}`, miss.length ? 'warning' : 'success', 9000);
    closeContentStudio();
    Studio.sources = [];
    if (typeof navigateTo === 'function') navigateTo('calendar');
  } catch (err) {
    toast(err.message || 'Could not schedule.', 'error', 7000);
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}

window.openContentStudio = openContentStudio;
window.studioEditSeries = studioEditSeries;
window.studioUseTemplate = studioUseTemplate;
window.studioWriteMyself = studioWriteMyself;
window.studioSaveTemplate = studioSaveTemplate;
window.closeContentStudio = closeContentStudio;
window.studioPicToggle = studioPicToggle;
window.studioOwnImage = studioOwnImage;
window.studioTrayDrag = studioTrayDrag;
window.studioTrayClick = studioTrayClick;
window.studioTrayDropFiles = studioTrayDropFiles;
window.studioTrayUpload = studioTrayUpload;
window.studioDropOnPost = studioDropOnPost;
window.studioDropStart = studioDropStart;
window.studioEdTrayClick = studioEdTrayClick;
window.studioAttachMedia = studioAttachMedia;
window.studioPostNow = studioPostNow;
window.studioFixTimes = studioFixTimes;
window.studioOwnClear = studioOwnClear;
window.studioCountStep = studioCountStep;
window.studioToWhen = studioToWhen;
window.studioReplan = studioReplan;
window.studioSetTime = studioSetTime;
window.studioPicSet = studioPicSet;
window.studioScope = studioScope;
window.studioPicAll = studioPicAll;
window.studioPicLook = studioPicLook;
window.studioSelect = studioSelect;
window.studioBackBar = studioBackBar;
window.studioBackToStudio = studioBackToStudio;
window.studioPreview = studioPreview;
window.studioPicLogo = studioPicLogo;
window.studioOpenBrand = studioOpenBrand;
window.studioAiOpen = studioAiOpen;
window.studioAiClose = studioAiClose;
window.studioAiSave = studioAiSave;
