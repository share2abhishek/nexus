// NexaDrip app — Post designer: make a branded picture for a post in a minute.
// One of the files in public/js, loaded in order by index.html (shared global scope).
//
// Pick a template and size, type a headline, and the picture uses the Brand kit's
// colours, logo and business name. "Add to post" saves it to the media library and
// attaches it to Create post. Everything is drawn here on this PC (a <canvas>):
// no design service, no upload anywhere else.

const DESIGN_SIZES = {
  square:   { w: 1080, h: 1080, label: 'Square', hint: 'Instagram, Facebook' },
  portrait: { w: 1080, h: 1350, label: 'Portrait', hint: 'Instagram feed' },
  story:    { w: 1080, h: 1920, label: 'Story / Reel', hint: 'Stories, Status' },
  wide:     { w: 1200, h: 628,  label: 'Wide', hint: 'LinkedIn, X, Facebook links' },
};

const DESIGN_TEMPLATES = {
  offer:    { label: 'Offer / sale',   sample: { headline: '20% off this weekend', details: 'On all cakes and pastries. Saturday and Sunday only.', cta: 'Order now' } },
  announce: { label: 'Announcement',   sample: { headline: 'We’re now open on Sundays', details: 'Visit us from 10 am to 6 pm, every Sunday.', cta: 'See you there' } },
  tip:      { label: 'Tip or quote',   sample: { headline: 'Drink a glass of water before every meal.', details: '', cta: '' } },
  festival: { label: 'Festival greeting', sample: { headline: 'Happy Diwali', details: 'Wishing you and your family light, joy and sweetness.', cta: '' } },
  photo:    { label: 'Photo with text', sample: { headline: 'Fresh this morning', details: 'Come early — they go fast.', cta: '' } },
};

const Designer = {
  open: false,
  brand: null,
  photo: null,      // HTMLImageElement used as background
  logo: null,       // HTMLImageElement
  logoNote: '',
  s: null,          // current settings
};

function designDefaults() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('nexus_designer') || '{}'); } catch {}
  const b = Designer.brand || {};
  return {
    size: saved.size || designSizeForPost(),
    template: saved.template && saved.template !== 'photo' ? saved.template : 'offer', // "photo" needs a photo first
    headline: '', details: '', cta: '',
    footer: b.company_name || '',
    c1: b.primary_color || '#0f2338',
    c2: b.secondary_color || '#3b82f6',
    c3: b.accent_color || '#f59e0b',
    showLogo: true,
    // Headline text styling (editor controls)
    headColor: '', headBold: true, headItalic: false, headScale: 'medium',
  };
}

// The size that fits the platforms chosen in Create post
function designSizeForPost() {
  const plats = typeof getSelectedPlatforms === 'function' ? getSelectedPlatforms('compose-platforms') : [];
  const ig = document.getElementById('compose-ig-format')?.value;
  if (plats.includes('instagram') && (ig === 'story' || ig === 'reel')) return 'story';
  if (plats.length && plats.every(p => ['linkedin', 'twitter', 'google_business'].includes(p))) return 'wide';
  return 'square';
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [15, 35, 56];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Black or white text, whichever reads better on this colour
function inkFor(hex) { return luminance(hex) > 0.45 ? '#111827' : '#ffffff'; }
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

// ── Brand font ────────────────────────────────────────────────────────────────
// Designs use the Brand kit font. Only Inter ships with the app; the others load
// from Google Fonts when online and fall back to Inter offline.
const DESIGN_FONTS = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Open Sans', 'Lato', 'Nunito', 'Space Grotesk'];
function designFontName() {
  const f = Designer.brand?.font_name;
  return DESIGN_FONTS.includes(f) ? f : 'Inter';
}
// A canvas font string in the brand font, always with safe fallbacks
function designFont(weight, size, italic = false) {
  return `${italic ? 'italic ' : ''}${weight} ${Math.round(size)}px '${designFontName()}', Inter, Arial, sans-serif`;
}
// Headline size presets (Small / Medium / Large)
const HEAD_SCALES = { small: 0.82, medium: 1, large: 1.25 };
// Make sure the brand font is ready before drawing, so the canvas doesn't fall back
async function ensureBrandFont() {
  const f = designFontName();
  if (f === 'Inter' || !document.fonts) return; // Inter is bundled
  const id = 'brandfont-' + f.replace(/\s+/g, '-');
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}:wght@400;600;700;800&display=swap`;
    document.head.appendChild(link);
  }
  try {
    await Promise.race([
      Promise.all([600, 700, 800].map(w => document.fonts.load(`${w} 48px '${f}'`))),
      new Promise(r => setTimeout(r, 2500)), // don't hang the designer if the CDN is slow/offline
    ]);
  } catch { /* offline or blocked: the canvas falls back to Inter */ }
}

// Wrap text into lines that fit maxWidth; shrink the font until it fits maxLines
function fitText(ctx, text, { maxWidth, maxLines, size, minSize = 28, weight = 800, lineHeight = 1.15, italic = false }) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], size, height: 0 };
  for (let s = size; s >= minSize; s -= 2) {
    ctx.font = designFont(weight, s, italic);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines || s - 2 < minSize) {
      const kept = lines.slice(0, maxLines);
      if (lines.length > maxLines) kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, '…');
      return { lines: kept, size: s, height: kept.length * s * lineHeight, lineHeight };
    }
  }
  return { lines: [], size: minSize, height: 0 };
}

function drawLines(ctx, fit, x, y, { align = 'left', color, weight = 800, italic = false }) {
  ctx.save();
  ctx.font = designFont(weight, fit.size, italic);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  // Light text gets a soft shadow so it stays readable on bright parts of a gradient or photo
  if (luminance(String(color).startsWith('#') ? color : '#ffffff') > 0.6 || /255,255,255/.test(color)) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = Math.round(fit.size * 0.25);
    ctx.shadowOffsetY = Math.round(fit.size * 0.04);
  }
  fit.lines.forEach((l, i) => ctx.fillText(l, x, y + i * fit.size * (fit.lineHeight || 1.15)));
  ctx.restore();
  return y + fit.height;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Cover-fit an image into the canvas (like CSS background-size: cover)
function drawCover(ctx, img, W, H) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function drawCta(ctx, text, x, y, { bg, align = 'left', scale = 1 }) {
  if (!text) return y;
  const size = Math.round(34 * scale);
  ctx.font = designFont(700, size);
  const w = Math.min(ctx.measureText(text).width + size * 1.6, 900 * scale);
  const h = size * 2;
  const left = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = bg;
  roundRect(ctx, left, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = inkFor(bg);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + w / 2, y + h / 2 + 1, w - size);
  return y + h;
}

function renderDesign(canvas, s) {
  const { w: W, h: H } = DESIGN_SIZES[s.size] || DESIGN_SIZES.square;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const k = Math.min(W, H) / 1080;          // scale for type sizes
  const pad = Math.round(Math.min(W, H) * 0.08);
  const wide = W / H > 1.5;
  const tpl = s.template;
  const photo = Designer.photo;

  // Background
  let bgForInk = s.c1;
  if (tpl === 'photo' && photo) {
    drawCover(ctx, photo, W, H);
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    bgForInk = '#000000';
  } else if (photo) {
    drawCover(ctx, photo, W, H);
    ctx.fillStyle = rgba(s.c1, 0.72); ctx.fillRect(0, 0, W, H);
  } else if (tpl === 'announce') {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = s.c1; ctx.fillRect(0, 0, Math.round(pad * 0.45), H);
    bgForInk = '#ffffff';
  } else if (tpl === 'festival') {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, s.c3); g.addColorStop(1, s.c1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // soft lights
    for (const [cx, cy, r] of [[0.12, 0.15, 0.18], [0.88, 0.22, 0.12], [0.8, 0.85, 0.22], [0.2, 0.9, 0.1]]) {
      const rg = ctx.createRadialGradient(W * cx, H * cy, 0, W * cx, H * cy, Math.min(W, H) * r);
      rg.addColorStop(0, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    bgForInk = s.c1;
  } else if (tpl === 'offer') {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, s.c1); g.addColorStop(1, s.c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = s.c1; ctx.fillRect(0, 0, W, H);
  }
  const ink = inkFor(bgForInk);
  const soft = ink === '#ffffff' ? 'rgba(255,255,255,0.85)' : 'rgba(17,24,39,0.75)';

  // Logo, top
  const logoH = Math.round(96 * k);
  let top = pad;
  if (s.showLogo && Designer.logo) {
    const lw = Math.min(logoH * (Designer.logo.naturalWidth / Designer.logo.naturalHeight), W * 0.4);
    const lx = tpl === 'tip' || tpl === 'festival' ? (W - lw) / 2 : (tpl === 'announce' ? pad * 1.2 : pad);
    ctx.drawImage(Designer.logo, lx, top, lw, logoH);
    top += logoH + pad * 0.4;
  }

  const centered = tpl === 'tip' || tpl === 'festival' || (tpl === 'offer' && !wide);
  const left = tpl === 'announce' ? Math.round(pad * 1.2) : pad;
  const x = centered ? W / 2 : left;
  const align = centered ? 'center' : 'left';
  const maxW = W - left - pad;
  const footerH = s.footer ? Math.round(40 * k) + pad * 0.6 : 0;

  // Text block — headline style from the editor (size / bold / italic / colour)
  const headScale = HEAD_SCALES[s.headScale] || 1;
  const baseHeadWeight = tpl === 'tip' ? 700 : 800;
  const headWeight = s.headBold === false ? 400 : baseHeadWeight;
  const headItalic = !!s.headItalic;
  const headSize = Math.round((tpl === 'festival' ? 130 : tpl === 'tip' ? 76 : 96) * k * (wide ? 0.8 : 1) * headScale);
  const head = fitText(ctx, tpl === 'tip' && s.headline ? `“${s.headline.replace(/^["“]|["”]$/g, '')}”` : s.headline,
    { maxWidth: maxW, maxLines: wide ? 3 : 5, size: headSize, minSize: Math.round(40 * k * headScale), weight: headWeight, italic: headItalic });
  const det = fitText(ctx, s.details, { maxWidth: maxW, maxLines: wide ? 2 : 4, size: Math.round(42 * k), minSize: Math.round(26 * k), weight: 500, lineHeight: 1.35 });
  const ctaH = s.cta ? Math.round(68 * k) : 0;
  const gap = Math.round(28 * k);
  const blockH = head.height + (det.lines.length ? gap + det.height : 0) + (ctaH ? gap * 1.4 + ctaH : 0);

  // Photo template: text sits at the bottom; others: centred in the space left
  let y;
  if (tpl === 'photo') y = H - pad - footerH - blockH;
  else y = Math.max(top, top + ((H - footerH - pad) - top - blockH) / 2);

  const headColor = s.headColor || (tpl === 'announce' ? '#111827' : ink);
  y = drawLines(ctx, head, x, y, { align, color: headColor, weight: headWeight, italic: headItalic });
  if (det.lines.length) y = drawLines(ctx, det, x, y + gap, { align, color: tpl === 'announce' ? '#374151' : soft, weight: 500 });
  if (ctaH) drawCta(ctx, s.cta, x, y + gap * 1.4, { bg: tpl === 'announce' ? s.c1 : s.c3, align, scale: k });

  // Footer: business name
  if (s.footer) {
    ctx.font = designFont(600, 34 * k);
    ctx.fillStyle = tpl === 'announce' ? s.c1 : soft;
    ctx.textAlign = centered ? 'center' : 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s.footer, centered ? W / 2 : left, H - pad * 0.8, maxW);
  }
}

// ── Images (photo / logo), always as same-origin or local data so the picture can be saved

function loadImage(src, { cors = false } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Couldn’t open this picture.'));
    img.src = src;
  });
}
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG or WEBP picture.'));
    const r = new FileReader();
    r.onload = () => loadImage(r.result).then(resolve, reject);
    r.onerror = () => reject(new Error('Couldn’t read this file.'));
    r.readAsDataURL(file);
  });
}
// Brand kit logo: library items and data: links work; other websites only if they allow it
async function loadBrandLogo(url) {
  Designer.logo = null; Designer.logoNote = '';
  if (!url) return;
  try {
    const sameOrigin = /^(data:|\/|media:)/.test(url) || url.startsWith(location.origin);
    Designer.logo = await loadImage(typeof mediaSrc === 'function' ? mediaSrc(url) : url, { cors: !sameOrigin });
    // Will the canvas still be saveable? Test on a 1px canvas.
    const t = document.createElement('canvas'); t.width = t.height = 1;
    t.getContext('2d').drawImage(Designer.logo, 0, 0); t.toDataURL();
  } catch {
    Designer.logo = null;
    Designer.logoNote = 'Your Brand kit logo is on another website that doesn’t allow this. Upload the logo file here instead.';
  }
}

// ── Modal ────────────────────────────────────────────────────────────────────

async function openPostDesigner() {
  try { Designer.brand = await api('GET', '/api/tools/brand-kit'); } catch { Designer.brand = {}; }
  Designer.s = designDefaults();
  Designer.photo = null;
  await loadBrandLogo(Designer.brand?.logo_url);
  await ensureBrandFont();

  // The post's own photo can be used as the background (the user chooses: it may
  // already be a finished design)
  Designer.postPhotoRef = (typeof composeMediaRefs === 'function' ? composeMediaRefs() : [])
    .find(r => /^media:\d+$/.test(r) && (State.mediaKinds?.[r] || 'image') === 'image') || null;

  let modal = document.getElementById('designer-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'designer-modal';
    modal.className = 'modal-overlay';
    modal.addEventListener('click', (e) => { if (e.target === modal) closePostDesigner(); });
    document.body.appendChild(modal);
  }
  modal.innerHTML = designerHtml();
  modal.style.display = 'flex';
  Designer.open = true;
  wireDesigner();
  redrawDesign();
}

function closePostDesigner() {
  const m = document.getElementById('designer-modal');
  if (m) m.style.display = 'none';
  Designer.open = false;
}

function designerHtml() {
  const s = Designer.s;
  const hasBrand = !!Designer.brand?.company_name;
  return `
    <div class="modal designer" role="dialog" aria-modal="true" aria-labelledby="designer-title" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title" id="designer-title">Design a picture</div>
        <button class="modal-close" onclick="closePostDesigner()" aria-label="Close">✕</button>
      </div>
      <div class="designer-body">
        <div class="designer-stage"><canvas id="designer-canvas" aria-label="Preview of your picture"></canvas></div>
        <div class="designer-controls">
          ${!hasBrand ? `<div class="callout callout-info" style="margin:0">Add your business name, colours and logo once in <a href="javascript:void(0)" onclick="closePostDesigner();navigateTo('brand')">Brand kit</a> and every design uses them.</div>` : ''}

          <div class="form-group">
            <div class="form-label">Template</div>
            <div class="designer-chips" data-field="template">
              ${Object.entries(DESIGN_TEMPLATES).map(([k, t]) => `<button type="button" class="designer-chip ${s.template === k ? 'on' : ''}" data-value="${k}">${escapeHtml(t.label)}</button>`).join('')}
            </div>
          </div>
          <div class="form-group">
            <div class="form-label">Size</div>
            <div class="designer-chips" data-field="size">
              ${Object.entries(DESIGN_SIZES).map(([k, z]) => `<button type="button" class="designer-chip ${s.size === k ? 'on' : ''}" data-value="${k}" title="${escapeHtml(z.hint)}">${escapeHtml(z.label)}</button>`).join('')}
            </div>
          </div>

          <div class="form-group">
            <label class="form-label wa-label-row" for="dz-headline"><span>Headline</span>
              <a href="javascript:void(0)" id="dz-fill" title="Use the text you wrote in Create post">Fill from my post</a></label>
            <textarea class="form-textarea" id="dz-headline" rows="2" maxlength="140" placeholder="${escapeHtml(DESIGN_TEMPLATES[s.template].sample.headline)}">${escapeHtml(s.headline)}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label" for="dz-details">Details <span class="form-hint" style="display:inline">(optional)</span></label>
            <textarea class="form-textarea" id="dz-details" rows="2" maxlength="220" placeholder="${escapeHtml(DESIGN_TEMPLATES[s.template].sample.details || 'A line or two')}">${escapeHtml(s.details)}</textarea>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label class="form-label" for="dz-cta">Button text</label>
              <input class="form-input" id="dz-cta" maxlength="30" value="${escapeHtml(s.cta)}" placeholder="${escapeHtml(DESIGN_TEMPLATES[s.template].sample.cta || 'e.g. Order now')}" />
            </div>
            <div class="form-group">
              <label class="form-label" for="dz-footer">Bottom line</label>
              <input class="form-input" id="dz-footer" maxlength="60" value="${escapeHtml(s.footer)}" placeholder="Business name, phone or website" />
            </div>
          </div>

          <div class="form-group">
            <div class="form-label">Headline style</div>
            <div class="designer-textstyle">
              <div class="designer-chips" data-field="headScale">
                <button type="button" class="designer-chip ${s.headScale === 'small' ? 'on' : ''}" data-value="small" title="Smaller headline">A-</button>
                <button type="button" class="designer-chip ${s.headScale === 'medium' || !s.headScale ? 'on' : ''}" data-value="medium" title="Normal headline">A</button>
                <button type="button" class="designer-chip ${s.headScale === 'large' ? 'on' : ''}" data-value="large" title="Larger headline">A+</button>
              </div>
              <button type="button" class="designer-chip ${s.headBold ? 'on' : ''}" data-toggle="headBold" title="Bold" style="font-weight:800">B</button>
              <button type="button" class="designer-chip ${s.headItalic ? 'on' : ''}" data-toggle="headItalic" title="Italic" style="font-style:italic">I</button>
              <label class="bot-check" title="Pick the headline text colour" style="margin-left:4px">
                <input type="checkbox" id="dz-textauto" ${s.headColor ? '' : 'checked'} /> Auto colour
              </label>
              <input type="color" id="dz-textcolor" value="${escapeHtml(s.headColor || '#ffffff')}" aria-label="Headline colour" ${s.headColor ? '' : 'disabled'} />
            </div>
          </div>

          <div class="form-group">
            <div class="form-label">Colours <span class="form-hint" style="display:inline">(Main is the background)</span></div>
            <div class="designer-colors">
              <label title="Main / background colour"><input type="color" id="dz-c1" value="${escapeHtml(s.c1)}" /> Background</label>
              <label title="Second colour (gradients)"><input type="color" id="dz-c2" value="${escapeHtml(s.c2)}" /> Second</label>
              <label title="Button and highlights"><input type="color" id="dz-c3" value="${escapeHtml(s.c3)}" /> Button</label>
            </div>
          </div>

          <div class="form-group">
            <div class="form-label">Pictures</div>
            <div class="designer-files">
              ${Designer.postPhotoRef ? '<button type="button" class="btn btn-secondary btn-sm" id="dz-photo-post">Use the post’s photo</button>' : ''}
              <label class="btn btn-secondary btn-sm">Photo from this PC… <input type="file" id="dz-photo" accept="image/png,image/jpeg,image/webp" hidden /></label>
              <button type="button" class="btn btn-ghost btn-ghost-danger btn-sm" id="dz-photo-clear" ${Designer.photo ? '' : 'hidden'}>Remove photo</button>
              <label class="btn btn-secondary btn-sm">Logo… <input type="file" id="dz-logo" accept="image/png,image/jpeg,image/webp" hidden /></label>
              <label class="bot-check"><input type="checkbox" id="dz-showlogo" ${s.showLogo ? 'checked' : ''} ${Designer.logo ? '' : 'disabled'} /> Show logo</label>
            </div>
            ${Designer.logoNote ? `<div class="form-hint">${escapeHtml(Designer.logoNote)}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="modal-footer designer-footer">
        <span class="form-hint">Made on this PC. Nothing is uploaded until you add it to the post.</span>
        <span style="flex:1"></span>
        <button class="btn btn-secondary" id="dz-download">Download</button>
        <button class="btn btn-primary" id="dz-add">Add to post</button>
      </div>
    </div>`;
}

function readDesignerForm() {
  const v = (id) => document.getElementById(id)?.value ?? '';
  const autoColor = document.getElementById('dz-textauto')?.checked !== false;
  Object.assign(Designer.s, {
    headline: v('dz-headline'), details: v('dz-details'), cta: v('dz-cta'), footer: v('dz-footer'),
    c1: v('dz-c1'), c2: v('dz-c2'), c3: v('dz-c3'),
    showLogo: !!document.getElementById('dz-showlogo')?.checked,
    headColor: autoColor ? '' : v('dz-textcolor'),
  });
}

function redrawDesign() {
  const canvas = document.getElementById('designer-canvas');
  if (!canvas) return;
  readDesignerForm();
  // Show the sample text while fields are empty, so the preview is never blank
  const sample = DESIGN_TEMPLATES[Designer.s.template].sample;
  const s = { ...Designer.s, headline: Designer.s.headline || sample.headline };
  if (!Designer.s.headline && !Designer.s.details) s.details = sample.details;
  if (!Designer.s.headline && !Designer.s.cta) s.cta = sample.cta;
  renderDesign(canvas, s);
  canvas.dataset.sample = Designer.s.headline ? '' : '1';
  try { localStorage.setItem('nexus_designer', JSON.stringify({ size: Designer.s.size, template: Designer.s.template })); } catch {}
}

function wireDesigner() {
  const modal = document.getElementById('designer-modal');
  modal.querySelectorAll('.designer-chips').forEach(group => {
    group.addEventListener('click', (e) => {
      const b = e.target.closest('.designer-chip');
      if (!b) return;
      group.querySelectorAll('.designer-chip').forEach(x => x.classList.toggle('on', x === b));
      Designer.s[group.dataset.field] = b.dataset.value;
      if (group.dataset.field === 'template') {
        const sm = DESIGN_TEMPLATES[b.dataset.value].sample;
        document.getElementById('dz-headline').placeholder = sm.headline;
        document.getElementById('dz-details').placeholder = sm.details || 'A line or two';
        document.getElementById('dz-cta').placeholder = sm.cta || 'e.g. Order now';
      }
      redrawDesign();
    });
  });
  modal.querySelector('.designer-controls').addEventListener('input', redrawDesign);

  // Headline Bold / Italic toggles (independent on/off, not single-select chips)
  modal.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.toggle;
      Designer.s[f] = !Designer.s[f];
      btn.classList.toggle('on', Designer.s[f]);
      redrawDesign();
    });
  });
  // Auto colour: enable the colour picker only when Auto is off
  const autoBox = document.getElementById('dz-textauto');
  if (autoBox) autoBox.addEventListener('change', () => {
    const picker = document.getElementById('dz-textcolor');
    if (picker) picker.disabled = autoBox.checked;
    redrawDesign();
  });

  document.getElementById('dz-fill').onclick = () => {
    const text = (document.getElementById('compose-content')?.value || '').replace(/#[\p{L}\p{N}_]+/gu, '').trim();
    if (!text) return toast('Write the post in Create post first (or let AI write it).', 'info');
    // First sentence becomes the headline; the next one the details
    const parts = text.split(/(?<=[.!?])\s+|\n+/).map(t => t.trim()).filter(Boolean);
    document.getElementById('dz-headline').value = (parts[0] || '').slice(0, 140);
    document.getElementById('dz-details').value = (parts.slice(1, 3).join(' ') || '').slice(0, 220);
    redrawDesign();
  };

  document.getElementById('dz-photo').onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      usePhoto(await fileToImage(f));
    } catch (err) { toast(err.message, 'error'); }
  };
  const usePhoto = (img) => {
    Designer.photo = img;
    document.getElementById('dz-photo-clear').hidden = false;
    if (Designer.s.template !== 'photo') {
      Designer.s.template = 'photo';
      modal.querySelectorAll('[data-field="template"] .designer-chip').forEach(x => x.classList.toggle('on', x.dataset.value === 'photo'));
    }
    redrawDesign();
  };
  const postBtn = document.getElementById('dz-photo-post');
  if (postBtn) postBtn.onclick = async () => {
    try { usePhoto(await loadImage(mediaSrc(Designer.postPhotoRef))); } catch (err) { toast(err.message, 'error'); }
  };
  document.getElementById('dz-photo-clear').onclick = (e) => {
    Designer.photo = null; e.target.hidden = true;
    if (Designer.s.template === 'photo') {
      Designer.s.template = 'offer';
      modal.querySelectorAll('[data-field="template"] .designer-chip').forEach(x => x.classList.toggle('on', x.dataset.value === 'offer'));
    }
    redrawDesign();
  };
  document.getElementById('dz-logo').onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      Designer.logo = await fileToImage(f);
      const cb = document.getElementById('dz-showlogo');
      cb.disabled = false; cb.checked = true;
      redrawDesign();
    } catch (err) { toast(err.message, 'error'); }
  };

  document.getElementById('dz-download').onclick = () => exportDesign('download');
  document.getElementById('dz-add').onclick = () => exportDesign('post');
  document.addEventListener('keydown', designerEsc);
}
function designerEsc(e) {
  if (e.key === 'Escape' && Designer.open) { closePostDesigner(); document.removeEventListener('keydown', designerEsc); }
}

async function exportDesign(where) {
  readDesignerForm();
  if (!Designer.s.headline.trim()) return toast('Type a headline first (the grey text is only an example).', 'warning');
  const canvas = document.createElement('canvas');
  renderDesign(canvas, Designer.s);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (!blob) return toast('Couldn’t make the picture. Try a different photo or logo.', 'error');
  const name = `design-${Designer.s.template}-${new Date().toISOString().slice(0, 10)}.png`;
  if (where === 'download') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }
  const btn = document.getElementById('dz-add');
  btn.disabled = true;
  try {
    await uploadComposeFile(new File([blob], name, { type: 'image/png' }));
    closePostDesigner();
  } finally { btn.disabled = false; }
}

window.openPostDesigner = openPostDesigner;
window.closePostDesigner = closePostDesigner;
