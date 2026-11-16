// NexaDrip app — Dashboard, quick generate and the AI Generate page.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

// ─────────────────────────────────────────────────────────────────────────────
// Status / Dashboard
// ─────────────────────────────────────────────────────────────────────────────

async function refreshStatus() {
  try {
    State.platformStatus = await api('GET', '/auth/status');
    renderDashboardPlatforms();
    updateSettingsBadges();
    updateStatPlatforms();
  } catch (err) {
    console.error('Status error:', err.message);
  }
}

function renderDashboardPlatforms() {
  const container = document.getElementById('dashboard-platforms');
  if (!container) return;
  container.innerHTML = Object.entries(PLATFORMS).filter(([, cfg]) => !cfg.hidden).map(([key, cfg]) => {
    const status = State.platformStatus[key];
    const connected = status?.connected;
    const name = status?.profile?.name || cfg.label;
    return `
      <div class="platform-card ${connected ? 'connected' : ''}" onclick="openSettings('platforms')" role="button" tabindex="0" title="${connected ? 'Manage' : 'Connect'} ${escapeHtml(cfg.label)}">
        <div class="platform-icon ${cfg.class}">${cfg.icon}</div>
        <div class="platform-info">
          <div class="platform-name">${cfg.label}</div>
          <div class="platform-status ${connected ? 'connected' : 'disconnected'}">
            ${connected
              ? (status.reconnect_in_days != null && status.reconnect_in_days <= 14
                  ? `<span style="color:#f59e0b" title="Click to reconnect in Settings">Reconnect ${status.reconnect_in_days === 0 ? 'today' : `in ${status.reconnect_in_days}d`}</span>`
                  : `✓ ${escapeHtml(name.split(' ')[0])}`)
              : status?.needs_reconnect ? '<span style="color:#f59e0b">Sign in again</span>' : 'Not connected'}
          </div>
        </div>
      </div>`;
  }).join('');
}

function updateStatPlatforms() {
  const visible = Object.entries(PLATFORMS).filter(([, c]) => !c.hidden).map(([k]) => k);
  const st = State.platformStatus || {};
  const count = visible.filter(k => st[k]?.connected).length;
  setEl('stat-platforms', `${count}/${visible.length}`);
  const fix = visible.filter(k => st[k]?.needs_reconnect || (st[k]?.connected && st[k].reconnect_in_days != null && st[k].reconnect_in_days <= 14)).length;
  setEl('stat-platforms-sub', fix ? `${fix} need${fix === 1 ? 's' : ''} signing in again` : count ? 'All working' : 'Connect your first one');
}

// Sidebar: a small count on Settings when an account needs signing in again
function updateSettingsBadges() {
  const st = State.platformStatus || {};
  const n = Object.values(st).filter(s => s?.needs_reconnect || (s?.connected && s.reconnect_in_days != null && s.reconnect_in_days <= 3)).length;
  const badge = document.getElementById('settings-attention-badge');
  if (!badge) return;
  badge.textContent = n ? String(n) : '';
  badge.style.display = n ? '' : 'none';
  badge.title = n ? `${n} account${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} signing in again` : '';
}

async function loadDashboard() {
  if (typeof loadSeoHomeCard === 'function') loadSeoHomeCard();
  await refreshStatus();
  loadDashboardStats();
  loadActivityFeed();
}

const DASH_DAY = 86400;
const dashPlat = (p) => PLATFORMS[p]?.icon || '';
const dashDay = (ts) => { const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0); return d.getTime(); };

function dashGreeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = String(State.user?.name || State.user?.email?.split('@')[0] || '').trim().split(/\s+/)[0];
  setEl('dash-greeting', name ? `${part}, ${name}` : part);
}

// "Needs your attention" chips: only things the user can act on
function renderDashAttention(items) {
  const box = document.getElementById('dash-attention');
  if (!box) return;
  if (!items.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = items.map(i => `<button type="button" class="dash-att ${i.tone || ''}" onclick="${i.go}"><span class="dash-att-ico" aria-hidden="true">${i.icon}</span><span class="dash-att-text"><b>${escapeHtml(i.title)}</b><small>${escapeHtml(i.hint)}</small></span><span class="dash-att-go" aria-hidden="true">›</span></button>`).join('');
}

function renderDashUpcoming(scheduled) {
  const box = document.getElementById('dash-upcoming');
  if (!box) return;
  const now = Date.now();
  const list = scheduled.filter(p => p.scheduled_at * 1000 > now - 60000).sort((a, b) => a.scheduled_at - b.scheduled_at).slice(0, 5);
  if (!list.length) {
    box.innerHTML = `<div class="dash-empty"><div>Nothing is scheduled yet.</div><button class="btn btn-primary btn-sm" onclick="navigateTo('compose')">Schedule a post</button></div>`;
    return;
  }
  const today = dashDay(now / 1000);
  box.innerHTML = list.map(p => {
    const d = new Date(p.scheduled_at * 1000);
    const day = dashDay(p.scheduled_at);
    const when = day === today ? 'Today' : day === today + DASH_DAY * 1000 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    const text = String(p.content || '').replace(/\s+/g, ' ').trim();
    return `<button type="button" class="dash-up" onclick="navigateTo('calendar')">
      <span class="dash-up-when"><b>${escapeHtml(when)}</b><small>${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</small></span>
      <span class="dash-up-body"><span class="dash-up-text">${escapeHtml(text.slice(0, 90)) || 'Picture post'}${text.length > 90 ? '…' : ''}</span>
      <span class="dash-up-plat">${(Array.isArray(p.platforms) ? p.platforms : []).map(dashPlat).join(' ')}</span></span></button>`;
  }).join('');
}

// 14 columns: published (solid) and planned (light) per day, and a per-platform split of the last 30 days
function renderDashActivity(posts, scheduled) {
  const bars = document.getElementById('dash-bars');
  const split = document.getElementById('dash-split');
  if (!bars) return;
  const today = dashDay(Date.now() / 1000);
  const days = Array.from({ length: 14 }, (_, i) => today - (13 - i) * DASH_DAY * 1000);
  const pub = new Map(days.map(d => [d, 0])), sch = new Map(days.map(d => [d, 0]));
  posts.filter(p => p.status !== 'failed').forEach(p => { const k = dashDay(p.created_at); if (pub.has(k)) pub.set(k, pub.get(k) + 1); });
  scheduled.forEach(p => { const k = dashDay(p.scheduled_at); if (sch.has(k)) sch.set(k, sch.get(k) + 1); });
  const max = Math.max(1, ...days.map(d => pub.get(d) + sch.get(d)));
  bars.innerHTML = days.map(d => {
    const a = pub.get(d), b = sch.get(d), dt = new Date(d);
    const label = `${dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${a} published, ${b} planned`;
    return `<div class="dash-bar ${d === today ? 'today' : ''}" title="${label}"><div class="dash-bar-stack"><i class="sch" style="height:${(b / max) * 100}%"></i><i class="pub" style="height:${(a / max) * 100}%"></i></div><span>${dt.getDate()}</span></div>`;
  }).join('');

  const since = Date.now() / 1000 - 30 * DASH_DAY;
  const per = {};
  posts.filter(p => p.status !== 'failed' && p.created_at >= since).forEach(p => (Array.isArray(p.platforms) ? p.platforms : []).forEach(k => { per[k] = (per[k] || 0) + 1; }));
  const rows = Object.entries(per).sort((x, y) => y[1] - x[1]).slice(0, 4);
  const top = rows[0]?.[1] || 1;
  split.innerHTML = rows.length ? rows.map(([k, n]) => `<div class="dash-split-row"><span class="dash-split-name">${dashPlat(k)} ${escapeHtml(PLATFORMS[k]?.label || k)}</span><span class="dash-split-track"><i style="width:${Math.max(6, (n / top) * 100)}%"></i></span><b>${n}</b></div>`).join('') : '<div class="dash-empty small">Posts you publish will show here by platform.</div>';
}

async function loadDashboardStats() {
  dashGreeting();
  const att = [];
  let posts = [], scheduled = [], ai = [], failed = [];
  try {
    [posts, scheduled, ai, failed] = await Promise.all([
      api('GET', '/api/posts/history?limit=200'),
      api('GET', '/api/posts/scheduled'),
      api('GET', '/api/history'),
      api('GET', '/api/posts/scheduled/failed').catch(() => []),
    ]);
  } catch { return; }

  const nowS = Date.now() / 1000;
  const ok = posts.filter(p => p.status !== 'failed');
  const last30 = ok.filter(p => p.created_at >= nowS - 30 * DASH_DAY).length;
  const prev30 = ok.filter(p => p.created_at < nowS - 30 * DASH_DAY && p.created_at >= nowS - 60 * DASH_DAY).length;
  setEl('stat-total-posts', last30);
  const trend = document.getElementById('stat-posts-trend');
  if (trend) {
    trend.className = 'dash-kpi-sub';
    if (prev30 > 0 || last30 > 0) {
      const diff = last30 - prev30;
      trend.textContent = prev30 ? (diff === 0 ? 'Same as the 30 days before' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than the 30 days before`) : `${ok.length} in total`;
      if (prev30 && diff !== 0) trend.classList.add(diff > 0 ? 'up' : 'down');
    } else trend.textContent = 'Nothing published yet';
  }

  setEl('stat-scheduled', scheduled.length);
  const next = scheduled.map(p => p.scheduled_at).filter(t => t && t * 1000 > Date.now()).sort((a, b) => a - b)[0];
  setEl('stat-next-post', next ? `Next: ${new Date(next * 1000).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Nothing planned');
  setEl('stat-ai-generated', ai.length);
  const aiMonth = ai.filter(h => h.created_at >= nowS - 30 * DASH_DAY).length;
  setEl('stat-ai-sub', aiMonth ? `${aiMonth} in the last 30 days` : 'None this month');

  renderDashUpcoming(scheduled);
  renderDashActivity(posts, scheduled);

  // What needs attention, most urgent first
  if (failed.length) att.push({ tone: 'bad', icon: '⚠️', title: `${failed.length} post${failed.length === 1 ? '' : 's'} didn’t go out`, hint: 'See why and try again', go: "navigateTo('history')" });
  const st = State.platformStatus || {};
  const fix = Object.entries(PLATFORMS).filter(([k, c]) => !c.hidden && (st[k]?.needs_reconnect || (st[k]?.connected && st[k].reconnect_in_days != null && st[k].reconnect_in_days <= 7))).map(([, c]) => c.label);
  if (fix.length) att.push({ tone: 'warn', icon: '🔑', title: `Sign in again: ${fix.slice(0, 2).join(', ')}${fix.length > 2 ? ` +${fix.length - 2}` : ''}`, hint: 'Posting stops when the login expires', go: "openSettings('platforms')" });
  const connected = Object.entries(PLATFORMS).filter(([k, c]) => !c.hidden && st[k]?.connected).length;
  // (no account connected is covered by the Get set up checklist above)
  if (connected && !scheduled.some(p => p.scheduled_at * 1000 > Date.now() && p.scheduled_at * 1000 < Date.now() + 7 * DASH_DAY * 1000)) att.push({ tone: 'info', icon: '📅', title: 'Nothing planned for the next 7 days', hint: 'Plan a few posts so your page stays active', go: "navigateTo('compose')" });

  try {
    const sb = await api('GET', '/api/sellbird/stats');
    const badge = document.getElementById('dash-sellbird-badge');
    if (sb) {
      if (sb.pending_approvals > 0) att.push({ tone: 'info', icon: '💼', title: `${sb.pending_approvals} sales email${sb.pending_approvals === 1 ? '' : 's'} to check`, hint: 'Approve them before they are sent', go: "navigateTo('sellbird')" });
      if (badge) {
        if (sb.pending_approvals > 0) { badge.textContent = `${sb.pending_approvals} to check`; badge.style.background = '#fef3c7'; badge.style.color = '#92400e'; }
        else badge.textContent = sb.active_campaigns ? `${sb.active_campaigns} campaign${sb.active_campaigns === 1 ? '' : 's'}` : '';
      }
    }
  } catch {}
  renderDashAttention(att);
  if (typeof renderSetupChecklist === 'function') renderSetupChecklist();
  setEl('dash-hello-sub', att.length ? `${att.length} thing${att.length === 1 ? '' : 's'} need${att.length === 1 ? 's' : ''} your attention.` : 'You’re all caught up.');
}

async function loadActivityFeed() {
  try {
    const posts = await api('GET', '/api/posts/history');
    const feed = document.getElementById('activity-feed');

    if (!posts.length) {
      feed.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">No activity yet</div>
        <div class="empty-desc">Your posts will appear here.</div>
      </div>`;
      return;
    }

    feed.innerHTML = posts.slice(0, 8).map(post => {
      const platforms = Array.isArray(post.platforms) ? post.platforms : [];
      const date = new Date(post.created_at * 1000);
      return `
        <div class="activity-item">
          <div class="activity-icon">📤</div>
          <div class="activity-text">
            <div class="activity-title">${escapeHtml(post.content.substring(0, 80))}${post.content.length > 80 ? '…' : ''}</div>
            <div class="activity-meta">${platforms.map(p => PLATFORMS[p]?.icon || p).join(' ')} ${platforms.join(', ')}</div>
          </div>
          <div class="activity-time">${timeAgo(date)}</div>
        </div>`;
    }).join('');
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Generate (Dashboard)
// ─────────────────────────────────────────────────────────────────────────────

function quickGenerate() {
  const prompt = document.getElementById('quick-prompt').value.trim();
  if (!prompt) return toast('Please enter a prompt', 'warning');
  if (!startNewCompose({ platforms: getSelectedPlatforms('quick-platforms') })) return;
  document.getElementById('compose-ai-prompt').value = prompt;
  document.getElementById('quick-prompt').value = '';
  composeAiWrite();
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Generate Page
// ─────────────────────────────────────────────────────────────────────────────

function selectTone(btn) {
  document.querySelectorAll('.tone-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  State.selectedTone = btn.dataset.tone;
}

async function generateContent() {
  const prompt = document.getElementById('gen-prompt').value.trim();
  if (!prompt) return toast('Please enter a prompt', 'warning');

  const btn = document.getElementById('btn-generate');
  const output = document.getElementById('gen-output');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Writing… (can take up to a minute)';
  output.innerHTML = '<div class="loading"><span class="spinner lg"></span></div>';
  output.classList.add('loading');

  try {
    const platforms  = getSelectedPlatforms('gen-platforms');
    const max_tokens = parseInt(document.getElementById('gen-max-tokens').value);
    const language   = document.getElementById('gen-language')?.value || 'en';

    const data = await api('POST', '/api/generate', {
      prompt,
      platforms,
      tone: State.selectedTone,
      max_tokens,
      type: 'social_post',
      model: ModelState.textModel?.id || null,
      language: language !== 'en' ? language : undefined,
    });

    State.generatedContent = data.content;
    State.generatedPlatforms = platforms;
    State.generatedVariants = data.variants || null;
    output.classList.remove('loading');
    if (data.variants) {
      // One card per platform, each sent to Compose with just that platform selected
      output.innerHTML = Object.entries(data.variants).map(([p, text]) => `
        <div class="card" style="margin-bottom:10px;padding:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <strong>${PLATFORMS[p]?.icon || ''} ${escapeHtml(PLATFORMS[p]?.label || p)}</strong>
            <span style="font-size:11px;color:var(--text-muted)">${text.length} chars</span>
          </div>
          <div style="white-space:pre-wrap;font-size:13px">${escapeHtml(text)}</div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(text)});toast('Copied!','success')">📋 Copy</button>
            <button class="btn btn-primary btn-sm" onclick="sendToCompose(${jsAttr(p)})">→ Compose</button>
          </div>
        </div>`).join('');
    } else {
      output.textContent = data.content;
    }

    updateCharCount('gen-char-count', data.content.length);
    document.getElementById('btn-copy').disabled = false;
    document.getElementById('btn-to-compose').disabled = false;
    document.getElementById('btn-regenerate').disabled = false;
    document.getElementById('btn-edit').disabled = false;
    document.getElementById('gen-actions').style.display = 'flex';

    toast('Content generated!', 'success');
  } catch (err) {
    output.classList.remove('loading');
    output.innerHTML = `<div style="color:#ef4444;padding:20px">${escapeHtml(err.message)}</div>`;
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✨ Generate Content';
  }
}

async function regenerateContent() {
  await generateContent();
}

function editGenerated() {
  const output = document.getElementById('gen-output');
  output.contentEditable = 'true';
  output.style.border = '1px solid var(--accent-purple)';
  output.focus();
  output.addEventListener('input', () => {
    State.generatedContent = output.textContent;
    updateCharCount('gen-char-count', State.generatedContent.length);
  }, { once: false });
  toast('Editing enabled — click outside to finish', 'info');
}

function copyGenerated() {
  if (!State.generatedContent) return;
  navigator.clipboard.writeText(State.generatedContent);
  toast('Copied to clipboard!', 'success');
}

// platform: send that platform's variant with only that platform selected.
// Otherwise send the text with the platforms that were chosen on AI Generate.
function sendToCompose(platform) {
  if (!State.generatedContent) return;
  const text = platform && State.generatedVariants?.[platform] ? State.generatedVariants[platform] : State.generatedContent;
  const wanted = platform ? [platform] : (State.generatedPlatforms || []);
  const targets = wanted.filter(p => !PLATFORMS[p]?.hidden);
  if (!startNewCompose({ text, platforms: targets })) return;
  const skipped = wanted.filter(p => PLATFORMS[p]?.hidden).map(p => PLATFORMS[p].label);
  if (skipped.length) toast(`Opened in Create Post. Posting to ${skipped.join(' and ')} isn’t available yet: copy the text and post it from that app.`, 'info', 8000);
  else toast('Opened in Create Post', 'success');
}

async function loadAIHistory() {
  const card = document.getElementById('ai-history-card');
  card.style.display = 'block';
  const list = document.getElementById('ai-history-list');
  list.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span></div>';

  try {
    const history = await api('GET', '/api/history');
    if (!history.length) {
      list.innerHTML = '<div class="empty-state" style="padding:20px 0"><div class="empty-desc">No generations yet</div></div>';
      return;
    }
    State.aiHistoryMap = State.aiHistoryMap || {};
    history.forEach(h => { State.aiHistoryMap[h.id] = h; });

    list.innerHTML = history.map(h => `
      <div class="history-item" style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:8px">
        <div class="history-prompt" style="font-weight:600;font-size:12px;color:var(--text-muted);margin-bottom:4px">"${escapeHtml(h.prompt.substring(0, 80))}${h.prompt.length > 80 ? '…' : ''}"</div>
        <div class="history-content" style="white-space:pre-wrap;margin-bottom:8px;max-height:150px;overflow-y:auto">${escapeHtml(h.response)}</div>
        <div class="history-tags" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="tag purple">${escapeHtml(h.model || 'post')}</span>
          <span class="tag">${h.tokens_used || '?'} tokens</span>
          <span class="tag">${new Date(h.created_at * 1000).toLocaleDateString()}</span>
          <button class="btn btn-primary btn-sm" onclick="useAIGenHistory(${h.id})" style="margin-left:auto">✏️ Use in Compose</button>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
  }
}

function closeAIHistory() {
  document.getElementById('ai-history-card').style.display = 'none';
}
