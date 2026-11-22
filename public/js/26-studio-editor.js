// Content Studio picture editor: drag, resize and edit text, shapes, photos and your logo on the
// post's picture. Built on Fabric.js (MIT licence), loaded from /vendor/fabric.min.js only when opened.
const StudioEd = { canvas: null, post: -1, w: 0, h: 0, bg: null };

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

async function studioEditPicture(i) {
  const p = Studio.posts[i];
  if (!p || !p.pic) return;
  try {
    await studioEdLoadLib();
    // Start from the picture as it is now: the person's own image, or the made one
    const base = document.createElement('canvas');
    let url;
    if (p.pic.own) { url = p.pic.own.url; }
    else { renderDesign(base, studioPicSettings(p)); url = base.toDataURL('image/png'); }
    const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
    StudioEd.w = img.width; StudioEd.h = img.height; StudioEd.post = i;
    document.getElementById('studio-editor').style.display = 'flex';
    if (typeof studioRenderTray === 'function') studioRenderTray();
    if (StudioEd.canvas) StudioEd.canvas.dispose();
    const c = new fabric.Canvas('studio-ed-canvas', { width: img.width, height: img.height, preserveObjectStacking: true, enableRetinaScaling: false });
    // Show it smaller on screen; it is saved at full size
    const shown = Math.min(1, 620 / img.width, 360 / img.height);
    StudioEd.zoom = shown;
    c.setZoom(shown);
    c.setDimensions({ width: Math.round(img.width * shown), height: Math.round(img.height * shown) });
    img.set({ left: 0, top: 0, originX: 'left', originY: 'top', selectable: false, evented: false });
    c.add(img);
    c.on('selection:created', studioEdSync);
    c.on('selection:updated', studioEdSync);
    c.on('selection:cleared', studioEdSync);
    StudioEd.canvas = c;
    StudioEd.bg = null;
    c.renderAll(); // draw now, do not wait for the next animation frame
    studioEdSync();
  } catch (err) { toast(err.message || 'Could not open the editor.', 'error', 6000); }
}

function studioEdClose() {
  document.getElementById('studio-editor').style.display = 'none';
  if (StudioEd.canvas) { StudioEd.canvas.dispose(); StudioEd.canvas = null; }
}

const studioEdBrand = () => { const d = designDefaults(); return { c1: d.c1, c2: d.c2, c3: d.c3 }; };

function studioEdAddText() {
  const c = StudioEd.canvas; if (!c) return;
  const col = studioEdBrand();
  const t = new fabric.IText('Your text', { originX: 'left', originY: 'top', left: StudioEd.w * 0.1, top: StudioEd.h * 0.4, fontSize: Math.round(StudioEd.h / 9), fontWeight: '700', fill: '#ffffff', stroke: col.c1, strokeWidth: 0, fontFamily: (Designer.brand && Designer.brand.font_name) || 'Inter' });
  c.add(t); c.setActiveObject(t); c.requestRenderAll();
}
function studioEdAddShape(kind) {
  const c = StudioEd.canvas; if (!c) return;
  const col = studioEdBrand().c1;
  const s = Math.round(Math.min(StudioEd.w, StudioEd.h) / 4);
  const o = kind === 'circle' ? new fabric.Circle({ radius: s / 2, fill: col }) : new fabric.Rect({ width: s * 1.6, height: s * 0.7, fill: col, rx: 12, ry: 12 });
  o.set({ originX: 'left', originY: 'top', left: StudioEd.w * 0.3, top: StudioEd.h * 0.3 });
  c.add(o); c.setActiveObject(o); c.requestRenderAll();
}
async function studioEdAddImageUrl(url) {
  const c = StudioEd.canvas; if (!c) return;
  const im = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
  const k = Math.min(1, (StudioEd.w * 0.4) / im.width, (StudioEd.h * 0.4) / im.height);
  im.set({ originX: 'left', originY: 'top', left: StudioEd.w * 0.05, top: StudioEd.h * 0.05, scaleX: k, scaleY: k });
  c.add(im); c.setActiveObject(im); c.requestRenderAll();
}
async function studioEdAddFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast('Pick an image file.', 'warning');
  try { await studioEdAddImageUrl(URL.createObjectURL(file)); } catch { toast('Could not add that image.', 'error'); }
}
async function studioEdAddLogo() {
  const u = Designer.brand && Designer.brand.logo_url;
  if (!u) return toast('Your Brand kit has no logo yet. Add one in Brand kit, or use "Add image".', 'info', 6000);
  try { await studioEdAddImageUrl(typeof mediaSrc === 'function' ? mediaSrc(u) : u); }
  catch { toast('The logo could not be loaded. Use "Add image" with the logo file instead.', 'warning', 6000); }
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
  c.add(r); c.moveObjectTo(r, 1); StudioEd.bg = r;
  c.requestRenderAll(); c.renderAll();
}

function studioEdColor(v) {
  const c = StudioEd.canvas; const o = c && c.getActiveObject();
  if (!o || o.type === 'image') return;
  o.set('fill', v); c.requestRenderAll();
}
function studioEdFont(v) {
  const c = StudioEd.canvas; const o = c && c.getActiveObject();
  if (!o || !('fontFamily' in o)) return;
  o.set('fontFamily', v); c.requestRenderAll(); c.renderAll();
}
function studioEdSize(v) {
  const c = StudioEd.canvas; const o = c && c.getActiveObject();
  if (!o || !('fontSize' in o)) return;
  o.set('fontSize', Math.max(8, Math.min(400, Number(v) || 40))); c.requestRenderAll();
}
function studioEdOrder(dir) {
  const c = StudioEd.canvas; const o = c && c.getActiveObject();
  if (!o) return;
  if (dir > 0) c.bringObjectForward(o); else if (c.getObjects().indexOf(o) > (StudioEd.bg ? 2 : 1)) c.sendObjectBackwards(o); // never behind the base picture
  c.requestRenderAll();
}
function studioEdDelete() {
  const c = StudioEd.canvas; if (!c) return;
  c.getActiveObjects().forEach((o) => c.remove(o));
  c.discardActiveObject(); c.requestRenderAll();
}
// Colour and size controls follow the selected item
function studioEdSync() {
  const c = StudioEd.canvas; const o = c && c.getActiveObject();
  const box = document.getElementById('studio-ed-sel');
  if (!box) return;
  box.style.opacity = o ? '1' : '0.4';
  box.querySelectorAll('input,button,select').forEach((el) => { el.disabled = !o; });
  if (o) {
    const col = document.getElementById('studio-ed-color');
    if (col && typeof o.fill === 'string' && /^#[0-9a-f]{6}$/i.test(o.fill)) col.value = o.fill;
    const ff = document.getElementById('studio-ed-font');
    if (ff) {
      ff.disabled = !('fontFamily' in o);
      if ('fontFamily' in o) {
        if (![...ff.options].some((op) => op.value === o.fontFamily)) ff.add(new Option(o.fontFamily, o.fontFamily));
        ff.value = o.fontFamily;
      }
    }
    const sz = document.getElementById('studio-ed-size');
    if (sz) { sz.disabled = !('fontSize' in o); if ('fontSize' in o) sz.value = Math.round(o.fontSize); }
  }
}

// Shows the finished picture, without selection handles, exactly as it will be saved
function studioEdPreview() {
  const c = StudioEd.canvas; if (!c) return;
  const z = StudioEd.zoom || 1;
  c.discardActiveObject();
  c.setZoom(1); c.setDimensions({ width: StudioEd.w, height: StudioEd.h });
  const url = c.toCanvasElement(1).toDataURL('image/png');
  c.setZoom(z); c.setDimensions({ width: Math.round(StudioEd.w * z), height: Math.round(StudioEd.h * z) });
  c.renderAll();
  document.getElementById('studio-ed-preview-img').src = url;
  document.getElementById('studio-ed-preview').style.display = 'flex';
}

// Saves the edited picture to the media library and uses it for this post
async function studioEdSave() {
  const c = StudioEd.canvas; if (!c) return;
  const btn = document.getElementById('studio-ed-save');
  btn.disabled = true;
  try {
    c.discardActiveObject(); c.requestRenderAll();
    // Back to full size so the saved picture is not the small on-screen copy
    c.setZoom(1); c.setDimensions({ width: StudioEd.w, height: StudioEd.h });
    const out = c.toCanvasElement(1);
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not save the picture.');
    const asset = await uploadMediaFile(new File([blob], `studio-edit-${Date.now()}.png`, { type: 'image/png' }));
    if (!asset || !asset.ref) throw new Error('The picture could not be saved to your media library.');
    const i = StudioEd.post;
    Studio.posts[i].pic.on = true;
    Studio.posts[i].pic.own = { ref: asset.ref, url: URL.createObjectURL(blob) };
    studioEdClose();
    studioRenderCards([]);
  } catch (err) {
    toast(err.message || 'Could not save the picture.', 'error', 6000);
  } finally { btn.disabled = false; }
}

window.studioEdAddUrl = (u) => studioEdAddImageUrl(u).catch(() => toast('Could not add that image.', 'error'));
window.studioEditPicture = studioEditPicture;
window.studioEdClose = studioEdClose;
window.studioEdAddText = studioEdAddText;
window.studioEdAddShape = studioEdAddShape;
window.studioEdAddFile = studioEdAddFile;
window.studioEdAddLogo = studioEdAddLogo;
window.studioEdColor = studioEdColor;
window.studioEdBg = studioEdBg;
window.studioEdPreview = studioEdPreview;
window.studioEdSize = studioEdSize;
window.studioEdFont = studioEdFont;
window.studioEdOrder = studioEdOrder;
window.studioEdDelete = studioEdDelete;
window.studioEdSave = studioEdSave;
