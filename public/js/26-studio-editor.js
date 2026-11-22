// Content Studio picture editor: a Canva-style editor for the post's picture.
// Text (fonts, styles, outline, shadow), shapes, lines, stickers, photos with filters, free drawing,
// layers, zoom, grid and snap guides, picture sizes, undo/redo, copy/paste and keyboard shortcuts.
// Built on Fabric.js (MIT licence), loaded from /vendor/fabric.min.js only when opened.
const StudioEd = { canvas: null, post: -1, w: 0, h: 0, bg: null, zoom: 1, grid: false, guides: null, clip: null, ready: false };
const STUDIO_ED_EXTRA = ['studioBg', 'studioBase', 'studioLocked', 'studioName', 'studioMask', 'studioOrig'];
const STUDIO_ED_FONTS = ['Inter', 'Arial', 'Arial Black', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Century Gothic', 'Candara', 'Georgia', 'Times New Roman', 'Palatino Linotype', 'Garamond', 'Copperplate', 'Courier New', 'Lucida Console', 'Impact', 'Comic Sans MS', 'Brush Script MT'];
const STUDIO_ED_SIZES = [['1080x1080', 'Square 1080×1080'], ['1080x1350', 'Portrait 1080×1350 (Instagram)'], ['1080x1920', 'Story 1080×1920'], ['1200x630', 'Wide 1200×630 (Facebook, LinkedIn)'], ['1600x900', 'X post 1600×900'], ['1000x1500', 'Pinterest 1000×1500'], ['1500x500', 'Banner 1500×500']];
const STUDIO_ED_SHAPES = [['rect', '▬', 'Box'], ['round', '▢', 'Rounded box'], ['circle', '●', 'Circle'], ['oval', '⬭', 'Oval'], ['triangle', '▲', 'Triangle'], ['diamond', '◆', 'Diamond'], ['star', '★', 'Star'], ['heart', '♥', 'Heart'], ['hexagon', '⬢', 'Hexagon'], ['pentagon', '⬟', 'Pentagon'], ['bubble', '💬', 'Speech bubble'], ['plus', '✚', 'Plus']];
const STUDIO_ED_LINES = [['line', '─', 'Line'], ['dash', '┄', 'Dashed line'], ['arrow', '➜', 'Arrow'], ['arrowline', '⟶', 'Line with arrow']];
const STUDIO_ED_EMOJI = '😀 😂 😍 🥰 😎 🤩 😇 🥳 😉 😮 😢 😡 👍 👎 👏 🙌 🙏 💪 👌 ✌️ 🤝 ❤️ 🧡 💛 💚 💙 💜 🖤 💯 🔥 ⭐ 🌟 ✨ 💥 🎉 🎊 🎁 🏆 🥇 🎯 📣 📢 🔔 💡 ✅ ❌ ⚠️ ❓ ❗ ➡️ ⬆️ 🔝 🆕 🆓 🔖 🏷️ 💰 💸 💳 🛒 🛍️ 📦 🚚 🚀 📈 📞 📱 💻 📍 🗓️ ⏰ ⌛ 🌍 🏠 🏢 🍕 🍔 ☕ 🍰 🍎 🌸 🌿 🌈 ☀️ 🌙 ⚡ 💎 👑 🎵 📷 🎬 🏋️ ⚽ 🚗 ✈️ 🐶 🐱'.split(' ');
const STUDIO_ED_SWATCHES = ['#ffffff', '#000000', '#1e3a8a', '#2563eb', '#0ea5e9', '#14b8a6', '#16a34a', '#84cc16', '#facc15', '#f59e0b', '#f97316', '#ef4444', '#db2777', '#a855f7', '#7c3aed', '#64748b'];
const STUDIO_ED_TEXTSTYLES = [
  { n: 'Bold and clear', css: 'font-weight:800;color:#fff;text-shadow:2px 2px 4px #000', o: { fontWeight: '800', fill: '#ffffff', shadow: [ 'rgba(0,0,0,0.6)', 8, 3, 3 ] } },
  { n: 'Outlined', css: 'font-weight:800;color:#fff;-webkit-text-stroke:1.5px #7c3aed', o: { fontWeight: '800', fill: '#ffffff', stroke: '#7c3aed', strokeWidth: 6 } },
  { n: 'Neon glow', css: 'font-weight:700;color:#fff;text-shadow:0 0 8px #0ff,0 0 16px #0ff', o: { fontWeight: '700', fill: '#ffffff', shadow: [ '#00ffff', 30, 0, 0 ] } },
  { n: 'Retro', css: 'font-family:Impact;color:#f59e0b;-webkit-text-stroke:1px #000', o: { fontFamily: 'Impact', fill: '#f59e0b', stroke: '#000000', strokeWidth: 4, upper: true } },
  { n: 'Elegant', css: 'font-family:Georgia;font-style:italic;font-weight:400', o: { fontFamily: 'Georgia', fontStyle: 'italic', fontWeight: '400', fill: '#ffffff', charSpacing: 60 } },
  { n: 'Highlight', css: 'font-weight:700;color:#fff;background:#7c3aed;padding:0 4px', o: { fontWeight: '700', fill: '#ffffff', textBackgroundColor: '#7c3aed' } },
  { n: 'Handwritten', css: 'font-family:Brush Script MT,cursive;font-size:20px', o: { fontFamily: 'Brush Script MT', fontWeight: '400', fill: '#ffffff', shadow: [ 'rgba(0,0,0,0.5)', 6, 2, 2 ] } },
  { n: 'Spaced capitals', css: 'letter-spacing:3px;font-weight:700', o: { fontWeight: '700', fill: '#ffffff', charSpacing: 300, upper: true } }
];

const studioEdType = (o) => String((o && o.type) || '').toLowerCase();
const studioEdIsText = (o) => /text/.test(studioEdType(o));
const studioEdIsImage = (o) => studioEdType(o) === 'image';
const studioEdIsGroup = (o) => /^(group|activeselection)$/.test(studioEdType(o));

function studioEdLoadLib() {
  if (window.fabric) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = '/vendor/fabric.min.js';
    s.onload = ok;
    s.onerror = () => fail(new Error('The picture editor could not be loaded.'));
    document.head.appendChild(s);
  });
}

// Fills the side panels once
function studioEdInit() {
  if (StudioEd.ready) return;
  StudioEd.ready = true;
  const $ = (id) => document.getElementById(id);
  $('sed-shapes').innerHTML = STUDIO_ED_SHAPES.map(([k, ic, t]) => `<button title="${t}" aria-label="${t}" onclick="studioEdAddShape('${k}')">${ic}</button>`).join('');
  $('sed-lines').innerHTML = STUDIO_ED_LINES.map(([k, ic, t]) => `<button title="${t}" aria-label="${t}" onclick="studioEdAddShape('${k}')">${ic}</button>`).join('');
  $('sed-textstyles').innerHTML = STUDIO_ED_TEXTSTYLES.map((s, i) => `<button class="sed-text-btn" style="${s.css}" onclick="studioEdAddText('style',${i})">${s.n}</button>`).join('');
  $('sed-emojis').innerHTML = STUDIO_ED_EMOJI.map((e) => `<button onclick="studioEdAddEmoji('${e}')" aria-label="Sticker ${e}">${e}</button>`).join('');
  $('sed-swatches').innerHTML = STUDIO_ED_SWATCHES.map((c) => `<button style="background:${c}" title="${c}" aria-label="Background ${c}" onclick="studioEdSwatch('${c}')"></button>`).join('');
  const fonts = STUDIO_ED_FONTS.slice();
  const bf = Designer.brand && Designer.brand.font_name;
  if (bf && !fonts.includes(bf)) fonts.unshift(bf);
  $('studio-ed-font').innerHTML = fonts.map((f) => `<option style="font-family:'${f}'">${f}</option>`).join('');
  const st = $('studio-ed-stage');
  st.addEventListener('wheel', (e) => { if (e.ctrlKey && StudioEd.canvas) { e.preventDefault(); studioEdZoom(e.deltaY < 0 ? 0.1 : -0.1); } }, { passive: false });
}

function studioEdTab(name) {
  document.querySelectorAll('.sed-rail button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('#sed-panel [data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  if (name !== 'dr') studioEdStopDraw();
}

// Returns true once the editor is open, false if it could not be opened
async function studioEditPicture(i) {
  const p = Studio.posts[i];
  if (!p || !p.pic) return false;
  try {
    await studioEdLoadLib();
    studioEdInit();
    // Start from the picture as it is now: the person's own image, or the made one
    const base = document.createElement('canvas');
    let url;
    if (p.pic.own) { url = p.pic.own.url; }
    let words = [];
    if (!p.pic.own) {
      if (typeof ensureBrandFont === 'function') { try { await ensureBrandFont(); } catch {} }
      words = studioEdDrawDesign(base, studioPicSettings(p));
      url = base.toDataURL('image/png');
    }
    // A made picture only exists in this screen, so the version before the edit is kept to save beside the new one
    StudioEd.prevMade = p.pic.own ? null : url;
    const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
    StudioEd.w = img.width; StudioEd.h = img.height; StudioEd.post = i;
    StudioEd.hist = null;
    document.getElementById('studio-editor').style.display = 'flex';
    if (typeof studioRenderTray === 'function') studioRenderTray();
    if (StudioEd.canvas) StudioEd.canvas.dispose();
    const c = new fabric.Canvas('studio-ed-canvas', { width: img.width, height: img.height, preserveObjectStacking: true, enableRetinaScaling: false, fireRightClick: false });
    img.set({ left: 0, top: 0, originX: 'left', originY: 'top', selectable: false, evented: false });
    img.studioBase = true; img.studioName = 'Picture';
    c.add(img);
    words.forEach((o) => c.add(o)); // the made picture's words are separate items you can change
    StudioEd.canvas = c;
    StudioEd.bg = null; StudioEd.guides = null;
    c.on('selection:created', studioEdSync);
    c.on('selection:updated', studioEdSync);
    c.on('selection:cleared', studioEdSync);
    c.on('object:moving', studioEdSnapMove);
    c.on('mouse:up', () => { if (StudioEd.guides) { StudioEd.guides = null; c.requestRenderAll(); } });
    c.on('after:render', studioEdDrawOverlay);
    c.on('path:created', (e) => { if (e.path) { e.path.studioName = 'Drawing'; } });
    ['object:added', 'object:removed', 'object:modified'].forEach((ev) => c.on(ev, studioEdLayersSoon));
    // Sizes list: the original first
    const sel = document.getElementById('studio-ed-sizes');
    sel.innerHTML = `<option value="${img.width}x${img.height}">Original ${img.width}×${img.height}</option>` + STUDIO_ED_SIZES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    document.getElementById('studio-ed-grid').checked = false; StudioEd.grid = false;
    document.getElementById('studio-ed-drawbtn').textContent = 'Start drawing';
    studioEdTab('el');
    studioEdZoom('fit');
    studioEdHistInit();
    studioEdSync();
    studioEdLayers();
    // A picture saved from this editor earlier opens as it was, with its text and items still separate
    const ed = p.pic.own && p.pic.own.edit;
    if (ed) {
      try { await studioEdLoadSnap(ed); StudioEd.hist = [studioEdSnapshot()]; StudioEd.hi = 0; studioEdHistButtons(); } catch { /* falls back to the flat picture */ }
    }
    return true;
  } catch (err) {
    const box = document.getElementById('studio-editor'); if (box) box.style.display = 'none';
    StudioEd.post = null;
    toast(err.message || 'Could not open the editor.', 'error', 6000);
    return false;
  }
}
// Puts a saved snapshot back on the canvas
async function studioEdLoadSnap(h) {
  const c = StudioEd.canvas;
  StudioEd.restoring = true;
  try {
    StudioEd.w = h.w; StudioEd.h = h.h;
    await c.loadFromJSON(JSON.parse(h.j));
    c.getObjects().forEach((o) => {
      if (o.studioBg || o.studioBase) o.set({ selectable: false, evented: false });
      if (o.studioLocked) studioEdApplyLock(o, true);
    });
    StudioEd.bg = c.getObjects().find((o) => o.studioBg) || null;
    studioEdApplyZoom(StudioEd.zoom); studioEdZoom('fit');
    studioEdSizeSelect();
  } finally { StudioEd.restoring = false; studioEdSync(); studioEdLayers(); }
}

// Draws the made picture but keeps its words out of it, returning them as editable text items
function studioEdDrawDesign(cv, settings) {
  const rec = [];
  // Only this canvas's own drawing context is intercepted (never the shared prototype)
  const cx = cv.getContext('2d');
  cx.fillText = function (text, x, y) {
    rec.push({ text: String(text), x, y, font: this.font, fill: this.fillStyle, align: this.textAlign, base: this.textBaseline, sh: this.shadowBlur ? [this.shadowColor, this.shadowBlur, this.shadowOffsetX, this.shadowOffsetY] : null });
  };
  try { renderDesign(cv, settings); } finally { delete cx.fillText; }
  // Lines of one paragraph (same style, same left edge, stepping down) become one text item
  const groups = [];
  rec.forEach((r) => {
    const g = groups[groups.length - 1];
    if (g && g.font === r.font && g.fill === r.fill && g.align === r.align && g.base === r.base && g.x === r.x && r.y > g.last) { g.lines.push(r.text); g.step = r.y - g.last; g.last = r.y; }
    else groups.push({ ...r, lines: [r.text], last: r.y, step: 0 });
  });
  return groups.map((g) => {
    const m = /^(italic )?(\d+) ([\d.]+)px ['"]?([^'",]+)/.exec(g.font) || [];
    const size = +m[3] || 40;
    const t = new fabric.IText(g.lines.join('\n'), {
      fontFamily: m[4] || 'Inter', fontWeight: m[2] || '700', fontStyle: m[1] ? 'italic' : 'normal', fontSize: size,
      fill: typeof g.fill === 'string' ? g.fill : '#ffffff', textAlign: g.align === 'center' ? 'center' : g.align === 'right' ? 'right' : 'left',
      lineHeight: g.step ? g.step / (size * 1.13) : 1.16, paintFirst: 'stroke', strokeLineJoin: 'round', strokeUniform: true,
      originX: g.align === 'center' ? 'center' : g.align === 'right' ? 'right' : 'left',
      originY: g.base === 'middle' ? 'center' : 'top',
      left: g.x, top: g.base === 'alphabetic' ? g.y - size * 0.92 : g.y
    });
    if (g.sh) t.set('shadow', studioEdShadowOf(g.sh));
    t.studioName = 'Text';
    return t;
  });
}

// ── Zoom, grid, snap guides ──
function studioEdApplyZoom(z) {
  const c = StudioEd.canvas; if (!c) return;
  z = Math.max(0.1, Math.min(3, z));
  StudioEd.zoom = z;
  c.setZoom(z);
  c.setDimensions({ width: Math.round(StudioEd.w * z), height: Math.round(StudioEd.h * z) });
  c.renderAll();
  const l = document.getElementById('studio-ed-zoomval'); if (l) l.textContent = Math.round(z * 100) + '%';
}
function studioEdZoom(d) {
  if (!StudioEd.canvas) return;
  if (d === 'fit') {
    const st = document.getElementById('studio-ed-stage');
    const aw = Math.max(120, (st.clientWidth || 700) - 40), ah = Math.max(120, (st.clientHeight || 450) - 40);
    studioEdApplyZoom(Math.min(1.5, aw / StudioEd.w, ah / StudioEd.h));
  } else studioEdApplyZoom(StudioEd.zoom + d);
}
function studioEdGrid(on) { StudioEd.grid = !!on; if (StudioEd.canvas) StudioEd.canvas.requestRenderAll(); }
const studioEdGridStep = () => Math.max(10, Math.round(Math.min(StudioEd.w, StudioEd.h) / 20));

// Snap to the centre of the picture (and to the grid when it is on) while dragging
function studioEdSnapMove(e) {
  const c = StudioEd.canvas, o = e && e.target; if (!c || !o) return;
  const th = 7 / (StudioEd.zoom || 1), g = { v: false, h: false };
  if (StudioEd.grid) {
    const s = studioEdGridStep();
    o.set({ left: Math.round(o.left / s) * s, top: Math.round(o.top / s) * s });
  }
  const p = o.getCenterPoint();
  let cx = p.x, cy = p.y;
  if (Math.abs(cx - StudioEd.w / 2) < th) { cx = StudioEd.w / 2; g.v = true; }
  if (Math.abs(cy - StudioEd.h / 2) < th) { cy = StudioEd.h / 2; g.h = true; }
  if (g.v || g.h) o.setPositionByOrigin(new fabric.Point(cx, cy), 'center', 'center');
  StudioEd.guides = (g.v || g.h) ? g : null;
}
function studioEdDrawOverlay(e) {
  if (StudioEd.exporting || !StudioEd.canvas) return;
  const c = StudioEd.canvas, ctx = (e && e.ctx) || c.getContext(), z = StudioEd.zoom || 1;
  if (!StudioEd.grid && !StudioEd.guides) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (StudioEd.grid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1; ctx.beginPath();
    const s = studioEdGridStep();
    for (let x = s; x < StudioEd.w; x += s) { ctx.moveTo(Math.round(x * z) + 0.5, 0); ctx.lineTo(Math.round(x * z) + 0.5, StudioEd.h * z); }
    for (let y = s; y < StudioEd.h; y += s) { ctx.moveTo(0, Math.round(y * z) + 0.5); ctx.lineTo(StudioEd.w * z, Math.round(y * z) + 0.5); }
    ctx.stroke();
  }
  if (StudioEd.guides) {
    ctx.strokeStyle = '#ff2d95'; ctx.lineWidth = 1; ctx.beginPath();
    if (StudioEd.guides.v) { ctx.moveTo(StudioEd.w / 2 * z, 0); ctx.lineTo(StudioEd.w / 2 * z, StudioEd.h * z); }
    if (StudioEd.guides.h) { ctx.moveTo(0, StudioEd.h / 2 * z); ctx.lineTo(StudioEd.w * z, StudioEd.h / 2 * z); }
    ctx.stroke();
  }
  ctx.restore();
}

// ── Undo / redo: a snapshot of the picture after every change (the last 25) ──
const STUDIO_ED_HIST = 25;
const studioEdSnapshot = () => ({ j: JSON.stringify(StudioEd.canvas.toObject(STUDIO_ED_EXTRA)), w: StudioEd.w, h: StudioEd.h });
function studioEdHistInit() {
  const c = StudioEd.canvas; if (!c) return;
  StudioEd.hist = [studioEdSnapshot()]; StudioEd.hi = 0; StudioEd.restoring = false;
  ['object:added', 'object:removed', 'object:modified', 'text:editing:exited'].forEach((ev) => c.on(ev, () => studioEdSnap()));
  studioEdHistButtons();
}
// Several events in one action (e.g. replacing the background) become one step
function studioEdSnap(delay) {
  if (StudioEd.restoring) return;
  clearTimeout(StudioEd.snapTimer);
  StudioEd.snapTimer = setTimeout(studioEdTakeSnap, delay || 30);
}
function studioEdTakeSnap() {
  StudioEd.snapTimer = null;
  const c = StudioEd.canvas; if (!c || StudioEd.restoring || !StudioEd.hist) return;
  const s = studioEdSnapshot();
  const cur = StudioEd.hist[StudioEd.hi];
  if (cur && s.j === cur.j && s.w === cur.w && s.h === cur.h) return;
  StudioEd.hist = StudioEd.hist.slice(0, StudioEd.hi + 1); StudioEd.hist.push(s);
  // keep the last 25 steps, and fewer if the pictures in them are big (about 40 MB of text in all)
  let size = StudioEd.hist.reduce((a, h) => a + h.j.length, 0);
  while (StudioEd.hist.length > 2 && (StudioEd.hist.length > STUDIO_ED_HIST || size > 40e6)) size -= StudioEd.hist.shift().j.length;
  StudioEd.hi = StudioEd.hist.length - 1;
  studioEdHistButtons();
}
function studioEdHistButtons() {
  const u = document.getElementById('studio-ed-undo'), r = document.getElementById('studio-ed-redo');
  if (u) u.disabled = !(StudioEd.hi > 0);
  if (r) r.disabled = !(StudioEd.hist && StudioEd.hi < StudioEd.hist.length - 1);
}
async function studioEdGo(step) {
  const c = StudioEd.canvas; if (!c || !StudioEd.hist) return;
  if (StudioEd.snapTimer) { clearTimeout(StudioEd.snapTimer); studioEdTakeSnap(); } // keep a change still waiting
  const n = StudioEd.hi + step;
  if (n < 0 || n >= StudioEd.hist.length) return;
  StudioEd.restoring = true;
  try {
    studioEdStopDraw();
    c.discardActiveObject();
    const h = StudioEd.hist[n];
    StudioEd.w = h.w; StudioEd.h = h.h;
    await c.loadFromJSON(JSON.parse(h.j));
    StudioEd.hi = n;
    c.getObjects().forEach((o) => {
      if (o.studioBg || o.studioBase) o.set({ selectable: false, evented: false });
      if (o.studioLocked) studioEdApplyLock(o, true);
    });
    StudioEd.bg = c.getObjects().find((o) => o.studioBg) || null;
    studioEdApplyZoom(StudioEd.zoom); // keep the on-screen size
    studioEdSizeSelect();
  } finally { StudioEd.restoring = false; studioEdHistButtons(); studioEdSync(); studioEdLayers(); }
}
const studioEdUndo = () => studioEdGo(-1);
const studioEdRedo = () => studioEdGo(1);

// ── Keyboard shortcuts (only while the editor is open and nobody is typing) ──
document.addEventListener('keydown', (e) => {
  const box = document.getElementById('studio-editor');
  const c = StudioEd.canvas;
  if (!box || box.style.display !== 'flex' || !c) return;
  const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  const active = c.getActiveObject();
  if (typing || (active && active.isEditing)) return; // leave the browser's own keys for text boxes
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod) {
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); studioEdUndo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); studioEdRedo(); }
    else if (k === 'd') { e.preventDefault(); studioEdDuplicate(); }
    else if (k === 'c') { e.preventDefault(); studioEdCopy(); }
    else if (k === 'v') { e.preventDefault(); studioEdPaste(); }
    else if (k === 'g') { e.preventDefault(); studioEdGroup(); }
    else if (k === 'a') { e.preventDefault(); studioEdSelectAll(); }
    return;
  }
  if (k === 'delete' || k === 'backspace') { if (active) { e.preventDefault(); studioEdDelete(); } }
  else if (k === 'escape') { if (c.isDrawingMode) studioEdStopDraw(); else { c.discardActiveObject(); c.requestRenderAll(); } }
  else if (active && k.startsWith('arrow')) {
    e.preventDefault();
    const s = e.shiftKey ? 10 : 1;
    if (!active.studioLocked) {
      active.set({ left: active.left + (k === 'arrowright' ? s : k === 'arrowleft' ? -s : 0), top: active.top + (k === 'arrowdown' ? s : k === 'arrowup' ? -s : 0) });
      active.setCoords(); c.requestRenderAll(); c.fire('object:modified', { target: active });
    }
  }
});

function studioEdClose() {
  studioEdStopDraw();
  clearTimeout(StudioEd.snapTimer);
  document.getElementById('studio-editor').style.display = 'none';
  if (StudioEd.canvas) { StudioEd.canvas.dispose(); StudioEd.canvas = null; }
}

const studioEdBrand = () => { const d = designDefaults(); return { c1: d.c1, c2: d.c2, c3: d.c3 }; };
const studioEdFontDefault = () => (Designer.brand && Designer.brand.font_name) || 'Inter';

// Puts a new item on the picture and selects it
function studioEdPut(o, name) {
  const c = StudioEd.canvas; if (!c) return;
  studioEdStopDraw();
  o.set({ originX: 'left', originY: 'top' });
  if (name) o.studioName = name;
  c.add(o); c.setActiveObject(o); c.requestRenderAll();
}
const studioEdShadowOf = (a) => new fabric.Shadow({ color: a[0], blur: a[1], offsetX: a[2], offsetY: a[3] });

function studioEdAddText(kind, styleIdx) {
  const c = StudioEd.canvas; if (!c) return;
  const H = StudioEd.h, size = kind === 'h2' ? H / 14 : kind === 'body' ? H / 24 : H / 9;
  const t = new fabric.IText(kind === 'body' ? 'Your text here' : kind === 'h2' ? 'A short subheading' : 'Your heading', {
    left: StudioEd.w * 0.1, top: StudioEd.h * 0.4, fontSize: Math.round(size), fontWeight: kind === 'body' ? '400' : '700', fill: '#ffffff', fontFamily: studioEdFontDefault(),
    paintFirst: 'stroke', strokeLineJoin: 'round', strokeUniform: true, shadow: studioEdShadowOf(['rgba(0,0,0,0.45)', 8, 2, 2])
  });
  if (kind === 'style') {
    const s = STUDIO_ED_TEXTSTYLES[styleIdx]; if (!s) return;
    const { shadow, upper, ...rest } = s.o;
    t.set(rest);
    t.set('shadow', shadow ? studioEdShadowOf(shadow) : null);
    t.set('text', upper ? 'YOUR HEADING' : 'Your heading');
    t.set('fontSize', Math.round(H / 9));
  }
  studioEdPut(t, 'Text');
}
function studioEdAddEmoji(e) {
  const t = new fabric.IText(e, { left: StudioEd.w * 0.4, top: StudioEd.h * 0.4, fontSize: Math.round(StudioEd.h / 6), fontFamily: 'Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif' });
  studioEdPut(t, 'Sticker');
}

function studioEdPolygon(n, r, rot) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = rot + (k * 2 * Math.PI) / n; pts.push({ x: r + r * Math.cos(a), y: r + r * Math.sin(a) }); }
  return pts;
}
function studioEdShapeObj(kind, s, col) {
  const F = fabric;
  switch (kind) {
    case 'rect': return new F.Rect({ width: s * 1.6, height: s * 0.8, fill: col });
    case 'round': return new F.Rect({ width: s * 1.6, height: s * 0.8, rx: s * 0.18, ry: s * 0.18, fill: col });
    case 'circle': return new F.Circle({ radius: s / 2, fill: col });
    case 'oval': return new F.Ellipse({ rx: s * 0.8, ry: s * 0.45, fill: col });
    case 'triangle': return new F.Triangle({ width: s, height: s * 0.9, fill: col });
    case 'diamond': return new F.Polygon([{ x: s / 2, y: 0 }, { x: s, y: s / 2 }, { x: s / 2, y: s }, { x: 0, y: s / 2 }], { fill: col });
    case 'star': {
      const pts = [], r = s / 2;
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r; pts.push({ x: r + rr * Math.cos(a), y: r + rr * Math.sin(a) }); }
      return new F.Polygon(pts, { fill: col });
    }
    case 'hexagon': return new F.Polygon(studioEdPolygon(6, s / 2, 0), { fill: col });
    case 'pentagon': return new F.Polygon(studioEdPolygon(5, s / 2, -Math.PI / 2), { fill: col });
    case 'plus': { const a = s / 3; return new F.Polygon([{ x: a, y: 0 }, { x: 2 * a, y: 0 }, { x: 2 * a, y: a }, { x: s, y: a }, { x: s, y: 2 * a }, { x: 2 * a, y: 2 * a }, { x: 2 * a, y: s }, { x: a, y: s }, { x: a, y: 2 * a }, { x: 0, y: 2 * a }, { x: 0, y: a }, { x: a, y: a }], { fill: col }); }
    case 'heart': { const p = new F.Path('M 24 4 C 20 -3 8 -3 4 6 C 0 15 8 24 24 38 C 40 24 48 15 44 6 C 40 -3 28 -3 24 4 Z', { fill: col }); p.scaleToWidth(s * 1.1); return p; }
    case 'bubble': { const p = new F.Path('M 10 0 H 90 Q 100 0 100 10 V 50 Q 100 60 90 60 H 40 L 20 80 L 25 60 H 10 Q 0 60 0 50 V 10 Q 0 0 10 0 Z', { fill: col }); p.scaleToWidth(s * 1.4); return p; }
    case 'line': return new F.Line([0, 0, s * 1.6, 0], { stroke: col, strokeWidth: Math.max(4, s / 20), strokeLineCap: 'round' });
    case 'dash': return new F.Line([0, 0, s * 1.6, 0], { stroke: col, strokeWidth: Math.max(4, s / 20), strokeDashArray: [Math.max(12, s / 8), Math.max(10, s / 10)] });
    case 'arrow': { const L = s * 1.6, h = s * 0.5; return new F.Polygon([{ x: 0, y: h * 0.34 }, { x: L * 0.65, y: h * 0.34 }, { x: L * 0.65, y: 0 }, { x: L, y: h / 2 }, { x: L * 0.65, y: h }, { x: L * 0.65, y: h * 0.66 }, { x: 0, y: h * 0.66 }], { fill: col }); }
    case 'arrowline': { const L = s * 1.6, w = Math.max(6, s / 18); const p = new F.Path(`M 0 ${w * 2} L ${L - w * 3} ${w * 2} M ${L - w * 5} 0 L ${L} ${w * 2} L ${L - w * 5} ${w * 4}`, { fill: null, stroke: col, strokeWidth: w, strokeLineCap: 'round', strokeLineJoin: 'round' }); return p; }
  }
  return new F.Rect({ width: s, height: s, fill: col });
}
const STUDIO_ED_SHAPE_NAMES = Object.fromEntries([...STUDIO_ED_SHAPES, ...STUDIO_ED_LINES].map(([k, , t]) => [k, t]));
function studioEdAddShape(kind) {
  const c = StudioEd.canvas; if (!c) return;
  const col = studioEdBrand().c1;
  const s = Math.round(Math.min(StudioEd.w, StudioEd.h) / 4);
  if (kind === 'rounded') kind = 'round';
  const o = studioEdShapeObj(kind, s, col);
  o.set({ left: StudioEd.w * 0.3, top: StudioEd.h * 0.3, strokeUniform: true });
  studioEdPut(o, STUDIO_ED_SHAPE_NAMES[kind] || 'Shape');
}
async function studioEdAddImageUrl(url) {
  const c = StudioEd.canvas; if (!c) return;
  const im = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
  const k = Math.min(1, (StudioEd.w * 0.4) / im.width, (StudioEd.h * 0.4) / im.height);
  im.set({ left: StudioEd.w * 0.05, top: StudioEd.h * 0.05, scaleX: k, scaleY: k });
  studioEdPut(im, 'Photo');
  return im;
}
async function studioEdAddFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast('Pick an image file.', 'warning');
  try { await studioEdAddImageUrl(URL.createObjectURL(file)); } catch { toast('Could not add that image.', 'error'); }
}
async function studioEdAddLogo() {
  const u = Designer.brand && Designer.brand.logo_url;
  if (!u) return toast('Your Brand kit has no logo yet. Add one in Brand kit, or use "Upload a picture".', 'info', 6000);
  try {
    const o = await studioEdAddImageUrl(typeof mediaSrc === 'function' ? mediaSrc(u) : u);
    if (o) o.studioName = 'Logo';
  }
  catch { toast('The logo could not be loaded. Use "Upload a picture" with the logo file instead.', 'warning', 6000); }
}

// ── Free drawing ──
function studioEdPen() {
  const c = StudioEd.canvas; if (!c || !fabric.PencilBrush) return;
  const b = c.freeDrawingBrush || new fabric.PencilBrush(c);
  b.color = document.getElementById('studio-ed-pencol').value;
  b.width = Math.max(1, +document.getElementById('studio-ed-penw').value * Math.max(1, Math.min(StudioEd.w, StudioEd.h) / 540));
  b.strokeLineCap = 'round'; b.strokeLineJoin = 'round';
  c.freeDrawingBrush = b;
}
function studioEdDraw() {
  const c = StudioEd.canvas; if (!c) return;
  if (c.isDrawingMode) return studioEdStopDraw();
  c.discardActiveObject();
  c.isDrawingMode = true; studioEdPen();
  document.getElementById('studio-ed-drawbtn').textContent = 'Stop drawing';
}
function studioEdStopDraw() {
  const c = StudioEd.canvas;
  if (c && c.isDrawingMode) c.isDrawingMode = false;
  const b = document.getElementById('studio-ed-drawbtn'); if (b) b.textContent = 'Start drawing';
}

// One colour over the whole picture (sits just above the base picture, under everything else)
function studioEdBg(clear) {
  const c = StudioEd.canvas; if (!c) return;
  if (StudioEd.bg) { c.remove(StudioEd.bg); StudioEd.bg = null; }
  if (clear === null) { c.requestRenderAll(); c.renderAll(); return; }
  const c1 = document.getElementById('studio-ed-bg').value, c2 = document.getElementById('studio-ed-bg2').value;
  const mode = document.getElementById('studio-ed-bgmode').value;
  const W = StudioEd.w, H = StudioEd.h;
  let fill = c1;
  if (mode !== 'solid') {
    const dir = { diag: [0, 0, W, H], h: [0, 0, W, 0], v: [0, 0, 0, H], splith: [0, 0, W, 0], splitv: [0, 0, 0, H] }[mode];
    const split = mode.startsWith('split');
    fill = new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: dir[0], y1: dir[1], x2: dir[2], y2: dir[3] },
      colorStops: split ? [{ offset: 0, color: c1 }, { offset: 0.5, color: c1 }, { offset: 0.5, color: c2 }, { offset: 1, color: c2 }] : [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
  }
  const r = new fabric.Rect({ originX: 'left', originY: 'top', left: 0, top: 0, width: W, height: H, fill, selectable: false, evented: false });
  r.studioBg = true; r.studioName = 'Background';
  c.add(r); c.moveObjectTo(r, 1); StudioEd.bg = r;
  c.requestRenderAll(); c.renderAll();
}
function studioEdSwatch(col) {
  document.getElementById('studio-ed-bg').value = col;
  document.getElementById('studio-ed-bgmode').value = 'solid';
  studioEdBg();
}

// ── Changing the selected item ──
const studioEdActive = () => { const c = StudioEd.canvas; return c ? c.getActiveObject() : null; };
function studioEdDone(delay) { const c = StudioEd.canvas; if (!c) return; c.requestRenderAll(); studioEdSnap(delay); studioEdLayersSoon(); }
function studioEdColor(v) {
  const o = studioEdActive();
  if (!o || studioEdIsImage(o) || studioEdIsGroup(o)) return;
  if (studioEdType(o) === 'line') o.set('stroke', v); else o.set('fill', v);
  studioEdDone(500);
}
function studioEdProp(k, v) {
  const o = studioEdActive(); if (!o) return;
  if ((k === 'charSpacing' || k === 'lineHeight') && !studioEdIsText(o)) return;
  o.set(k, v); o.setCoords(); studioEdDone(500);
}
function studioEdFont(v) {
  const o = studioEdActive();
  if (!o || !studioEdIsText(o)) return;
  o.set('fontFamily', v); o.initDimensions && o.initDimensions(); o.setCoords(); StudioEd.canvas.renderAll(); studioEdDone();
}
function studioEdSize(v) {
  const o = studioEdActive();
  if (!o || !studioEdIsText(o)) return;
  o.set('fontSize', Math.max(8, Math.min(600, Number(v) || 40))); o.setCoords(); studioEdDone();
}
function studioEdToggle(what) {
  const o = studioEdActive();
  if (!o || !studioEdIsText(o)) return;
  if (what === 'bold') o.set('fontWeight', parseInt(o.fontWeight, 10) >= 600 || o.fontWeight === 'bold' ? '400' : '700');
  else if (what === 'italic') o.set('fontStyle', o.fontStyle === 'italic' ? 'normal' : 'italic');
  else if (what === 'underline') o.set('underline', !o.underline);
  else if (what === 'linethrough') o.set('linethrough', !o.linethrough);
  else if (what === 'upper') {
    const up = o.text.toUpperCase();
    if (o.text !== up) { o.studioOrig = o.text; o.set('text', up); } else o.set('text', o.studioOrig || o.text.toLowerCase());
  }
  o.setCoords(); studioEdDone(); studioEdSync();
}
function studioEdAlign(a) { const o = studioEdActive(); if (!o || !studioEdIsText(o)) return; o.set('textAlign', a); studioEdDone(); }
function studioEdStroke() {
  const o = studioEdActive(); if (!o || studioEdIsImage(o) || studioEdIsGroup(o)) return;
  let w = +document.getElementById('studio-ed-strokew').value;
  if (studioEdType(o) === 'line' && w < 1) w = 1;
  o.set({ stroke: document.getElementById('studio-ed-stroke').value, strokeWidth: w * Math.max(1, Math.min(StudioEd.w, StudioEd.h) / 540), strokeUniform: true });
  if (studioEdIsText(o)) o.set({ paintFirst: 'stroke', strokeLineJoin: 'round' });
  o.setCoords(); studioEdDone(500);
}
function studioEdRadius(v) { const o = studioEdActive(); if (!o || studioEdType(o) !== 'rect') return; o.set({ rx: v, ry: v }); studioEdDone(500); }
function studioEdShadow(on) {
  const o = studioEdActive(); if (!o) return;
  o.set('shadow', on ? studioEdShadowOf(['rgba(0,0,0,0.5)', 20, 6, 6]) : null);
  studioEdDone();
}
function studioEdGradient(on) {
  const o = studioEdActive(); if (!o || studioEdIsImage(o) || studioEdIsText(o) || studioEdIsGroup(o)) return;
  const g1 = document.getElementById('studio-ed-g1').value, g2 = document.getElementById('studio-ed-g2').value;
  if (on === false) o.set('fill', g1);
  else o.set('fill', new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords: { x1: 0, y1: 0, x2: o.width, y2: o.height }, colorStops: [{ offset: 0, color: g1 }, { offset: 1, color: g2 }] }));
  studioEdDone(500); studioEdSync();
}
function studioEdFilters() {
  const o = studioEdActive(); if (!o || !studioEdIsImage(o) || !fabric.filters) return;
  const v = (id) => +document.getElementById(id).value, F = fabric.filters, list = [];
  if (v('studio-ed-f-bright')) list.push(new F.Brightness({ brightness: v('studio-ed-f-bright') }));
  if (v('studio-ed-f-contrast')) list.push(new F.Contrast({ contrast: v('studio-ed-f-contrast') }));
  if (v('studio-ed-f-sat')) list.push(new F.Saturation({ saturation: v('studio-ed-f-sat') }));
  if (v('studio-ed-f-blur')) list.push(new F.Blur({ blur: v('studio-ed-f-blur') }));
  const look = document.getElementById('studio-ed-f-look').value;
  if (look === 'gray') list.push(new F.Grayscale()); else if (look === 'sepia') list.push(new F.Sepia()); else if (look === 'invert') list.push(new F.Invert());
  o.filters = list; o.applyFilters(); studioEdDone(500);
}
function studioEdMask(kind) {
  const o = studioEdActive(); if (!o || !studioEdIsImage(o)) return;
  o.studioMask = kind || '';
  if (!kind) o.clipPath = null;
  else if (kind === 'circle') o.clipPath = new fabric.Circle({ radius: Math.min(o.width, o.height) / 2, originX: 'center', originY: 'center' });
  else o.clipPath = new fabric.Rect({ width: o.width, height: o.height, rx: Math.min(o.width, o.height) * 0.14, ry: Math.min(o.width, o.height) * 0.14, originX: 'center', originY: 'center' });
  o.dirty = true; studioEdDone();
}
function studioEdFlip(axis) { const o = studioEdActive(); if (!o) return; o.set('flip' + axis, !o['flip' + axis]); studioEdDone(); }
function studioEdPlace(where) {
  const o = studioEdActive(), c = StudioEd.canvas; if (!o || !where) return;
  const W = StudioEd.w, H = StudioEd.h;
  if (where === 'full') { o.set({ angle: 0, left: 0, top: 0, scaleX: W / o.width, scaleY: H / o.height }); }
  else {
    const r = o.getBoundingRect();
    let dx = 0, dy = 0;
    if (where === 'left') dx = -r.left; else if (where === 'right') dx = W - (r.left + r.width); else if (where === 'centre') dx = W / 2 - (r.left + r.width / 2);
    if (where === 'top') dy = -r.top; else if (where === 'bottom') dy = H - (r.top + r.height); else if (where === 'middle') dy = H / 2 - (r.top + r.height / 2);
    o.set({ left: o.left + dx, top: o.top + dy });
  }
  o.setCoords(); c.requestRenderAll(); c.fire('object:modified', { target: o });
}
function studioEdOrder(dir) {
  const c = StudioEd.canvas; if (!c) return;
  const objs = c.getActiveObjects(); if (!objs.length) return;
  const min = StudioEd.bg ? 2 : 1, idx = (o) => c.getObjects().indexOf(o);
  const sorted = objs.slice().sort((a, b) => (dir > 0 ? idx(b) - idx(a) : idx(a) - idx(b)));
  sorted.forEach((o) => { if (dir > 0) c.bringObjectForward(o); else if (idx(o) > min) c.sendObjectBackwards(o); });
  c.requestRenderAll(); studioEdSnap(); studioEdLayersSoon();
}
function studioEdDelete() {
  const c = StudioEd.canvas; if (!c) return;
  c.getActiveObjects().forEach((o) => { if (!o.studioBase) c.remove(o); });
  c.discardActiveObject(); c.requestRenderAll();
}
function studioEdApplyLock(o, on) {
  o.studioLocked = !!on;
  o.set({ lockMovementX: !!on, lockMovementY: !!on, lockRotation: !!on, lockScalingX: !!on, lockScalingY: !!on, hasControls: !on, editable: !on });
}
function studioEdLock() {
  const c = StudioEd.canvas, o = studioEdActive(); if (!o) return;
  const on = !o.studioLocked;
  (studioEdIsGroup(o) && studioEdType(o) === 'activeselection' ? o.getObjects() : [o]).forEach((x) => studioEdApplyLock(x, on));
  o.setCoords(); c.requestRenderAll(); studioEdSnap(); studioEdLayersSoon(); studioEdSync();
}
function studioEdGroup() {
  const c = StudioEd.canvas, o = studioEdActive(); if (!c || !o) return;
  if (studioEdType(o) === 'activeselection') {
    const items = o.getObjects().slice();
    c.discardActiveObject();
    items.forEach((x) => c.remove(x));
    const g = new fabric.Group(items); g.studioName = 'Group';
    c.add(g); c.setActiveObject(g);
  } else if (studioEdType(o) === 'group') {
    const items = o.getObjects().slice(), m = o.calcTransformMatrix();
    c.discardActiveObject();
    c.remove(o);
    items.forEach((x) => { fabric.util.addTransformToObject(x, m); x.setCoords(); c.add(x); });
    c.setActiveObject(new fabric.ActiveSelection(items, { canvas: c }));
  } else return toast('Select two or more items (Shift-click) to join them.', 'info', 4000);
  c.requestRenderAll(); studioEdSnap(); studioEdSync(); studioEdLayersSoon();
}
function studioEdSelectAll() {
  const c = StudioEd.canvas; if (!c) return;
  const objs = c.getObjects().filter((o) => !o.studioBase && !o.studioBg && o.visible && !o.studioLocked);
  if (!objs.length) return;
  c.discardActiveObject();
  c.setActiveObject(objs.length === 1 ? objs[0] : new fabric.ActiveSelection(objs, { canvas: c }));
  c.requestRenderAll();
}
// Copy and paste inside the editor
async function studioEdCopy() { const o = studioEdActive(); if (!o) return; StudioEd.clip = await o.clone(STUDIO_ED_EXTRA); StudioEd.pasteN = 0; }
async function studioEdPaste() {
  const c = StudioEd.canvas; if (!c || !StudioEd.clip) return;
  const cl = await StudioEd.clip.clone(STUDIO_ED_EXTRA);
  StudioEd.pasteN = (StudioEd.pasteN || 0) + 1;
  const off = 20 * StudioEd.pasteN;
  c.discardActiveObject();
  cl.set({ left: cl.left + off, top: cl.top + off, evented: true });
  if (studioEdType(cl) === 'activeselection') {
    cl.canvas = c; cl.forEachObject((ob) => c.add(ob)); cl.setCoords();
  } else c.add(cl);
  c.setActiveObject(cl); c.requestRenderAll();
}
async function studioEdDuplicate() { await studioEdCopy(); await studioEdPaste(); }

// Resize the picture; everything on it is scaled and centred to fit
function studioEdResize(v) {
  const c = StudioEd.canvas; if (!c || !v) return;
  const m = /^(\d+)x(\d+)$/.exec(v); if (!m) return;
  const nw = +m[1], nh = +m[2], W = StudioEd.w, H = StudioEd.h;
  if (nw === W && nh === H) return;
  c.discardActiveObject();
  const s = Math.min(nw / W, nh / H), ox = (nw - W * s) / 2, oy = (nh - H * s) / 2;
  c.getObjects().forEach((o) => {
    if (o.studioBase) { const k = Math.max(nw / o.width, nh / o.height); o.set({ scaleX: k, scaleY: k, left: (nw - o.width * k) / 2, top: (nh - o.height * k) / 2 }); }
    else if (!o.studioBg) {
      o.set({ left: o.left * s + ox, top: o.top * s + oy, scaleX: o.scaleX * s, scaleY: o.scaleY * s });
      // outlines and shadows keep their look relative to the item (scaling the item scales the outline too,
      // so nothing else is needed); the made picture's base is the only thing that is cropped
    }
    o.setCoords();
  });
  StudioEd.w = nw; StudioEd.h = nh;
  if (StudioEd.bg) studioEdBg(); // redraw the background at the new size
  studioEdZoom('fit');
  studioEdSnap();
  studioEdSizeSelect();
}
function studioEdSizeSelect() {
  const sel = document.getElementById('studio-ed-sizes'); if (!sel) return;
  const v = `${StudioEd.w}x${StudioEd.h}`;
  [...sel.querySelectorAll('option[data-cur]')].forEach((o) => o.remove());
  if (![...sel.options].some((o) => o.value === v)) { const op = new Option(`${StudioEd.w}×${StudioEd.h}`, v); op.dataset.cur = '1'; sel.add(op); }
  sel.value = v;
}

// ── Controls follow the selected item ──
function studioEdHex(col) { try { return '#' + new fabric.Color(col).toHex(); } catch { return null; } }
function studioEdSync() {
  const c = StudioEd.canvas; const o = c && c.getActiveObject();
  const box = document.getElementById('studio-ed-sel'); if (!box) return;
  const $ = (id) => document.getElementById(id);
  const on = {};
  if (o) {
    const ty = studioEdType(o), text = studioEdIsText(o), img = studioEdIsImage(o), grp = studioEdIsGroup(o), line = ty === 'line';
    const filled = !text && !img && !grp && !line && o.fill;
    on.all = true;
    if (text) { on.fill = on.text = on.stroke = on.shadow = true; }
    else if (img) { on.image = on.shadow = true; }
    else if (grp) { on.shadow = true; }
    else if (line) { on.stroke = true; }
    else if (filled) { on.fill = on.gradient = on.stroke = on.shadow = true; if (ty === 'rect') on.radius = true; }
    else { on.stroke = true; on.shadow = true; } // drawings and open paths
    if (on.fill) {
      const h = typeof o.fill === 'string' ? studioEdHex(o.fill) : null;
      if (h) $('studio-ed-color').value = h;
    }
    if (on.gradient && o.fill && o.fill.colorStops) {
      const st = o.fill.colorStops, a = studioEdHex(st[0].color), b = studioEdHex(st[st.length - 1].color);
      if (a) $('studio-ed-g1').value = a; if (b) $('studio-ed-g2').value = b;
    }
    if (on.text) {
      const ff = $('studio-ed-font');
      if (![...ff.options].some((op) => op.value === o.fontFamily)) ff.add(new Option(o.fontFamily, o.fontFamily));
      ff.value = o.fontFamily;
      $('studio-ed-size').value = Math.round(o.fontSize);
      $('sed-b').classList.toggle('on', parseInt(o.fontWeight, 10) >= 600 || o.fontWeight === 'bold');
      $('sed-i').classList.toggle('on', o.fontStyle === 'italic');
      $('sed-u').classList.toggle('on', !!o.underline);
      $('sed-s').classList.toggle('on', !!o.linethrough);
      $('studio-ed-spacing').value = o.charSpacing || 0;
      $('studio-ed-lh').value = o.lineHeight || 1.16;
    }
    if (on.stroke) {
      const sc = typeof o.stroke === 'string' ? studioEdHex(o.stroke) : null; if (sc) $('studio-ed-stroke').value = sc;
      $('studio-ed-strokew').value = Math.round((o.strokeWidth || 0) / Math.max(1, Math.min(StudioEd.w, StudioEd.h) / 540));
    }
    if (on.radius) $('studio-ed-radius').value = o.rx || 0;
    if (on.shadow) $('studio-ed-shadow').checked = !!o.shadow;
    if (on.image) {
      const f = (n) => (o.filters || []).find((x) => x && x.type === n);
      $('studio-ed-f-bright').value = f('Brightness') ? f('Brightness').brightness : 0;
      $('studio-ed-f-contrast').value = f('Contrast') ? f('Contrast').contrast : 0;
      $('studio-ed-f-sat').value = f('Saturation') ? f('Saturation').saturation : 0;
      $('studio-ed-f-blur').value = f('Blur') ? f('Blur').blur : 0;
      $('studio-ed-f-look').value = f('Grayscale') ? 'gray' : f('Sepia') ? 'sepia' : f('Invert') ? 'invert' : '';
      $('studio-ed-mask').value = o.studioMask || '';
    }
    $('studio-ed-opacity').value = o.opacity == null ? 1 : o.opacity;
    $('studio-ed-angle').value = Math.round(o.angle || 0);
    $('sed-lock').textContent = o.studioLocked ? '🔓' : '🔒';
    $('sed-lock').title = o.studioLocked ? 'Unlock' : 'Lock so it cannot be moved by mistake';
    $('sed-group').textContent = ty === 'group' ? 'Separate' : 'Join';
  }
  $('sed-none').style.display = o ? 'none' : '';
  box.querySelectorAll('.sed-g').forEach((g) => g.classList.toggle('on', !!on[g.dataset.for]));
  studioEdLayersSoon();
}

// ── Layers panel ──
function studioEdLayersSoon() { clearTimeout(StudioEd.layerTimer); StudioEd.layerTimer = setTimeout(studioEdLayers, 40); }
function studioEdLayerName(o) {
  if (o.studioName && !studioEdIsText(o)) return o.studioName;
  if (studioEdIsText(o)) return (o.text || 'Text').replace(/\s+/g, ' ').slice(0, 22);
  return { rect: 'Box', circle: 'Circle', ellipse: 'Oval', triangle: 'Triangle', polygon: 'Shape', path: 'Shape', line: 'Line', image: 'Picture', group: 'Group' }[studioEdType(o)] || 'Item';
}
function studioEdLayerIcon(o) {
  if (studioEdIsText(o)) return o.studioName === 'Sticker' ? '😀' : '🔤';
  return { image: '🖼', group: '🗂', line: '─', path: '✏️' }[studioEdType(o)] || '🔷';
}
// Rows point at an item by a stable id, so a click always reaches the item it shows even if the list is a moment behind
let studioEdSeq = 0;
const studioEdId = (o) => o.studioId || (o.studioId = ++studioEdSeq);
const studioEdById = (id) => StudioEd.canvas && StudioEd.canvas.getObjects().find((o) => o.studioId === id);
function studioEdLayers() {
  clearTimeout(StudioEd.layerTimer);
  const c = StudioEd.canvas, el = document.getElementById('sed-layers'); if (!c || !el) return;
  const act = new Set(c.getActiveObjects());
  const objs = c.getObjects();
  const rows = [];
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    const base = !!o.studioBase;
    rows.push(`<div class="sed-layer${act.has(o) ? ' on' : ''}" onclick="studioEdLayerSel(${studioEdId(o)})">
      <span>${base ? '🖼' : o.studioBg ? '🎨' : studioEdLayerIcon(o)}</span>
      <span class="nm">${escapeHtml(base ? 'Picture' : studioEdLayerName(o))}</span>
      <button title="${o.visible === false ? 'Show' : 'Hide'}" onclick="event.stopPropagation();studioEdLayerVis(${studioEdId(o)})">${o.visible === false ? '🚫' : '👁'}</button>
      ${base || o.studioBg ? '' : `<button title="${o.studioLocked ? 'Unlock' : 'Lock'}" onclick="event.stopPropagation();studioEdLayerLock(${studioEdId(o)})">${o.studioLocked ? '🔒' : '🔓'}</button>`}
    </div>`);
  }
  el.innerHTML = rows.join('');
}
function studioEdLayerSel(id) {
  const c = StudioEd.canvas; const o = studioEdById(id); if (!o || o.studioBase || o.studioBg || o.visible === false) return;
  studioEdStopDraw(); c.setActiveObject(o); c.requestRenderAll(); studioEdSync();
}
function studioEdLayerVis(id) {
  const c = StudioEd.canvas; const o = studioEdById(id); if (!o) return;
  if (c.getActiveObject() === o) c.discardActiveObject();
  o.set('visible', o.visible === false); c.requestRenderAll(); studioEdSnap(); studioEdLayersSoon();
}
function studioEdLayerLock(id) {
  const c = StudioEd.canvas; const o = studioEdById(id); if (!o) return;
  studioEdApplyLock(o, !o.studioLocked); c.requestRenderAll(); studioEdSnap(); studioEdLayersSoon();
}

// ── Output ──
// The finished picture at full size, without handles, grid or guides
function studioEdRender() {
  const c = StudioEd.canvas;
  studioEdStopDraw(); c.discardActiveObject();
  const z = StudioEd.zoom;
  StudioEd.exporting = true; StudioEd.guides = null;
  c.setZoom(1); c.setDimensions({ width: StudioEd.w, height: StudioEd.h });
  let out;
  try { out = c.toCanvasElement(1); } finally { StudioEd.exporting = false; studioEdApplyZoom(z); }
  return out;
}
function studioEdPreview() {
  if (!StudioEd.canvas) return;
  document.getElementById('studio-ed-preview-img').src = studioEdRender().toDataURL('image/png');
  document.getElementById('studio-ed-preview').style.display = 'flex';
}
async function studioEdDownload(kind) {
  if (!StudioEd.canvas) return;
  try {
    let out = studioEdRender(), mime = 'image/png';
    if (kind === 'jpg') { // JPG has no see-through parts: put the picture on white
      const f = document.createElement('canvas'); f.width = out.width; f.height = out.height;
      const x = f.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, f.width, f.height); x.drawImage(out, 0, 0);
      out = f; mime = 'image/jpeg';
    }
    const blob = await new Promise((r) => out.toBlob(r, mime, 0.92));
    if (!blob) throw new Error('Could not make the file.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `picture-${Date.now()}.${kind === 'jpg' ? 'jpg' : 'png'}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (err) { toast(err.message || 'Could not download the picture.', 'error', 5000); }
}

// Saves the edited picture to the media library and uses it for this post
async function studioEdSave() {
  const c = StudioEd.canvas; if (!c) return;
  const btn = document.getElementById('studio-ed-save');
  btn.disabled = true;
  try {
    const out = studioEdRender();
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not save the picture.');
    // Keep the earlier version too (a picture from the library is already there)
    if (StudioEd.prevMade) {
      try {
        const pb = await (await fetch(StudioEd.prevMade)).blob();
        await uploadMediaFile(new File([pb], `studio-original-${Date.now()}.png`, { type: 'image/png' }));
        StudioEd.prevMade = null;
      } catch { toast('The earlier version could not be saved, but your edit is.', 'warning', 5000); }
    }
    const asset = await uploadMediaFile(new File([blob], `studio-edit-${Date.now()}.png`, { type: 'image/png' }));
    if (!asset || !asset.ref) throw new Error('The picture could not be saved to your media library.');
    const i = StudioEd.post;
    Studio.posts[i].pic.on = true;
    Studio.posts[i].pic.own = { ref: asset.ref, url: URL.createObjectURL(blob), edit: studioEdSnapshot() }; // edit: reopen with every item still separate
    studioEdClose();
    studioRenderCards([]);
  } catch (err) {
    toast(err.message || 'Could not save the picture.', 'error', 6000);
  } finally { btn.disabled = false; }
}

window.studioEdAddUrl = (u) => studioEdAddImageUrl(u).catch(() => toast('Could not add that image.', 'error'));
Object.assign(window, {
  studioEditPicture, studioEdClose, studioEdTab, studioEdAddText, studioEdAddEmoji, studioEdAddShape, studioEdAddFile, studioEdAddLogo,
  studioEdColor, studioEdBg, studioEdSwatch, studioEdPreview, studioEdDownload, studioEdSize, studioEdFont, studioEdOrder, studioEdDelete, studioEdSave,
  studioEdUndo, studioEdRedo, studioEdZoom, studioEdGrid, studioEdResize, studioEdToggle, studioEdAlign, studioEdProp, studioEdStroke, studioEdRadius,
  studioEdShadow, studioEdGradient, studioEdFilters, studioEdMask, studioEdFlip, studioEdPlace, studioEdLock, studioEdGroup, studioEdDuplicate,
  studioEdDraw, studioEdPen, studioEdLayerSel, studioEdLayerVis, studioEdLayerLock
});
