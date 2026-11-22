/* Video editing for Content Studio: trim, crop to a shape, add a caption, mute. Everything happens on this PC
   (the video is played onto a canvas and recorded again), and the result is saved to the media library as a new MP4. */
const StudioVid = { src: null, post: -1, name: 'video', busy: false, cancel: false, aud: null };
const STUDIO_VID_SHAPES = { orig: ['Original', 0], sq: ['Square 1:1', 1], por: ['Portrait 4:5', 0.8], story: ['Vertical 9:16 (Reels, Shorts, Stories)', 9 / 16], wide: ['Wide 16:9', 16 / 9] };
const studioVidEl = (id) => document.getElementById(id);

function studioVidMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

function studioVidBuild() {
  if (studioVidEl('studio-vid')) return;
  const box = document.createElement('div');
  box.className = 'modal-overlay'; box.id = 'studio-vid'; box.style.cssText = 'display:none;z-index:1250';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Edit video');
  box.innerHTML = `<div class="modal" style="max-width:760px;width:96vw" onclick="event.stopPropagation()">
    <div class="modal-title">✂️ Edit video</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <div style="flex:1 1 360px;min-width:0">
        <div id="studio-vid-stage" style="position:relative;background:#000;border-radius:8px;overflow:hidden;display:flex;justify-content:center">
          <video id="studio-vid-v" playsinline preload="auto" style="max-width:100%;max-height:46vh;display:block"></video>
          <div id="studio-vid-cap" style="position:absolute;left:6%;right:6%;text-align:center;font-weight:800;text-shadow:0 2px 6px #000;pointer-events:none;line-height:1.2"></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <button type="button" class="btn btn-secondary btn-sm" id="studio-vid-play" onclick="studioVidPlay()">▶ Play trimmed part</button>
          <span id="studio-vid-info" style="font-size:12px;color:var(--text-muted)"></span>
        </div>
      </div>
      <div style="flex:1 1 260px;display:flex;flex-direction:column;gap:10px;font-size:13px">
        <label>Start at <b id="studio-vid-sv"></b><input type="range" id="studio-vid-s" min="0" max="0" step="0.1" value="0" style="width:100%" oninput="studioVidTrim('s')"></label>
        <label>End at <b id="studio-vid-ev"></b><input type="range" id="studio-vid-e" min="0" max="0" step="0.1" value="0" style="width:100%" oninput="studioVidTrim('e')"></label>
        <label>Shape <select id="studio-vid-shape" class="form-select" onchange="studioVidLook()">${Object.entries(STUDIO_VID_SHAPES).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></label>
        <label>Words on the video <input type="text" id="studio-vid-text" class="form-input" maxlength="90" placeholder="e.g. 50% off this week" oninput="studioVidLook()"></label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="studio-vid-pos" class="form-select" style="width:auto" aria-label="Where the words go" onchange="studioVidLook()"><option value="b">Words at the bottom</option><option value="m">Words in the middle</option><option value="t">Words at the top</option></select>
          <input type="color" id="studio-vid-col" value="#ffffff" aria-label="Words colour" oninput="studioVidLook()">
        </div>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="studio-vid-mute"> Remove the sound</label>
        <div style="font-size:11.5px;color:var(--text-muted)">Saving plays the clip once to record it, so it takes as long as the clip. Keep this window open. Your original stays untouched.</div>
      </div>
    </div>
    <div id="studio-vid-prog" style="display:none;height:6px;background:var(--bg3);border-radius:4px;margin-top:10px;overflow:hidden"><div id="studio-vid-bar" style="height:100%;width:0;background:#7c3aed"></div></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button type="button" class="btn btn-secondary" id="studio-vid-cancel" onclick="studioVidClose()">Cancel</button>
      <button type="button" class="btn btn-primary" id="studio-vid-save" onclick="studioVidSave()">Use this video</button>
    </div>
  </div>`;
  box.onclick = (e) => { if (e.target === box && !StudioVid.busy) studioVidClose(); };
  document.body.appendChild(box);
}

// post: index of the Studio post to put the result on, or -1 to just save a new copy in the media library
async function studioEditVideo(src, post, name) {
  if (!studioVidMime()) return toast('This version of the app cannot edit videos yet. Update the app, or edit the video elsewhere and upload it.', 'warning', 7000);
  studioVidBuild();
  Object.assign(StudioVid, { src, post: post == null ? -1 : post, name: name || 'video', busy: false, cancel: false });
  const v = studioVidEl('studio-vid-v');
  v.removeAttribute('src'); v.src = src;
  studioVidEl('studio-vid-text').value = ''; studioVidEl('studio-vid-shape').value = 'orig'; studioVidEl('studio-vid-mute').checked = false;
  studioVidEl('studio-vid-prog').style.display = 'none';
  studioVidEl('studio-vid-save').disabled = true;
  studioVidEl('studio-vid').style.display = 'flex';
  v.onloadedmetadata = () => {
    if (!isFinite(v.duration) || v.duration < 0.5) { toast('That video has no readable length, so it cannot be trimmed here. Try another MP4.', 'warning', 6000); studioVidClose(); return; }
    const d = Math.floor(v.duration * 10) / 10 || 0;
    ['s', 'e'].forEach((k) => { const r = studioVidEl(`studio-vid-${k}`); r.max = d; r.value = k === 's' ? 0 : d; });
    studioVidTrim(); studioVidLook();
    studioVidEl('studio-vid-save').disabled = false;
  };
  v.onerror = () => { toast('That video could not be opened here. Try an MP4 file.', 'warning', 6000); studioVidClose(); };
}

function studioVidTrim(which) {
  const s = studioVidEl('studio-vid-s'), e = studioVidEl('studio-vid-e');
  if (+e.value - +s.value < 0.5) { if (which === 's') s.value = Math.max(0, +e.value - 0.5); else e.value = Math.min(+e.max, +s.value + 0.5); }
  studioVidEl('studio-vid-sv').textContent = `${(+s.value).toFixed(1)}s`;
  studioVidEl('studio-vid-ev').textContent = `${(+e.value).toFixed(1)}s`;
  studioVidEl('studio-vid-info').textContent = `Length ${(e.value - s.value).toFixed(1)}s`;
  const v = studioVidEl('studio-vid-v'); v.pause(); v.currentTime = which === 'e' ? +e.value : +s.value;
  studioVidEl('studio-vid-play').textContent = '▶ Play trimmed part';
}
function studioVidPlay() {
  const v = studioVidEl('studio-vid-v'), s = +studioVidEl('studio-vid-s').value, e = +studioVidEl('studio-vid-e').value;
  if (!v.paused) { v.pause(); studioVidEl('studio-vid-play').textContent = '▶ Play trimmed part'; return; }
  if (v.currentTime < s || v.currentTime >= e - 0.05) v.currentTime = s;
  v.muted = studioVidEl('studio-vid-mute').checked;
  v.play(); studioVidEl('studio-vid-play').textContent = '⏸ Pause';
  v.ontimeupdate = () => { if (v.currentTime >= e) { v.pause(); studioVidEl('studio-vid-play').textContent = '▶ Play trimmed part'; } };
}
// The frame: output size for the chosen shape (kept to 1080 on the long side so the file stays small)
function studioVidFrame() {
  const v = studioVidEl('studio-vid-v'), r = STUDIO_VID_SHAPES[studioVidEl('studio-vid-shape').value][1] || (v.videoWidth / v.videoHeight || 16 / 9);
  const W0 = r >= 1 ? 1080 : Math.round(1080 * r), H0 = r >= 1 ? Math.round(1080 / r) : 1080;
  return { W: W0 - (W0 % 2), H: H0 - (H0 % 2) };
}
function studioVidLook() { // live words preview over the player
  const t = studioVidEl('studio-vid-text').value, cap = studioVidEl('studio-vid-cap'), v = studioVidEl('studio-vid-v');
  cap.textContent = t; cap.style.color = studioVidEl('studio-vid-col').value;
  cap.style.fontSize = Math.max(12, Math.round((v.clientHeight || 300) * 0.06)) + 'px';
  const pos = studioVidEl('studio-vid-pos').value;
  cap.style.top = pos === 't' ? '6%' : pos === 'm' ? '45%' : 'auto'; cap.style.bottom = pos === 'b' ? '7%' : 'auto';
}
function studioVidClose() {
  if (StudioVid.busy) { StudioVid.cancel = true; return; }
  const b = studioVidEl('studio-vid'); if (b) b.style.display = 'none';
  const v = studioVidEl('studio-vid-v'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
}

async function studioVidSave() {
  if (StudioVid.busy) return;
  const v = studioVidEl('studio-vid-v'), mime = studioVidMime();
  const s = +studioVidEl('studio-vid-s').value, e = +studioVidEl('studio-vid-e').value;
  const { W, H } = studioVidFrame();
  const text = studioVidEl('studio-vid-text').value.trim(), col = studioVidEl('studio-vid-col').value, pos = studioVidEl('studio-vid-pos').value;
  const mute = studioVidEl('studio-vid-mute').checked;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const stream = cv.captureStream(30);
  let actx = null, dest = null;
  if (!mute) {
    try {
      // One audio context for the video element for the whole session (an element can only be wired once)
      if (!StudioVid.aud || StudioVid.aud.el !== v) {
        const ctx0 = new (window.AudioContext || window.webkitAudioContext)();
        const node0 = ctx0.createMediaElementSource(v);
        node0.connect(ctx0.destination); // keeps the preview audible
        StudioVid.aud = { el: v, ctx: ctx0, node: node0 };
      }
      actx = StudioVid.aud.ctx;
      if (actx.state === 'suspended') await actx.resume();
      dest = actx.createMediaStreamDestination();
      StudioVid.aud.node.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch { /* no sound is better than no video */ }
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
  const chunks = []; rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  const done = new Promise((res) => { rec.onstop = res; });
  StudioVid.busy = true; StudioVid.cancel = false;
  const btn = studioVidEl('studio-vid-save'), prog = studioVidEl('studio-vid-prog'), bar = studioVidEl('studio-vid-bar');
  btn.disabled = true; btn.textContent = 'Recording…'; prog.style.display = 'block'; studioVidEl('studio-vid-cancel').textContent = 'Stop';
  v.pause(); v.muted = mute; v.currentTime = s;
  await new Promise((r) => { v.onseeked = r; setTimeout(r, 1500); });
  const sw = v.videoWidth, sh = v.videoHeight, k = Math.max(W / sw, H / sh); // fill the frame, crop the rest
  let raf = 0;
  const draw = () => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(v, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
    if (text) {
      const fs = Math.round(H * 0.06); ctx.font = `800 ${fs}px sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = col;
      ctx.shadowColor = '#000c'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      const words = text.split(/\s+/), lines = []; let cur = '';
      words.forEach((w) => { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > W * 0.88 && cur) { lines.push(cur); cur = w; } else cur = t; });
      if (cur) lines.push(cur);
      const lh = fs * 1.2, total = lines.length * lh;
      let y = pos === 't' ? H * 0.06 + fs : pos === 'm' ? (H - total) / 2 + fs : H * 0.93 - total + fs;
      lines.forEach((l) => { ctx.fillText(l, W / 2, y); y += lh; });
      ctx.shadowColor = 'transparent';
    }
    bar.style.width = `${Math.min(100, ((v.currentTime - s) / (e - s)) * 100)}%`;
    if (v.currentTime >= e || v.ended || StudioVid.cancel) { rec.state !== 'inactive' && rec.stop(); return; }
    raf = requestAnimationFrame(draw);
  };
  try {
    rec.start(250);
    await v.play();
    draw();
    await done;
  } catch (err) {
    cancelAnimationFrame(raf); try { rec.state !== 'inactive' && rec.stop(); } catch {}
    StudioVid.busy = false; btn.disabled = false; btn.textContent = 'Use this video'; studioVidEl('studio-vid-cancel').textContent = 'Cancel';
    return toast('The video could not be recorded here: ' + (err.message || 'unknown problem'), 'error', 7000);
  }
  v.pause(); stream.getTracks().forEach((t) => t.stop()); if (dest) { try { StudioVid.aud.node.disconnect(dest); } catch {} }
  const cancelled = StudioVid.cancel;
  StudioVid.busy = false; btn.disabled = false; btn.textContent = 'Use this video'; studioVidEl('studio-vid-cancel').textContent = 'Cancel'; prog.style.display = 'none';
  if (cancelled) { StudioVid.cancel = false; return toast('Stopped. Nothing was saved.', 'info', 3000); }
  const blob = new Blob(chunks, { type: 'video/mp4' });
  if (!blob.size) return toast('Nothing was recorded. Try again.', 'warning');
  try {
    const base = String(StudioVid.name).replace(/\.[a-z0-9]+$/i, '') || 'video';
    const asset = await uploadMediaFile(new File([blob], `${base}-edited-${Date.now()}.mp4`, { type: 'video/mp4' }));
    if (!asset || !asset.ref) throw new Error('The video could not be saved to your media library.');
    State.studioMediaItems = null;
    const i = StudioVid.post, p = i >= 0 && Studio.posts[i];
    if (p && p.pic) {
      p.pic.on = true; p.pic.own = { ref: asset.ref, url: asset.url, kind: 'video' };
      studioRenderCards([]);
      toast('Video added to the post.', 'success', 3000);
    } else toast('Saved to your media library as a new video. The original is untouched.', 'success', 4000);
    studioLoadTray(true);
    if (typeof loadMediaLibrary === 'function' && document.getElementById('media-grid')) loadMediaLibrary();
    const b = studioVidEl('studio-vid'); b.style.display = 'none'; v.removeAttribute('src'); v.load();
  } catch (err) { toast(err.message || 'Could not save the video.', 'error', 7000); }
}

// "Start with a video": choose a file, save it to the library, make a post for each ticked network and open the editor
async function studioStartWithVideo(file) {
  if (!file) return;
  if (!/^video\//.test(file.type)) return toast('Pick a video file (MP4 or MOV).', 'warning');
  try {
    toast('Adding your video…', 'info', 2500);
    const asset = await uploadMediaFile(file);
    if (!asset || !asset.ref) throw new Error('The video could not be saved to your media library.');
    await studioWriteMyself();
    const i = Studio.posts.findIndex((p) => p.can_post && p.pic);
    if (i < 0) return;
    Studio.posts[i].pic.on = true; Studio.posts[i].pic.own = { ref: asset.ref, url: asset.url, kind: 'video' };
    studioRenderCards([]); studioLoadTray(true);
    studioEditVideo(asset.url, i, file.name);
  } catch (err) { toast(err.message || 'Could not add the video.', 'error', 6000); }
}

Object.assign(window, { studioEditVideo, studioVidTrim, studioVidPlay, studioVidLook, studioVidClose, studioVidSave, studioStartWithVideo });
