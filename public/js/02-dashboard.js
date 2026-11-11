// Social-Nexus app — Dashboard, quick generate and the AI Generate page.
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
  const all = Object.values(State.platformStatus);
  const count = all.filter(s => s?.connected).length;
  setEl('stat-platforms', `${count}/${all.length || Object.values(PLATFORMS).filter(p => !p.hidden).length}`);
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

async function loadDashboardStats() {
  try {
    const [posts, scheduled, aiHistory] = await Promise.all([
      api('GET', '/api/posts/history'),
      api('GET', '/api/posts/scheduled'),
      api('GET', '/api/history'),
    ]);
    // Count only posts that actually went out on at least one platform
    setEl('stat-total-posts', posts.filter(p => p.status !== 'failed').length);
    setEl('stat-scheduled', scheduled.length);
    const next = scheduled.map(p => p.scheduled_at).filter(t => t && t * 1000 > Date.now()).sort((a, b) => a - b)[0];
    setEl('stat-next-post', next ? `Next: ${new Date(next * 1000).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : '');
    setEl('stat-ai-generated', aiHistory.length);
  } catch {}

  // Gracefully update B2B Sales Agent badge if active campaigns exist
  try {
    const sbStats = await api('GET', '/api/sellbird/stats');
    const badge = document.getElementById('dash-sellbird-badge');
    if (badge && sbStats) {
      if (sbStats.pending_approvals > 0) {
        badge.textContent = `${sbStats.pending_approvals} to check`;
        badge.style.background = '#fef3c7';
        badge.style.color = '#92400e';
      } else {
        badge.textContent = sbStats.active_campaigns ? `${sbStats.active_campaigns} campaign${sbStats.active_campaigns === 1 ? "" : "s"}` : "";
      }
    }
  } catch {}
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
