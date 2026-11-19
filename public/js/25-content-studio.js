// Content Studio: web pages, text files or pasted text -> a post per network (heading, text,
// hashtags) -> reviewed by the person -> scheduled. Server: /api/content/studio/*.
const Studio = { sources: [], posts: [] };
const STUDIO_MAX_FILE = 2 * 1024 * 1024;

function studioPlatformList() {
  return Object.keys(PLATFORMS).filter((k) => !PLATFORMS[k].hidden);
}

function openContentStudio() {
  Studio.posts = [];
  studioShowStep(1);
  const box = document.getElementById('studio-platforms');
  if (box && !box.children.length) {
    box.innerHTML = studioPlatformList().map((k) =>
      `<label style="display:inline-flex;gap:5px;align-items:center;font-size:13px;border:1px solid var(--border);border-radius:8px;padding:5px 10px;cursor:pointer"><input type="checkbox" class="studio-plat" value="${k}" checked> ${escapeHtml(PLATFORMS[k].label)}</label>`).join('');
  }
  studioRenderSources();
  document.getElementById('studio-modal').style.display = 'flex';
}
function closeContentStudio() { document.getElementById('studio-modal').style.display = 'none'; }

function studioShowStep(n) {
  document.getElementById('studio-step-1').style.display = n === 1 ? '' : 'none';
  document.getElementById('studio-step-2').style.display = n === 2 ? '' : 'none';
  document.getElementById('studio-generate-btn').style.display = n === 1 ? '' : 'none';
  document.getElementById('studio-back').style.display = n === 2 ? '' : 'none';
  document.getElementById('studio-draft-btn').style.display = n === 2 ? '' : 'none';
  document.getElementById('studio-schedule-btn').style.display = n === 2 ? '' : 'none';
}
function studioBack() { studioShowStep(1); }

function studioRenderSources() {
  const el = document.getElementById('studio-sources');
  if (!el) return;
  el.innerHTML = Studio.sources.length
    ? Studio.sources.map((s, i) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:13px"><span>📄 ${escapeHtml(s.name)} <span style="color:var(--text-muted)">· ${s.text.length.toLocaleString()} characters</span></span><a href="#" onclick="studioRemoveSource(${i});return false">Remove</a></div>`).join('')
    : '<div style="font-size:12.5px;color:var(--text-muted)">Nothing added yet.</div>';
}
function studioRemoveSource(i) { Studio.sources.splice(i, 1); studioRenderSources(); }

async function studioAddFiles(files) {
  for (const f of Array.from(files || [])) {
    if (f.size > STUDIO_MAX_FILE) { toast(`${f.name} is too big (over 2 MB).`, 'warning'); continue; }
    try { Studio.sources.push({ name: f.name, text: await f.text() }); }
    catch { toast(`Could not read ${f.name}.`, 'warning'); }
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

async function studioGenerate() {
  // Text left in the paste box counts too
  if ((document.getElementById('studio-paste').value || '').trim().length >= 20) studioAddPasted();
  const platforms = Array.from(document.querySelectorAll('.studio-plat:checked')).map((c) => c.value);
  if (!Studio.sources.length) return toast('Add a file or paste some text first.', 'info');
  if (!platforms.length) return toast('Pick at least one platform.', 'info');
  const btn = document.getElementById('studio-generate-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Writing… (can take a minute)';
  try {
    const res = await api('POST', '/api/content/studio/generate', {
      sources: Studio.sources, platforms, language: document.getElementById('studio-language').value.trim(),
    });
    Studio.posts = (res.posts || []).map((p) => ({ ...p, title: p.heading, keep: p.can_post }));
    studioRenderCards(res.problems || []);
    const d = new Date(Date.now() + 3600 * 1000);
    d.setMinutes(0, 0, 0);
    document.getElementById('studio-start').value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    studioShowStep(2);
    studioUpdateWhen();
  } catch (err) {
    toast(err.message || 'Could not write the posts.', 'error', 7000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function studioRenderCards(problems) {
  document.getElementById('studio-problems').innerHTML = problems.length
    ? `<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.4);border-radius:8px;padding:8px 12px;font-size:12.5px;margin-bottom:10px">${problems.map((p) => `${escapeHtml(p.source)}: ${escapeHtml(p.error)}`).join('<br>')}</div>` : '';
  const bySource = {};
  Studio.posts.forEach((p, i) => { (bySource[p.source] = bySource[p.source] || []).push([p, i]); });
  document.getElementById('studio-cards').innerHTML = Object.keys(bySource).map((src) =>
    `<div style="font-weight:700;margin:12px 0 6px">📄 ${escapeHtml(src)}</div>` + bySource[src].map(([p, i]) => {
      const pm = PLATFORMS[p.platform] || { label: p.platform };
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
          <label style="display:flex;gap:6px;align-items:center;font-weight:600;font-size:13px"><input type="checkbox" ${p.keep ? 'checked' : ''} ${p.can_post ? '' : 'disabled'} onchange="studioToggle(${i},this.checked)"> ${escapeHtml(pm.label)}</label>
          <span id="studio-count-${i}" style="font-size:11.5px"></span>
        </div>
        ${p.can_post ? '' : '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">Posting here is not available yet. Copy the text instead.</div>'}
        <textarea class="form-textarea" rows="6" style="width:100%" oninput="studioEdit(${i},this.value)">${escapeHtml(p.text)}</textarea>
      </div>`;
    }).join('')).join('');
  Studio.posts.forEach((_, i) => studioCount(i));
}
function studioCount(i) {
  const p = Studio.posts[i];
  const el = document.getElementById(`studio-count-${i}`);
  if (!el) return;
  const over = p.limit && p.text.length > p.limit;
  el.textContent = `${p.text.length}${p.limit ? ' / ' + p.limit : ''}`;
  el.style.color = over ? '#ef4444' : 'var(--text-muted)';
}
function studioEdit(i, v) { Studio.posts[i].text = v; studioCount(i); }
function studioToggle(i, on) { Studio.posts[i].keep = on; studioUpdateWhen(); }

function studioChosen() { return Studio.posts.filter((p) => p.keep && p.can_post); }
function studioUpdateWhen() {
  const n = studioChosen().length;
  const el = document.getElementById('studio-when');
  if (el) el.textContent = `${n} post${n === 1 ? '' : 's'} will be scheduled`;
}

async function studioSchedule(status) {
  const chosen = studioChosen();
  if (!chosen.length) return toast('Tick at least one post.', 'info');
  const over = chosen.find((p) => p.limit && p.text.length > p.limit);
  if (over) return toast(`The ${(PLATFORMS[over.platform] || {}).label || over.platform} post is over its limit. Shorten it.`, 'warning', 6000);
  const startVal = document.getElementById('studio-start').value;
  const start_at = Math.floor(new Date(startVal).getTime() / 1000);
  if (!startVal || !Number.isFinite(start_at)) return toast('Pick when the first post goes out.', 'info');
  try {
    const res = await api('POST', '/api/content/studio/schedule', {
      posts: chosen.map((p) => ({ platform: p.platform, text: p.text, title: p.title })),
      start_at, interval_hours: Number(document.getElementById('studio-interval').value), status,
    });
    const miss = (res.no_account || []).map((k) => (PLATFORMS[k] || {}).label || k);
    toast(`${res.total} post${res.total === 1 ? '' : 's'} ${res.status === 'scheduled' ? 'scheduled' : 'saved as drafts'}.${miss.length ? ` Connect ${miss.join(', ')} in Accounts so they can go out.` : ''}`, miss.length ? 'warning' : 'success', 9000);
    closeContentStudio();
    Studio.sources = [];
    if (typeof navigateTo === 'function') navigateTo('calendar');
  } catch (err) {
    toast(err.message || 'Could not schedule.', 'error', 7000);
  }
}

window.openContentStudio = openContentStudio;
window.closeContentStudio = closeContentStudio;
