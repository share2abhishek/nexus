/* ─────────────────────────────────────────────────────────────────────────────
   NEXUS — Frontend Application Script
   ───────────────────────────────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────────────────────────
const State = {
  currentPage: 'dashboard',
  platformStatus: {},
  selectedTone: 'professional',
  postMode: 'now',
  calendarDate: new Date(),
  scheduledPosts: [],
  generatedContent: '',
  selectedFileContent: '',
  anthropicKey: localStorage.getItem('nexus_api_key') || '',
  charts: {},
  // New module state
  editingCampaignId: null,
  lastMetaTags: null,
  lastGeneratedEmail: null,
  lastPressRelease: null,
  lastHashtags: null,
  lastUTMLink: null,
  lastImageBase64: null,
  lastImageUrl: null,
  lastCaption: null,
  selectedTemplate: null,
};

// ── Page Titles ───────────────────────────────────────────────────────────────
const PAGE_META = {
  dashboard: { title: 'Dashboard',              subtitle: 'Overview of your NEXUS platform' },
  generate:  { title: 'AI Generate',            subtitle: 'Generate content with AI' },
  compose:   { title: 'Compose & Post',         subtitle: 'Write and publish to all platforms' },
  calendar:  { title: 'Content Calendar',       subtitle: 'View and manage scheduled content' },
  history:   { title: 'Post History',           subtitle: 'Published posts and AI generations' },
  templates: { title: 'Content Templates',      subtitle: 'Save and reuse your best content' },
  files:     { title: 'Local Files',            subtitle: 'Browse your local content folder' },
  seo:       { title: 'SEO Tools',              subtitle: 'Meta tags, keywords, and content optimization' },
  aso:       { title: 'App Store Optimization', subtitle: 'Generate App Store & Play Store listings' },
  email:     { title: 'Email Marketing',        subtitle: 'Subscribers, campaigns, and AI email generation' },
  adcopy:    { title: 'Ad Copy & PR',           subtitle: 'Google Ads, Meta Ads, and press releases' },
  media:     { title: 'AI Media Creator',       subtitle: 'Generate images, videos, and animations with AI' },
  hashtags:  { title: 'Hashtag Research',       subtitle: 'AI-powered hashtag suggestions' },
  utm:       { title: 'UTM Link Builder',       subtitle: 'Build trackable campaign URLs' },
  brand:     { title: 'Brand Kit',              subtitle: 'Define your brand identity for consistent content' },
  analytics:         { title: 'Analytics',          subtitle: 'Performance metrics across platforms' },
  'user-settings':   { title: 'My API Keys',        subtitle: 'Your personal API key configuration' },
  'tools-directory': { title: 'AI Tools Directory', subtitle: 'Top free and paid AI tools by category' },
  admin:             { title: 'Admin Dashboard',     subtitle: 'Monitor users, access, and platform health' },
  settings:          { title: 'Settings',            subtitle: 'Configure connections and preferences' },
};

// ── Platform Config ───────────────────────────────────────────────────────────
const PLATFORMS = {
  linkedin:        { label: 'LinkedIn',         icon: '🔵', class: 'linkedin'        },
  facebook:        { label: 'Facebook',         icon: '📘', class: 'facebook'        },
  instagram:       { label: 'Instagram',        icon: '📸', class: 'instagram'       },
  pinterest:       { label: 'Pinterest',        icon: '📌', class: 'pinterest'       },
  twitter:         { label: 'Twitter/X',        icon: '🐦', class: 'twitter'         },
  youtube:         { label: 'YouTube',          icon: '▶️', class: 'youtube'         },
  google_business: { label: 'Google Business',  icon: '🏢', class: 'google_business' },
  tiktok:          { label: 'TikTok',           icon: '🎵', class: 'tiktok'          },
};

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

function navigateTo(page) {
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${page}`);
  if (navEl) navEl.classList.add('active');

  // Update pages
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  // Update header
  const meta = PAGE_META[page] || {};
  document.getElementById('header-title').textContent = meta.title || page;
  document.getElementById('header-subtitle').textContent = meta.subtitle || '';

  State.currentPage = page;

  // Page-specific load hooks
  const hooks = {
    dashboard: loadDashboard,
    calendar:  () => renderCalendar(State.calendarDate),
    history:   loadHistory,
    analytics: loadAnalytics,
    files:     loadLocalFiles,
    compose:   loadScheduled,
    templates: loadTemplates,
    utm:       loadUTMLinks,
    email:            loadEmailPage,
    brand:            loadBrandKit,
    seo:              loadTrackedKeywords,
    settings:         loadSettings,
    generate:         loadModels,
    media:            loadModels,
    'user-settings':   loadUserSettings,
    'tools-directory': renderToolsDirectory,
  admin:             loadAdminDashboard,
    'admin':           loadAdminDashboard,
  };

  if (hooks[page]) hooks[page]();
}

// Attach nav click handlers
document.querySelectorAll('.nav-item[data-page]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(el.dataset.page);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (State.anthropicKey) opts.headers['x-api-key'] = State.anthropicKey;
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) { window.location.href = '/login.html'; return; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast Notifications
// ─────────────────────────────────────────────────────────────────────────────

function toast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform Selector Toggles
// ─────────────────────────────────────────────────────────────────────────────

function initPlatformSelectors() {
  document.querySelectorAll('.platform-selector').forEach(container => {
    container.querySelectorAll('.platform-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('selected');
      });
    });
  });
}

function getSelectedPlatforms(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .platform-toggle.selected`))
    .map(el => el.dataset.platform);
}

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
  container.innerHTML = Object.entries(PLATFORMS).map(([key, cfg]) => {
    const status = State.platformStatus[key];
    const connected = status?.connected;
    const name = status?.profile?.name || cfg.label;
    return `
      <div class="platform-card ${connected ? 'connected' : ''}" onclick="navigateTo('settings')">
        <div class="platform-icon ${cfg.class}">${cfg.icon}</div>
        <div class="platform-info">
          <div class="platform-name">${cfg.label}</div>
          <div class="platform-status ${connected ? 'connected' : 'disconnected'}">
            ${connected ? `✓ ${name.split(' ')[0]}` : 'Not connected'}
          </div>
        </div>
      </div>`;
  }).join('');
}

function updateStatPlatforms() {
  const count = Object.values(State.platformStatus).filter(s => s?.connected).length;
  setEl('stat-platforms', `${count}/5`);
}

function updateSettingsBadges() {
  Object.keys(PLATFORMS).forEach(platform => {
    const status = State.platformStatus[platform];
    const row = document.getElementById(`setting-${platform === 'instagram' ? 'facebook' : platform}`);
    if (!row) return;
    const connected = status?.connected;
    // Visual indicator could be added here
  });
}

async function loadDashboard() {
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
    setEl('stat-total-posts', posts.length);
    setEl('stat-scheduled', scheduled.length);
    setEl('stat-ai-generated', aiHistory.length);
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

async function quickGenerate() {
  const prompt = document.getElementById('quick-prompt').value.trim();
  if (!prompt) return toast('Please enter a prompt', 'warning');

  const btn = document.getElementById('btn-quick-generate');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating…';

  try {
    const platforms = getSelectedPlatforms('quick-platforms');
    const data = await api('POST', '/api/generate', { prompt, platforms, tone: 'professional', max_tokens: 512 });
    // Send to compose tab
    document.getElementById('compose-content').value = data.content;
    navigateTo('compose');
    toast('Content generated! Review and post.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✨ Generate & Compose';
  }
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
  btn.innerHTML = '<span class="spinner"></span> Generating…';
  output.innerHTML = '<div class="loading"><span class="spinner lg"></span></div>';
  output.classList.add('loading');

  try {
    const platforms  = getSelectedPlatforms('gen-platforms');
    const max_tokens = parseInt(document.getElementById('gen-max-tokens').value);

    const data = await api('POST', '/api/generate', {
      prompt,
      platforms,
      tone: State.selectedTone,
      max_tokens,
      type: 'social_post',
      model: ModelState.textModel?.id || null,
    });

    State.generatedContent = data.content;
    output.classList.remove('loading');
    output.textContent = data.content;

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

function sendToCompose() {
  if (!State.generatedContent) return;
  document.getElementById('compose-content').value = State.generatedContent;
  navigateTo('compose');
  updateComposeCharCount();
  toast('Sent to Compose tab', 'success');
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
    list.innerHTML = history.map(h => `
      <div class="history-item">
        <div class="history-prompt">"${escapeHtml(h.prompt.substring(0, 80))}${h.prompt.length > 80 ? '…' : ''}"</div>
        <div class="history-content">${escapeHtml(h.response)}</div>
        <div class="history-tags">
          <span class="tag purple">${h.type || 'post'}</span>
          <span class="tag">${h.tokens_used || '?'} tokens</span>
          <span class="tag">${new Date(h.created_at * 1000).toLocaleDateString()}</span>
          <button class="btn btn-secondary btn-sm" onclick="reuseGeneration(${h.id})" style="margin-left:auto" data-content="${escapeHtml(h.response)}">Reuse</button>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${err.message}</div>`;
  }
}

function closeAIHistory() {
  document.getElementById('ai-history-card').style.display = 'none';
}

function reuseGeneration(id) {
  const btn = document.querySelector(`[data-content]`);
  const content = btn?.dataset?.content;
  if (content) {
    State.generatedContent = content;
    document.getElementById('gen-output').textContent = content;
    document.getElementById('btn-copy').disabled = false;
    document.getElementById('btn-to-compose').disabled = false;
    document.getElementById('btn-regenerate').disabled = false;
    document.getElementById('btn-edit').disabled = false;
    document.getElementById('gen-actions').style.display = 'flex';
    updateCharCount('gen-char-count', content.length);
    closeAIHistory();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compose & Post
// ─────────────────────────────────────────────────────────────────────────────

function updateComposeCharCount() {
  const content = document.getElementById('compose-content').value;
  updateCharCount('compose-char-count', content.length);
}

function setPostMode(mode) {
  State.postMode = mode;
  const now = document.getElementById('post-mode-now');
  const sched = document.getElementById('post-mode-schedule');
  const picker = document.getElementById('schedule-picker');
  const submitBtn = document.getElementById('btn-submit-post');

  if (mode === 'now') {
    now.classList.add('btn-primary');   now.classList.remove('btn-secondary');
    sched.classList.add('btn-secondary'); sched.classList.remove('btn-primary');
    picker.style.display = 'none';
    submitBtn.textContent = '📤 Post Now';
  } else {
    sched.classList.add('btn-primary');   sched.classList.remove('btn-secondary');
    now.classList.add('btn-secondary');   now.classList.remove('btn-primary');
    picker.style.display = 'block';
    submitBtn.textContent = '📅 Schedule Post';

    // Default: 1 hour from now
    const dt = new Date(Date.now() + 3600000);
    document.getElementById('compose-schedule-at').value = dt.toISOString().slice(0, 16);
  }
}

async function submitPost() {
  const content = document.getElementById('compose-content').value.trim();
  if (!content) return toast('Please enter post content', 'warning');

  const platforms = getSelectedPlatforms('compose-platforms');
  if (!platforms.length) return toast('Please select at least one platform', 'warning');

  const image_url = document.getElementById('compose-image').value.trim() || null;
  const btn = document.getElementById('btn-submit-post');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Posting…';

  try {
    if (State.postMode === 'now') {
      const data = await api('POST', '/api/post/now', { content, platforms, image_url });
      const successes = data.results.filter(r => r.success).map(r => r.platform);
      const failures  = data.results.filter(r => !r.success).map(r => `${r.platform}: ${r.error}`);

      if (successes.length) toast(`Posted to: ${successes.join(', ')}`, 'success');
      failures.forEach(f => toast(f, 'error'));

      if (successes.length) {
        document.getElementById('compose-content').value = '';
        document.getElementById('compose-image').value = '';
      }
    } else {
      const scheduled_at = document.getElementById('compose-schedule-at').value;
      if (!scheduled_at) return toast('Please pick a schedule time', 'warning');
      const data = await api('POST', '/api/post/schedule', { content, platforms, image_url, scheduled_at });
      toast(`Scheduled for ${new Date(data.scheduled_at).toLocaleString()}`, 'success');
      loadScheduled();
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = State.postMode === 'now' ? '📤 Post Now' : '📅 Schedule Post';
  }
}

async function loadScheduled() {
  try {
    const posts = await api('GET', '/api/posts/scheduled');
    State.scheduledPosts = posts;
    renderScheduledList(posts);
  } catch {}
}

function renderScheduledList(posts) {
  const list = document.getElementById('scheduled-list');
  if (!posts.length) {
    list.innerHTML = `<div class="empty-state" style="padding:30px 0">
      <div class="empty-icon">📅</div>
      <div class="empty-title">No scheduled posts</div>
      <div class="empty-desc">Schedule a post to see it here.</div>
    </div>`;
    return;
  }

  list.innerHTML = posts.map(post => {
    const dt = new Date(post.scheduled_at * 1000);
    const platforms = Array.isArray(post.platforms) ? post.platforms : [];
    return `
      <div class="scheduled-item">
        <div class="scheduled-time">
          <div class="scheduled-time-date">${dt.toLocaleDateString('en', {month:'short', day:'numeric'})}</div>
          <div class="scheduled-time-hour">${dt.toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'})}</div>
        </div>
        <div class="scheduled-content">
          <div class="scheduled-text">${escapeHtml(post.content.substring(0, 120))}${post.content.length > 120 ? '…' : ''}</div>
          <div class="scheduled-platforms">
            ${platforms.map(p => `<span class="scheduled-platform-tag">${PLATFORMS[p]?.icon || ''} ${p}</span>`).join('')}
          </div>
        </div>
        <button class="btn btn-danger btn-sm btn-icon" onclick="cancelScheduled(${post.id})" title="Cancel">🗑</button>
      </div>`;
  }).join('');
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

// ─────────────────────────────────────────────────────────────────────────────
// Content Calendar
// ─────────────────────────────────────────────────────────────────────────────

function changeMonth(dir) {
  State.calendarDate = new Date(State.calendarDate.getFullYear(), State.calendarDate.getMonth() + dir, 1);
  renderCalendar(State.calendarDate);
}

async function renderCalendar(date) {
  const label = document.getElementById('calendar-month-label');
  label.textContent = date.toLocaleDateString('en', { month: 'long', year: 'numeric' });

  let posts = State.scheduledPosts;
  if (!posts.length) {
    try { posts = await api('GET', '/api/posts/scheduled'); State.scheduledPosts = posts; } catch {}
  }

  const grid = document.getElementById('calendar-grid');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  let html = days.map(d => `<div class="calendar-day-label">${d}</div>`).join('');

  // Previous month filler
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="calendar-day other-month"><div class="calendar-day-num">${daysInPrevMonth - i}</div></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dayDate = new Date(year, month, d);
    const isToday = dayDate.toDateString() === today.toDateString();
    const dayPosts = posts.filter(p => {
      const pd = new Date(p.scheduled_at * 1000);
      return pd.getFullYear() === year && pd.getMonth() === month && pd.getDate() === d;
    });

    html += `<div class="calendar-day ${isToday ? 'today' : ''}">
      <div class="calendar-day-num">${d}</div>
      ${dayPosts.map(p => `<div class="calendar-event" title="${escapeHtml(p.content)}">${escapeHtml(p.content.substring(0, 20))}</div>`).join('')}
    </div>`;
  }

  grid.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────────────────────────

async function loadHistory() {
  await Promise.all([loadPostHistory(), loadAIGenHistory()]);
}

async function loadPostHistory() {
  const list = document.getElementById('post-history-list');
  try {
    const posts = await api('GET', '/api/posts/history');
    if (!posts.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">📭</div><div class="empty-title">No posts yet</div></div>';
      return;
    }
    list.innerHTML = posts.map(post => {
      const platforms = Array.isArray(post.platforms) ? post.platforms : [];
      const date = new Date(post.created_at * 1000);
      return `
        <div class="history-item">
          <div class="history-content">${escapeHtml(post.content)}</div>
          <div class="history-tags">
            ${platforms.map(p => `<span class="tag purple">${PLATFORMS[p]?.icon || ''} ${p}</span>`).join('')}
            <span class="tag">${date.toLocaleDateString()}</span>
            <span class="badge badge-${post.status === 'published' ? 'green' : 'orange'}" style="margin-left:auto">${post.status}</span>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${err.message}</div>`;
  }
}

async function loadAIGenHistory() {
  const list = document.getElementById('ai-gen-history-list');
  try {
    const history = await api('GET', '/api/history');
    if (!history.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">✨</div><div class="empty-title">No generations yet</div></div>';
      return;
    }
    list.innerHTML = history.map(h => `
      <div class="history-item">
        <div class="history-prompt">"${escapeHtml(h.prompt.substring(0, 80))}…"</div>
        <div class="history-content">${escapeHtml(h.response)}</div>
        <div class="history-tags">
          <span class="tag blue">${h.model || 'claude'}</span>
          <span class="tag">${h.tokens_used || '?'} tokens</span>
          <span class="tag">${new Date(h.created_at * 1000).toLocaleDateString()}</span>
          <button class="btn btn-secondary btn-sm" onclick="useHistoryContent('${encodeURIComponent(h.response)}')" style="margin-left:auto">Use</button>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${err.message}</div>`;
  }
}

function useHistoryContent(encoded) {
  const content = decodeURIComponent(encoded);
  document.getElementById('compose-content').value = content;
  navigateTo('compose');
  updateComposeCharCount();
  toast('Content loaded into Compose', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// Local Files
// ─────────────────────────────────────────────────────────────────────────────

async function loadLocalFiles(targetListId = 'local-files-list') {
  const list = document.getElementById(targetListId);
  list.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span></div>';

  try {
    const files = await api('GET', '/api/local/files');
    if (!files.length) {
      list.innerHTML = '<div class="empty-state" style="padding:20px 0"><div class="empty-icon">📂</div><div class="empty-title">No files found</div><div class="empty-desc">Add .txt, .md, .csv, or .json files to your CONTENT_FOLDER.</div></div>';
      return;
    }

    list.innerHTML = files.map(f => {
      const ext = f.ext.replace('.', '');
      const size = formatBytes(f.size);
      return `<div class="file-item" onclick="previewFile('${escapeHtml(f.name)}', '${targetListId}')">
        <span class="file-ext-badge ${ext}">${ext}</span>
        <span class="file-name">${escapeHtml(f.name)}</span>
        <span class="file-size">${size}</span>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${err.message}</div>`;
  }
}

async function previewFile(name, sourceList) {
  if (sourceList === 'modal-file-list') {
    // In modal — import directly
    await importFileToCompose(name);
    return;
  }

  const titleEl = document.getElementById('file-preview-title');
  const contentEl = document.getElementById('file-preview-content');
  const actionsEl = document.getElementById('file-preview-actions');
  titleEl.textContent = `📄 ${name}`;
  contentEl.textContent = 'Loading…';

  try {
    const data = await api('GET', `/api/local/read?file=${encodeURIComponent(name)}`);
    if (data.type === 'image') {
      contentEl.innerHTML = `<img src="/api/local/read?file=${encodeURIComponent(name)}" style="max-width:100%;border-radius:8px" />`;
    } else {
      State.selectedFileContent = data.content;
      contentEl.textContent = data.content;
      actionsEl.style.display = 'block';
    }
  } catch (err) {
    contentEl.textContent = 'Error: ' + err.message;
  }
}

function useFileAsContent() {
  if (!State.selectedFileContent) return;
  document.getElementById('compose-content').value = State.selectedFileContent;
  navigateTo('compose');
  updateComposeCharCount();
  toast('File content loaded into Compose', 'success');
}

function openFileBrowser() {
  document.getElementById('file-browser-modal').style.display = 'flex';
  loadLocalFiles('modal-file-list');
}

function closeFileBrowserModal(e) {
  if (!e || e.target === document.getElementById('file-browser-modal')) {
    document.getElementById('file-browser-modal').style.display = 'none';
  }
}

async function importFileToCompose(name) {
  try {
    const data = await api('GET', `/api/local/read?file=${encodeURIComponent(name)}`);
    if (data.content) {
      document.getElementById('compose-content').value = data.content;
      updateComposeCharCount();
      closeFileBrowserModal();
      navigateTo('compose');
      toast(`Imported: ${name}`, 'success');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function importCSV() {
  const file = prompt('Enter CSV filename (in your CONTENT_FOLDER):', 'schedule.csv');
  if (!file) return;

  try {
    const data = await api('POST', `/api/local/import-csv?file=${encodeURIComponent(file)}`);
    toast(`Imported ${data.imported} posts from ${file}`, 'success');
    loadScheduled();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

async function loadAnalytics() {
  try {
    const data = await api('GET', '/api/analytics');
    renderAnalyticsSummary(data.summary);
    renderAnalyticsCharts(data.summary);
    renderAnalyticsTable(data.summary);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderAnalyticsSummary(summary) {
  const totals = summary.reduce((acc, row) => ({
    likes:       acc.likes       + (row.total_likes       || 0),
    comments:    acc.comments    + (row.total_comments    || 0),
    shares:      acc.shares      + (row.total_shares      || 0),
    impressions: acc.impressions + (row.total_impressions || 0),
  }), { likes: 0, comments: 0, shares: 0, impressions: 0 });

  setEl('ana-likes',       totals.likes.toLocaleString());
  setEl('ana-comments',    totals.comments.toLocaleString());
  setEl('ana-shares',      totals.shares.toLocaleString());
  setEl('ana-impressions', totals.impressions.toLocaleString());
}

function renderAnalyticsCharts(summary) {
  const platformColors = {
    linkedin:  '#0a66c2', facebook: '#1877f2', instagram: '#e1306c',
    pinterest: '#e60023', twitter:  '#1d9bf0',
  };

  const labels = summary.map(s => s.platform);
  const colors = labels.map(p => platformColors[p] || '#7c3aed');

  // Impressions Bar Chart
  const impressCtx = document.getElementById('chart-impressions').getContext('2d');
  if (State.charts.impressions) State.charts.impressions.destroy();
  State.charts.impressions = new Chart(impressCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Impressions',
        data: summary.map(s => s.total_impressions || 0),
        backgroundColor: colors.map(c => c + '99'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 6,
      }],
    },
    options: chartOptions('Impressions'),
  });

  // Engagement Doughnut Chart
  const engCtx = document.getElementById('chart-engagement').getContext('2d');
  if (State.charts.engagement) State.charts.engagement.destroy();
  State.charts.engagement = new Chart(engCtx, {
    type: 'doughnut',
    data: {
      labels: ['Likes', 'Comments', 'Shares', 'Clicks'],
      datasets: [{
        data: [
          summary.reduce((a, s) => a + (s.total_likes || 0), 0),
          summary.reduce((a, s) => a + (s.total_comments || 0), 0),
          summary.reduce((a, s) => a + (s.total_shares || 0), 0),
          summary.reduce((a, s) => a + (s.total_clicks || 0), 0),
        ],
        backgroundColor: ['#7c3aed', '#3b82f6', '#06b6d4', '#10b981'],
        borderWidth: 0,
      }],
    },
    options: {
      ...chartOptions(),
      cutout: '65%',
    },
  });
}

function chartOptions(title) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } },
      },
      title: title ? {
        display: false,
      } : undefined,
    },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
    },
  };
}

function renderAnalyticsTable(summary) {
  const tbody = document.getElementById('analytics-table-body');
  if (!summary.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">No data yet. Click "Simulate Data" to generate sample analytics.</td></tr>';
    return;
  }

  const platformIcons = { linkedin: '🔵', facebook: '📘', instagram: '📸', pinterest: '📌', twitter: '🐦' };

  tbody.innerHTML = summary.map(row => `
    <tr>
      <td>${platformIcons[row.platform] || ''} ${row.platform}</td>
      <td>${row.post_count}</td>
      <td>${(row.total_likes || 0).toLocaleString()}</td>
      <td>${(row.total_comments || 0).toLocaleString()}</td>
      <td>${(row.total_shares || 0).toLocaleString()}</td>
      <td>${(row.total_impressions || 0).toLocaleString()}</td>
      <td>${(row.total_clicks || 0).toLocaleString()}</td>
    </tr>`).join('');
}

async function simulateAnalytics() {
  try {
    await api('POST', '/api/analytics/simulate');
    toast('Analytics data simulated!', 'success');
    loadAnalytics();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

function switchSettingsTab(tab, btn) {
  document.querySelectorAll('.settings-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`settings-panel-${tab}`).style.display = '';
  document.querySelectorAll('.settings-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
}

async function loadSettings() {
  try {
    const platforms = await api('GET', '/api/config/platforms');
    renderPlatformCards(platforms);
  } catch (err) {
    document.getElementById('platform-cards-container').innerHTML =
      `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
  }
  checkOllamaStatus();
  loadContentFolderSetting();
}

function renderPlatformCards(platforms) {
  const ORDER = ['linkedin','facebook','instagram','pinterest','twitter','youtube','google_business','tiktok'];
  const container = document.getElementById('platform-cards-container');

  container.innerHTML = ORDER.map(key => {
    const p = platforms[key];
    if (!p) return '';

    const isConnected = p.connected;
    const isConfigured = p.configured;
    const profileName = p.profile?.name || p.profile?.id || '';
    const profilePic  = p.profile?.picture || null;
    const since       = p.since ? new Date(p.since * 1000).toLocaleDateString() : null;

    const statusBadge = isConnected
      ? `<span class="badge badge-green" style="font-size:11px">● Connected</span>`
      : isConfigured
        ? `<span class="badge badge-orange" style="font-size:11px">● Ready to Connect</span>`
        : `<span class="badge badge-red" style="font-size:11px">● Credentials Needed</span>`;

    const profileHtml = isConnected ? `
      <div style="display:flex;align-items:center;gap:10px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:10px 14px;margin-bottom:12px">
        ${profilePic ? `<img src="${escapeHtml(profilePic)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover" />` : `<div style="width:36px;height:36px;border-radius:50%;background:${escapeHtml(p.color)};display:flex;align-items:center;justify-content:center;font-size:18px">${p.icon}</div>`}
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(profileName)}</div>
          ${since ? `<div style="font-size:11px;color:var(--text-muted)">Connected ${since}</div>` : ''}
          ${p.page_id ? `<div style="font-size:11px;color:var(--text-muted)">Page ID: ${escapeHtml(p.page_id)}</div>` : ''}
          ${p.ig_account_id ? `<div style="font-size:11px;color:#e1306c">Instagram: ${escapeHtml(p.ig_account_id)}</div>` : ''}
          ${p.channel_id ? `<div style="font-size:11px;color:#ff0000">Channel: ${escapeHtml(p.channel_id)}</div>` : ''}
          ${p.board_id ? `<div style="font-size:11px;color:#e60023">Board: ${escapeHtml(p.board_id)}</div>` : ''}
        </div>
      </div>` : '';

    const credentialsHtml = p.credentials?.length ? `
      <details style="margin-bottom:12px" ${!isConfigured ? 'open' : ''}>
        <summary style="font-size:12px;font-weight:600;color:var(--text-secondary);cursor:pointer;padding:4px 0">
          🔑 API Credentials ${isConfigured ? '<span class="badge badge-green" style="font-size:10px">Saved</span>' : '<span class="badge badge-orange" style="font-size:10px">Required</span>'}
        </summary>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
          ${p.credentials.map(c => `
            <div>
              <label style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">${escapeHtml(c.label)}</label>
              <div style="display:flex;gap:6px;margin-top:4px">
                <input type="${c.type === 'password' ? 'password' : 'text'}"
                  class="form-input" id="cred-${key}-${c.key}"
                  value="${escapeHtml(c.value)}"
                  placeholder="${c.readonly ? '' : `Enter ${escapeHtml(c.label)}…`}"
                  ${c.readonly ? 'readonly style="opacity:0.6;cursor:default"' : ''}
                  style="flex:1;font-size:13px" />
                ${c.type === 'password' && c.value ? `<button class="btn btn-secondary btn-sm btn-icon" onclick="togglePasswordVisibility('cred-${key}-${c.key}')" title="Show/hide">👁</button>` : ''}
              </div>
            </div>`).join('')}
          <button class="btn btn-primary btn-sm" onclick="savePlatformCredentials('${key}')" style="align-self:flex-start;margin-top:4px">
            💾 Save Credentials
          </button>
          ${p.setup_url ? `<a href="${escapeHtml(p.setup_url)}" target="_blank" class="btn btn-secondary btn-sm" style="align-self:flex-start">🔗 Get Credentials</a>` : ''}
          ${p.scopes ? `<div style="font-size:11px;color:var(--text-muted)">Required scopes: <code>${escapeHtml(p.scopes)}</code></div>` : ''}
        </div>
      </details>` : '';

    const noteHtml = p.note ? `<div style="font-size:11px;color:var(--text-muted);background:rgba(255,255,255,0.03);border-radius:6px;padding:8px;margin-bottom:10px">💡 ${escapeHtml(p.note)}</div>` : '';

    const manualTokenHtml = !isConnected && isConfigured ? `
      <details style="margin-top:8px">
        <summary style="font-size:12px;color:var(--accent-blue);cursor:pointer;padding:4px 0">🔑 Paste token manually (if OAuth fails)</summary>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:11px;color:var(--text-muted)">Get a token from <a href="https://developers.facebook.com/tools/explorer" target="_blank" style="color:#60a5fa">Graph API Explorer</a> → select your app → Generate Access Token → copy it here</div>
          <input type="text" class="form-input" id="manual-token-${key}" placeholder="Paste your access token here…" style="font-size:12px;font-family:monospace" />
          <button class="btn btn-primary btn-sm" onclick="saveManualToken('${key}')" style="align-self:flex-start">✅ Connect with Token</button>
        </div>
      </details>` : '';

    const subConfigHtml = isConnected && key === 'facebook' ? `
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="loadFBPages('${key}')">📄 Select Facebook Page</button>
      </div>
      <div id="fb-page-selector" style="display:none;margin-top:8px"></div>` : '';

    const pinterestConfigHtml = isConnected && key === 'pinterest' ? `
      <div style="margin-top:8px;display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="loadPinterestBoards()">📌 Select Board</button>
      </div>
      <div id="pinterest-board-selector" style="display:none;margin-top:8px"></div>` : '';

    const connectBtn = isConnected
      ? `<button class="btn btn-danger btn-sm" onclick="disconnect('${key}')">Disconnect</button>`
      : `<a href="${escapeHtml(p.oauth_url)}" class="btn btn-${isConfigured ? 'primary' : 'secondary'} btn-sm" ${!isConfigured ? 'title="Save credentials first"' : ''}>Connect</a>`;

    return `
      <div class="platform-config-card" id="pcard-${key}" style="border-left:3px solid ${p.color}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:40px;height:40px;border-radius:10px;background:${p.color}22;display:flex;align-items:center;justify-content:center;font-size:20px;border:1px solid ${p.color}44">${p.icon}</div>
            <div>
              <div style="font-size:15px;font-weight:700;color:var(--text-primary)">${p.label}</div>
              <div>${statusBadge}</div>
            </div>
          </div>
          <div>${connectBtn}</div>
        </div>
        ${profileHtml}
        ${noteHtml}
        ${credentialsHtml}
        ${manualTokenHtml}
        ${subConfigHtml}
        ${pinterestConfigHtml}
      </div>`;
  }).join('');
}

async function saveManualToken(platform) {
  const input = document.getElementById(`manual-token-${platform}`);
  const token = input?.value.trim();
  if (!token) return toast('Please paste your access token first', 'warning');

  const btn = input.nextElementSibling;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Connecting…';

  try {
    const result = await api('POST', `/auth/manual-token/${platform}`, { access_token: token });
    toast(`${platform} connected! ${result.instagram_detected ? '+ Instagram detected ✅' : '✅'}`, 'success');
    input.value = '';
    await refreshStatus();
    loadSettings();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✅ Connect with Token';
  }
}

async function savePlatformCredentials(platform) {
  const panel = document.querySelector(`#pcard-${platform}`);
  if (!panel) return;
  const body = {};
  panel.querySelectorAll('input[id^="cred-"]').forEach(input => {
    const key = input.id.replace(`cred-${platform}-`, '');
    const val = input.value.trim();
    if (val && !input.readOnly) body[key] = val;
  });
  try {
    await api('POST', `/api/config/platforms/${platform}`, body);
    toast(`${platform} credentials saved! ✅`, 'success');
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

function togglePasswordVisibility(inputId) {
  const el = document.getElementById(inputId);
  if (el) el.type = el.type === 'password' ? 'text' : 'password';
}

async function loadFBPages() {
  const container = document.getElementById('fb-page-selector');
  container.style.display = 'block';
  container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)"><span class="spinner"></span> Loading pages…</div>';
  try {
    const pages = await api('GET', '/api/config/facebook/pages');
    if (!pages.length) { container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No pages found. Make sure your Facebook Page is connected to your account.</div>'; return; }
    container.innerHTML = `<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Select a page to post from:</div>
      <div style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto">
        ${pages.map(pg => `
          <button class="btn btn-secondary btn-sm" onclick="setFBPage('${escapeHtml(pg.id)}','${escapeHtml(pg.name)}','${escapeHtml(pg.access_token)}')" style="justify-content:flex-start;text-align:left">
            📄 ${escapeHtml(pg.name)} <span style="font-size:10px;color:var(--text-muted);margin-left:auto">${escapeHtml(pg.id)}</span>
          </button>`).join('')}
      </div>`;
  } catch (err) { container.innerHTML = `<div style="color:#ef4444;font-size:12px">${escapeHtml(err.message)}</div>`; }
}

async function setFBPage(id, name, token) {
  try {
    const result = await api('POST', '/api/config/facebook/set-page', { page_id: id, page_name: name, page_token: token });
    const msg = result.instagram_detected ? `Page set! Instagram Business account also detected. ✅` : `Page "${name}" set as default. ✅`;
    toast(msg, 'success');
    document.getElementById('fb-page-selector').style.display = 'none';
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadPinterestBoards() {
  const container = document.getElementById('pinterest-board-selector');
  container.style.display = 'block';
  container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)"><span class="spinner"></span> Loading boards…</div>';
  try {
    const boards = await api('GET', '/api/config/pinterest/boards');
    if (!boards.length) { container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No boards found.</div>'; return; }
    container.innerHTML = `<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px">Select a board:</div>
      <div style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto">
        ${boards.map(b => `
          <button class="btn btn-secondary btn-sm" onclick="setPinterestBoard('${escapeHtml(b.id)}','${escapeHtml(b.name)}')" style="justify-content:flex-start">
            📌 ${escapeHtml(b.name)}
          </button>`).join('')}
      </div>`;
  } catch (err) { container.innerHTML = `<div style="color:#ef4444;font-size:12px">${escapeHtml(err.message)}</div>`; }
}

async function setPinterestBoard(id, name) {
  try {
    await api('POST', '/api/config/pinterest/set-board', { board_id: id, board_name: name });
    toast(`Board "${name}" set as default. ✅`, 'success');
    document.getElementById('pinterest-board-selector').style.display = 'none';
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

function saveApiKey() {
  const key = document.getElementById('setting-anthropic-key').value.trim();
  if (!key) return toast('Please enter a Google Gemini API key', 'warning');
  State.anthropicKey = key;
  localStorage.setItem('nexus_api_key', key);
  api('POST', '/api/config/ai-keys', { GOOGLE_AI_KEY: key }).catch(() => {});
  toast('✅ Google Gemini API key saved!', 'success');
}

function saveClaudeKey() {
  const key = document.getElementById('setting-claude-key').value.trim();
  if (!key) return toast('Please enter an Anthropic API key', 'warning');
  localStorage.setItem('nexus_claude_key', key);
  api('POST', '/api/config/ai-keys', { ANTHROPIC_API_KEY: key }).catch(() => {});
  toast('✅ Anthropic API key saved!', 'success');
}

async function saveMediaKey(envKey, inputId) {
  const val = document.getElementById(inputId)?.value.trim();
  if (!val) return toast('Please enter a key', 'warning');
  try {
    const body = {}; body[envKey] = val;
    await api('POST', '/api/config/ai-keys', body);
    toast('✅ Key saved!', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function saveContentFolder() {
  const folder = document.getElementById('setting-content-folder')?.value.trim();
  if (!folder) return toast('Please enter a folder path', 'warning');
  try {
    await api('POST', '/api/config/content-folder', { folder });
    toast(`✅ Content folder set to: ${folder}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function loadContentFolderSetting() {
  try {
    const data = await api('GET', '/api/config/content-folder');
    const el = document.getElementById('setting-content-folder');
    if (el) el.value = data.folder || 'D:/social';
  } catch {}
}

async function saveSMTPSettings() {
  try {
    await api('POST', '/api/config/smtp', {
      SMTP_HOST: document.getElementById('smtp-host').value.trim(),
      SMTP_PORT: document.getElementById('smtp-port').value.trim(),
      SMTP_USER: document.getElementById('smtp-user').value.trim(),
      SMTP_PASS: document.getElementById('smtp-pass').value.trim(),
      SMTP_FROM: document.getElementById('smtp-from').value.trim(),
      SMTP_FROM_NAME: document.getElementById('smtp-from-name').value.trim(),
    });
    toast('✅ SMTP settings saved!', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function disconnect(platform) {
  if (!confirm(`Disconnect ${platform}?`)) return;
  try {
    await api('POST', `/auth/disconnect/${platform}`);
    toast(`${platform} disconnected`, 'info');
    await refreshStatus();
    renderDashboardPlatforms();
    loadSettings();
  } catch (err) { toast(err.message, 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str || ''));
  return div.innerHTML;
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return 'just now';
  const intervals = { yr: 31536000, mo: 2592000, d: 86400, h: 3600, m: 60 };
  for (const [unit, secs] of Object.entries(intervals)) {
    const val = Math.floor(seconds / secs);
    if (val >= 1) return `${val}${unit} ago`;
  }
  return 'just now';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function updateCharCount(elId, len) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = `${len} characters`;
  el.className = 'char-count' + (len > 3000 ? ' danger' : len > 2000 ? ' warning' : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Dashboard
// ─────────────────────────────────────────────────────────────────────────────

function switchAdminTab(tab, btn) {
  document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`admin-panel-${tab}`).style.display = '';
  document.querySelectorAll('.admin-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
  if (tab === 'users')    loadAdminUsers();
  if (tab === 'invites')  loadInviteCodes();
  if (tab === 'activity') loadAdminActivity();
  if (tab === 'config')   loadAdminConfig();
}

async function loadAdminDashboard() {
  try {
    const stats = await fetch('/admin/stats').then(r => r.json());
    setEl('adm-total-users', stats.total_users);
    setEl('adm-active-users', stats.active_users);
    setEl('adm-total-posts', stats.total_posts);
    setEl('adm-total-ai', stats.total_ai_gen);
    setEl('adm-scheduled', stats.scheduled_posts);
    const badge = document.getElementById('admin-users-badge');
    if (badge) badge.textContent = stats.total_users;
  } catch {}
}

async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px"><span class="spinner"></span></td></tr>';
  try {
    const users = await fetch('/admin/users').then(r => r.json());
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>
          <div style="font-weight:600;font-size:13px">${escapeHtml(u.name || u.email.split('@')[0])}</div>
          <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(u.email)}</div>
        </td>
        <td><span class="badge badge-${u.role==='admin'?'purple':'blue'}">${u.role==='admin'?'👑 Admin':'👤 User'}</span></td>
        <td><span class="badge badge-${u.status==='suspended'?'red':'green'}">${u.status||'active'}</span></td>
        <td>${u.posts || 0}</td>
        <td>${u.ai_generations || 0}</td>
        <td>${u.platforms_connected || 0}</td>
        <td style="font-size:11px">${new Date(u.created_at * 1000).toLocaleDateString()}</td>
        <td style="font-size:11px">${u.last_active ? timeAgo(new Date(u.last_active * 1000)) : 'Never'}</td>
        <td>
          <div style="display:flex;gap:4px">
            ${u.role !== 'admin'
              ? `<button class="btn btn-secondary btn-sm" onclick="makeAdmin(${u.id})" title="Make Admin">👑</button>`
              : `<button class="btn btn-secondary btn-sm" onclick="removeAdmin(${u.id})" title="Remove Admin">👤</button>`}
            ${u.status !== 'suspended'
              ? `<button class="btn btn-secondary btn-sm" onclick="suspendUser(${u.id})" title="Suspend">🚫</button>`
              : `<button class="btn btn-success btn-sm" onclick="activateUser(${u.id})" title="Activate">✅</button>`}
            <button class="btn btn-danger btn-sm btn-icon" onclick="deleteUser(${u.id},'${escapeHtml(u.email)}')" title="Delete">🗑</button>
          </div>
        </td>
      </tr>`).join('');
  } catch (err) { tbody.innerHTML = `<tr><td colspan="9" style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</td></tr>`; }
}

async function makeAdmin(id)    { await fetch(`/admin/users/${id}/role`,   { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role: 'admin' }) }); toast('User promoted to Admin', 'success'); loadAdminUsers(); }
async function removeAdmin(id)  { await fetch(`/admin/users/${id}/role`,   { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ role: 'user' }) });  toast('Admin rights removed', 'info');    loadAdminUsers(); }
async function suspendUser(id)  { if (!confirm('Suspend this user?')) return; await fetch(`/admin/users/${id}/status`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'suspended' }) }); toast('User suspended', 'warning'); loadAdminUsers(); }
async function activateUser(id) { await fetch(`/admin/users/${id}/status`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status: 'active' }) });   toast('User activated', 'success');  loadAdminUsers(); }
async function deleteUser(id, email) {
  if (!confirm(`Permanently delete ${email} and ALL their data? This cannot be undone.`)) return;
  await fetch(`/admin/users/${id}`, { method: 'DELETE' });
  toast(`${email} deleted`, 'info');
  loadAdminUsers();
  loadAdminDashboard();
}

async function generateInviteCode() {
  const note     = document.getElementById('inv-note').value.trim();
  const expires  = parseInt(document.getElementById('inv-expires').value) || null;
  const maxUses  = parseInt(document.getElementById('inv-max-uses').value) || 1;
  const resultEl = document.getElementById('new-invite-result');

  try {
    const data = await fetch('/admin/invite-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, expires_hours: expires, max_uses: maxUses }),
    }).then(r => r.json());

    const shareUrl = `${window.location.origin}/login.html?invite=${data.code}`;
    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:12px">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Invite code generated:</div>
        <div style="font-size:22px;font-weight:900;letter-spacing:4px;color:#a78bfa;font-family:monospace">${data.code}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px;word-break:break-all">${shareUrl}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText('${data.code}');toast('Code copied!','success')">📋 Copy Code</button>
          <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${escapeHtml(shareUrl)}');toast('Link copied!','success')">🔗 Copy Link</button>
        </div>
      </div>`;
    document.getElementById('inv-note').value = '';
    loadInviteCodes();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadInviteCodes() {
  const list = document.getElementById('invite-codes-list');
  if (!list) return;
  try {
    const codes = await fetch('/admin/invite-codes').then(r => r.json());
    if (!codes.length) { list.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">🎟️</div><div class="empty-title">No invite codes</div></div>'; return; }
    const now = Math.floor(Date.now() / 1000);
    list.innerHTML = codes.map(c => {
      const expired   = c.expires_at && c.expires_at < now;
      const exhausted = c.use_count >= c.max_uses;
      const status    = expired ? 'Expired' : exhausted ? 'Used' : 'Active';
      const badgeCls  = expired || exhausted ? 'badge-red' : 'badge-green';
      return `
        <div class="scheduled-item">
          <div class="scheduled-content">
            <div style="font-size:16px;font-weight:900;letter-spacing:3px;color:#a78bfa;font-family:monospace">${escapeHtml(c.code)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
              By ${escapeHtml(c.creator_email)} · ${c.use_count}/${c.max_uses} uses ·
              ${c.expires_at ? `Expires ${new Date(c.expires_at*1000).toLocaleDateString()}` : 'Never expires'}
              ${c.used_by_email ? ` · Used by ${escapeHtml(c.used_by_email)}` : ''}
            </div>
            ${c.note ? `<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(c.note)}</div>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="badge ${badgeCls}">${status}</span>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="navigator.clipboard.writeText('${escapeHtml(c.code)}');toast('Copied!','success')" title="Copy">📋</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="revokeInvite(${c.id})" title="Revoke">🗑</button>
          </div>
        </div>`;
    }).join('');
  } catch {}
}

async function revokeInvite(id) {
  await fetch(`/admin/invite-codes/${id}`, { method: 'DELETE' });
  toast('Invite code revoked', 'info');
  loadInviteCodes();
}

async function loadAdminActivity() {
  const list = document.getElementById('admin-activity-list');
  if (!list) return;
  try {
    const posts = await fetch('/admin/activity').then(r => r.json());
    if (!posts.length) { list.innerHTML = '<div class="empty-state" style="padding:30px"><div class="empty-icon">📭</div><div class="empty-title">No activity yet</div></div>'; return; }
    list.innerHTML = posts.map(p => `
      <div class="activity-item">
        <div class="activity-icon">📤</div>
        <div class="activity-text">
          <div class="activity-title">${escapeHtml((p.content||'').substring(0,80))}…</div>
          <div class="activity-meta">
            <span class="badge badge-blue">${escapeHtml(p.email||'unknown')}</span>
            ${(p.platforms||[]).map(pl => `<span class="tag">${PLATFORMS[pl]?.icon||''} ${pl}</span>`).join('')}
          </div>
        </div>
        <div class="activity-time">${timeAgo(new Date(p.created_at*1000))}</div>
      </div>`).join('');
  } catch {}
}

async function loadAdminConfig() {
  try {
    const config = await fetch('/admin/config').then(r => r.json());
    const modeEl = document.getElementById('admin-reg-mode');
    const nameEl = document.getElementById('admin-app-name');
    if (modeEl) modeEl.value = config.registration_mode || 'open';
    if (nameEl) nameEl.value = config.app_name || 'NEXUS';
  } catch {}
}

async function saveAdminConfig() {
  try {
    await fetch('/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_mode: document.getElementById('admin-reg-mode').value,
        app_name:          document.getElementById('admin-app-name').value,
      }),
    });
    toast('✅ Platform configuration saved!', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme (Light / Dark)
// ─────────────────────────────────────────────────────────────────────────────

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('nexus_theme', isLight ? 'light' : 'dark');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = isLight ? '☀️' : '🌙';
  if (btn) btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
}

function initTheme() {
  const saved = localStorage.getItem('nexus_theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
    const btn = document.getElementById('btn-theme');
    if (btn) { btn.textContent = '☀️'; btn.title = 'Switch to dark mode'; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL Param Handling (OAuth callbacks)
// ─────────────────────────────────────────────────────────────────────────────

function handleURLParams() {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const error = params.get('error');

  if (connected) {
    toast(`✅ ${connected.charAt(0).toUpperCase() + connected.slice(1)} connected successfully!`, 'success');
    window.history.replaceState({}, '', '/');
  }

  if (error) {
    const msgs = {
      linkedin_denied: 'LinkedIn authorization was denied',
      linkedin_failed: 'LinkedIn connection failed — check your app credentials',
      facebook_denied: 'Facebook authorization was denied',
      facebook_failed: 'Facebook connection failed — check your app credentials',
      pinterest_denied: 'Pinterest authorization was denied',
      pinterest_failed: 'Pinterest connection failed',
      twitter_denied: 'Twitter authorization was denied',
      twitter_failed: 'Twitter connection failed',
    };
    toast(msgs[error] || `OAuth error: ${error}`, 'error', 6000);
    window.history.replaceState({}, '', '/');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Selector
// ─────────────────────────────────────────────────────────────────────────────

const ModelState = {
  textModel:  null,   // selected text generation model
  imageModel: null,   // selected image model
  videoModel: null,   // selected video model
  available:  null,   // cached from /api/models
};

const PROVIDER_COLORS = {
  ollama:     'badge-purple',
  google:     'badge-blue',
  anthropic:  'badge-orange',
  stability:  'badge-green',
  openai:     'badge-green',
  luma:       'badge-blue',
  runway:     'badge-red',
};

const PROVIDER_ICONS = {
  ollama: '🦙', google: '✨', anthropic: '🤖',
  stability: '🎨', openai: '🖼️', luma: '🎬', runway: '🎥',
};

async function loadModels() {
  try {
    const data = await api('GET', '/api/models');
    ModelState.available = data;
    renderModelChips('gen-model-chips', data.text,  'text',  model => {
      ModelState.textModel = model;
      const badge = document.getElementById('gen-active-model-badge');
      if (badge) badge.textContent = model ? model.label : '';
      const desc = document.getElementById('gen-model-desc');
      if (desc) desc.textContent = model ? `Using ${model.label} (${model.provider})` : 'Select a model below';
    });
    renderModelChips('img-model-chips',  data.image, 'image', model => { ModelState.imageModel = model; });
    renderModelChips('vid-model-chips',  data.video, 'video', model => { ModelState.videoModel = model; });

    // Auto-select first available
    if (!ModelState.textModel  && data.text?.length)  selectModel(data.text[0],  'text');
    if (!ModelState.imageModel && data.image?.length) selectModel(data.image[0], 'image');
    if (!ModelState.videoModel && data.video?.length) selectModel(data.video[0], 'video');
  } catch {}
}

function renderModelChips(containerId, models, type, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!models?.length) {
    container.innerHTML = `<span style="font-size:11px;color:var(--text-muted)">No ${type} models configured — add API keys in Settings</span>`;
    return;
  }
  container.innerHTML = models.map((m, i) => {
    const colorClass = PROVIDER_COLORS[m.provider] || 'badge-purple';
    const icon = PROVIDER_ICONS[m.provider] || '🤖';
    const sizeText = m.size ? ` · ${(m.size/1e9).toFixed(1)}GB` : '';
    return `<button class="model-chip ${i === 0 ? 'active' : ''}" data-model-id="${m.id}" onclick="selectModel(${JSON.stringify(m).replace(/"/g,'&quot;')}, '${type}')"
      style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:20px;border:1px solid var(--border);background:var(--glass);cursor:pointer;font-size:12px;font-weight:500;color:var(--text-secondary);transition:var(--transition)">
      ${icon} ${escapeHtml(m.label)}${sizeText}
    </button>`;
  }).join('');
}

function selectModel(model, type) {
  const barMap   = { text: 'gen-model-chips', image: 'img-model-chips', video: 'vid-model-chips' };
  const container = document.getElementById(barMap[type]);
  if (container) {
    container.querySelectorAll('.model-chip').forEach(c => {
      const isActive = c.dataset.modelId === model.id;
      c.style.background = isActive ? 'rgba(124,58,237,0.2)' : 'var(--glass)';
      c.style.borderColor = isActive ? 'var(--accent-purple)' : 'var(--border)';
      c.style.color       = isActive ? '#a78bfa' : 'var(--text-secondary)';
    });
  }

  if (type === 'text')  {
    ModelState.textModel = model;
    const badge = document.getElementById('gen-active-model-badge');
    if (badge) badge.textContent = model.label;
    const desc = document.getElementById('gen-model-desc');
    if (desc) desc.textContent = `Using ${model.label} · ${model.provider}`;
  }
  if (type === 'image') ModelState.imageModel = model;
  if (type === 'video') ModelState.videoModel = model;
}

// Show/hide video model bar when switching media tabs
const _origSwitchMediaTab = window.switchMediaTab;

// ─────────────────────────────────────────────────────────────────────────────
// SEO Tools
// ─────────────────────────────────────────────────────────────────────────────

function switchSeoTab(tab, btn) {
  document.querySelectorAll('.seo-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`seo-panel-${tab}`).style.display = '';
  document.querySelectorAll('.seo-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
  if (tab === 'tracked') loadTrackedKeywords();
}

async function generateMetaTags() {
  const btn = document.getElementById('btn-seo-meta');
  const out = document.getElementById('seo-meta-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/seo/meta', {
      page_title: document.getElementById('seo-page-title').value,
      target_keyword: document.getElementById('seo-target-kw').value,
      url: document.getElementById('seo-url').value,
      page_content: document.getElementById('seo-content-summary').value,
    });
    out.innerHTML = `
      <div class="seo-result-group"><div class="seo-result-label">Meta Title <span class="badge badge-${data.meta_title?.length > 60 ? 'red' : 'green'}">${data.meta_title?.length || 0} chars</span></div>
        <div class="seo-result-value">${escapeHtml(data.meta_title || '')}</div>
        <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${escapeHtml(data.meta_title || '')}');toast('Copied!','success')" style="margin-top:6px">📋 Copy</button>
      </div>
      <div class="seo-result-group"><div class="seo-result-label">Meta Description <span class="badge badge-${data.meta_description?.length > 160 ? 'red' : 'green'}">${data.meta_description?.length || 0} chars</span></div>
        <div class="seo-result-value">${escapeHtml(data.meta_description || '')}</div>
        <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${escapeHtml(data.meta_description || '')}');toast('Copied!','success')" style="margin-top:6px">📋 Copy</button>
      </div>
      <div class="seo-result-group"><div class="seo-result-label">Focus Keywords</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${(data.focus_keywords || []).map(k => `<span class="badge badge-blue">${escapeHtml(k)}</span>`).join('')}</div>
      </div>
      <div class="seo-result-group"><div class="seo-result-label">Open Graph Title</div><div class="seo-result-value">${escapeHtml(data.og_title || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">OG Description</div><div class="seo-result-value">${escapeHtml(data.og_description || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">SEO Score</div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:28px;font-weight:700;color:${data.seo_score >= 80 ? 'var(--accent-green)' : data.seo_score >= 60 ? 'var(--accent-orange)' : '#ef4444'}">${data.seo_score || 0}</div>
          <div style="font-size:12px;color:var(--text-muted)">/100</div>
        </div>
      </div>
      ${data.suggestions?.length ? `<div class="seo-result-group"><div class="seo-result-label">Suggestions</div>
        ${data.suggestions.map(s => `<div style="font-size:12px;color:var(--text-secondary);padding:4px 0;border-bottom:1px solid var(--border)">💡 ${escapeHtml(s)}</div>`).join('')}</div>` : ''}
      <div style="margin-top:16px"><button class="btn btn-secondary btn-sm" onclick="copyMetaTags()" style="width:100%">📋 Copy All as HTML</button></div>`;
    State.lastMetaTags = data;
    toast('Meta tags generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '🏷️ Generate Meta Tags'; }
}

function copyMetaTags() {
  const d = State.lastMetaTags;
  if (!d) return;
  const html = `<title>${d.meta_title}</title>\n<meta name="description" content="${d.meta_description}">\n<meta property="og:title" content="${d.og_title}">\n<meta property="og:description" content="${d.og_description}">`;
  navigator.clipboard.writeText(html);
  toast('HTML meta tags copied!', 'success');
}

async function researchKeywords() {
  const btn = document.getElementById('btn-kw-research');
  const out = document.getElementById('kw-results');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Researching…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/seo/keywords', {
      topic: document.getElementById('kw-topic').value,
      niche: document.getElementById('kw-niche').value,
      competitors: document.getElementById('kw-competitors').value,
    });
    let html = '';
    if (data.primary_keywords?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">🎯 Primary Keywords</div>${data.primary_keywords.map(k =>
        `<div class="kw-row"><span class="kw-term">${escapeHtml(k.keyword)}</span><span class="badge badge-${k.difficulty==='low'?'green':k.difficulty==='medium'?'orange':'red'}">${k.difficulty}</span><span class="badge badge-blue">${k.intent}</span><button class="btn btn-secondary btn-sm" onclick="addTrackedFromResearch('${encapeHtml(k.keyword)}')">+ Track</button></div>`).join('')}</div>`;
    }
    if (data.long_tail_keywords?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">📏 Long-tail Keywords</div>${data.long_tail_keywords.map(k =>
        `<div class="kw-row"><span class="kw-term">${escapeHtml(k.keyword)}</span><span class="badge badge-${k.difficulty==='low'?'green':k.difficulty==='medium'?'orange':'red'}">${k.difficulty}</span><button class="btn btn-secondary btn-sm" onclick="addTrackedFromResearch('${encapeHtml(k.keyword)}')">+ Track</button></div>`).join('')}</div>`;
    }
    if (data.questions?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">❓ Questions to Answer</div>${data.questions.map(q => `<div style="padding:5px 0;font-size:13px;border-bottom:1px solid var(--border)">• ${escapeHtml(q)}</div>`).join('')}</div>`;
    }
    if (data.content_ideas?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">💡 Content Ideas</div>${data.content_ideas.map(i => `<div style="padding:5px 0;font-size:13px;border-bottom:1px solid var(--border)">📝 ${escapeHtml(i)}</div>`).join('')}</div>`;
    }
    out.innerHTML = html || '<div style="padding:20px;color:var(--text-muted)">No results</div>';
    toast('Keyword research complete!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '🔑 Research Keywords'; }
}

function encapeHtml(str) { return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function addTrackedFromResearch(keyword) {
  document.getElementById('add-kw-input').value = keyword;
  switchSeoTab('tracked', document.querySelector('[data-tab="tracked"]'));
  addTrackedKeyword();
}

async function optimizeContent() {
  const btn = document.getElementById('btn-optimize');
  const out = document.getElementById('seo-opt-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analyzing…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/seo/optimize', {
      content: document.getElementById('opt-content').value,
      target_keyword: document.getElementById('opt-keyword').value,
      content_type: document.getElementById('opt-type').value,
    });
    const scoreColor = data.seo_score >= 80 ? 'var(--accent-green)' : data.seo_score >= 60 ? 'var(--accent-orange)' : '#ef4444';
    out.innerHTML = `
      <div style="display:flex;gap:16px;margin-bottom:20px">
        <div style="text-align:center;background:var(--glass);border-radius:12px;padding:16px;flex:1"><div style="font-size:32px;font-weight:700;color:${scoreColor}">${data.seo_score}</div><div style="font-size:11px;color:var(--text-muted)">SEO Score</div></div>
        <div style="text-align:center;background:var(--glass);border-radius:12px;padding:16px;flex:1"><div style="font-size:32px;font-weight:700;color:var(--accent-blue)">${data.readability_score}</div><div style="font-size:11px;color:var(--text-muted)">Readability</div></div>
        <div style="text-align:center;background:var(--glass);border-radius:12px;padding:16px;flex:1"><div style="font-size:20px;font-weight:700;color:var(--text-primary)">${data.keyword_density}</div><div style="font-size:11px;color:var(--text-muted)">Keyword Density</div></div>
        <div style="text-align:center;background:var(--glass);border-radius:12px;padding:16px;flex:1"><div style="font-size:20px;font-weight:700;color:var(--text-primary)">${data.word_count}</div><div style="font-size:11px;color:var(--text-muted)">Words</div></div>
      </div>
      ${data.issues?.length ? `<div class="seo-result-group"><div class="seo-result-label">⚠️ Issues</div>${data.issues.map(i => `<div style="padding:5px 0;font-size:13px;color:${i.type==='error'?'#ef4444':'var(--accent-orange)'}">● ${escapeHtml(i.message)}</div>`).join('')}</div>` : ''}
      ${data.suggestions?.length ? `<div class="seo-result-group"><div class="seo-result-label">💡 Suggestions</div>${data.suggestions.map(s => `<div style="padding:5px 0;font-size:13px;color:var(--text-secondary);border-bottom:1px solid var(--border)">→ ${escapeHtml(s)}</div>`).join('')}</div>` : ''}
      ${data.suggested_headings?.length ? `<div class="seo-result-group"><div class="seo-result-label">📑 Suggested Structure</div>${data.suggested_headings.map(h => `<div style="padding:4px 0;font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(h)}</div>`).join('')}</div>` : ''}`;
    toast('Content analyzed!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '⚡ Analyze & Score'; }
}

async function loadTrackedKeywords() {
  const list = document.getElementById('tracked-kw-list');
  if (!list) return;
  try {
    const keywords = await api('GET', '/api/seo/keywords/tracked');
    if (!keywords.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">📍</div><div class="empty-title">No tracked keywords</div><div class="empty-desc">Add keywords to monitor your SEO rankings.</div></div>';
      return;
    }
    list.innerHTML = `<table class="analytics-table"><thead><tr><th>Keyword</th><th>Target URL</th><th>Position</th><th>Notes</th><th></th></tr></thead><tbody>
      ${keywords.map(k => `<tr>
        <td><strong>${escapeHtml(k.keyword)}</strong></td>
        <td style="font-size:12px;color:var(--text-muted)">${escapeHtml(k.url || '—')}</td>
        <td>${k.position ? `<span class="badge badge-${k.position <= 10 ? 'green' : k.position <= 30 ? 'orange' : 'red'}">#${k.position}</span>` : '—'}</td>
        <td style="font-size:12px">${escapeHtml(k.notes || '—')}</td>
        <td><button class="btn btn-danger btn-sm btn-icon" onclick="deleteTrackedKeyword(${k.id})" title="Remove">🗑</button></td>
      </tr>`).join('')}
    </tbody></table>`;
  } catch {}
}

async function addTrackedKeyword() {
  const kw = document.getElementById('add-kw-input').value.trim();
  const url = document.getElementById('add-kw-url')?.value.trim() || '';
  if (!kw) return toast('Please enter a keyword', 'warning');
  try {
    await api('POST', '/api/seo/keywords/tracked', { keyword: kw, url });
    document.getElementById('add-kw-input').value = '';
    if (document.getElementById('add-kw-url')) document.getElementById('add-kw-url').value = '';
    toast(`"${kw}" added to tracked keywords`, 'success');
    loadTrackedKeywords();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTrackedKeyword(id) {
  await api('DELETE', `/api/seo/keywords/tracked/${id}`);
  loadTrackedKeywords();
}

// ─────────────────────────────────────────────────────────────────────────────
// ASO (App Store Optimization)
// ─────────────────────────────────────────────────────────────────────────────

async function generateASO() {
  const btn = document.getElementById('btn-aso');
  const out = document.getElementById('aso-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…';
  out.innerHTML = '<div style="text-align:center;padding:60px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/seo/aso', {
      app_name: document.getElementById('aso-app-name').value,
      app_description: document.getElementById('aso-app-desc').value,
      category: document.getElementById('aso-category').value,
      platform: document.getElementById('aso-platform').value,
      competitors: document.getElementById('aso-competitors').value,
    });
    const copyBtn = (text) => `<button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="navigator.clipboard.writeText(${JSON.stringify(text)});toast('Copied!','success')">📋 Copy</button>`;
    let html = '';
    if (data.app_store) {
      html += `<div class="seo-result-group"><div class="seo-result-label" style="color:#0a66c2">🍎 App Store (iOS)</div>
        <div><b>Title:</b> <span class="badge badge-${data.app_store.title?.length > 30 ? 'red' : 'green'}">${data.app_store.title?.length} chars</span> ${escapeHtml(data.app_store.title || '')} ${copyBtn(data.app_store.title)}</div>
        <div style="margin-top:8px"><b>Subtitle:</b> ${escapeHtml(data.app_store.subtitle || '')} ${copyBtn(data.app_store.subtitle)}</div>
        <div style="margin-top:8px"><b>Keywords:</b> <span class="badge badge-${data.app_store.keywords?.length > 100 ? 'red' : 'green'}">${data.app_store.keywords?.length} chars</span><br><code style="font-size:11px">${escapeHtml(data.app_store.keywords || '')}</code> ${copyBtn(data.app_store.keywords)}</div>
        <div style="margin-top:8px"><b>Short Description:</b><br>${escapeHtml(data.app_store.short_description || '')} ${copyBtn(data.app_store.short_description)}</div>
        <details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--accent-blue)">Full Description (click to expand)</summary><div style="font-size:12px;margin-top:8px;white-space:pre-wrap">${escapeHtml(data.app_store.description || '')}</div>${copyBtn(data.app_store.description)}</details>
      </div>`;
    }
    if (data.play_store) {
      html += `<div class="seo-result-group"><div class="seo-result-label" style="color:#34a853">🤖 Google Play Store</div>
        <div><b>Title:</b> <span class="badge badge-${data.play_store.title?.length > 50 ? 'red' : 'green'}">${data.play_store.title?.length} chars</span> ${escapeHtml(data.play_store.title || '')} ${copyBtn(data.play_store.title)}</div>
        <div style="margin-top:8px"><b>Short Description:</b> <span class="badge badge-${data.play_store.short_description?.length > 80 ? 'red' : 'green'}">${data.play_store.short_description?.length} chars</span><br>${escapeHtml(data.play_store.short_description || '')} ${copyBtn(data.play_store.short_description)}</div>
        <details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--accent-blue)">Full Description</summary><div style="font-size:12px;margin-top:8px;white-space:pre-wrap">${escapeHtml(data.play_store.full_description || '')}</div>${copyBtn(data.play_store.full_description)}</details>
        ${data.play_store.keywords?.length ? `<div style="margin-top:8px"><b>Keywords:</b> ${data.play_store.keywords.map(k => `<span class="badge badge-blue">${escapeHtml(k)}</span>`).join(' ')}</div>` : ''}
      </div>`;
    }
    if (data.screenshots_suggestions?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">📸 Screenshot Ideas</div>${data.screenshots_suggestions.map((s, i) => `<div style="padding:4px 0;font-size:13px">${i+1}. ${escapeHtml(s)}</div>`).join('')}</div>`;
    }
    if (data.aso_tips?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">💡 ASO Tips</div>${data.aso_tips.map(t => `<div style="padding:4px 0;font-size:12px;color:var(--text-secondary)">✓ ${escapeHtml(t)}</div>`).join('')}</div>`;
    }
    out.innerHTML = html;
    toast('ASO listing generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '📱 Generate ASO Listing'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Email Marketing
// ─────────────────────────────────────────────────────────────────────────────

function switchEmailTab(tab, btn) {
  document.querySelectorAll('.email-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`email-panel-${tab}`).style.display = '';
  document.querySelectorAll('.email-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
}

function loadEmailPage() {
  loadCampaigns();
  loadSubscribers();
}

async function loadCampaigns() {
  const list = document.getElementById('campaigns-list');
  if (!list) return;
  try {
    const camps = await api('GET', '/api/email/campaigns');
    if (!camps.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">📨</div><div class="empty-title">No campaigns yet</div></div>';
      return;
    }
    list.innerHTML = camps.map(c => `
      <div class="scheduled-item" style="cursor:pointer" onclick="loadCampaignToEditor(${JSON.stringify(c).replace(/"/g, '&quot;')})">
        <div class="scheduled-content">
          <div class="scheduled-text"><strong>${escapeHtml(c.name)}</strong></div>
          <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(c.subject)}</div>
          <div style="margin-top:4px;display:flex;gap:6px">
            <span class="badge badge-${c.status==='sent'?'green':'orange'}">${c.status}</span>
            ${c.sent_count ? `<span class="badge badge-blue">Sent to ${c.sent_count}</span>` : ''}
            <span class="tag">${new Date(c.created_at * 1000).toLocaleDateString()}</span>
          </div>
        </div>
        <button class="btn btn-danger btn-sm btn-icon" onclick="event.stopPropagation();deleteCampaign(${c.id})" title="Delete">🗑</button>
      </div>`).join('');
  } catch {}
}

function loadCampaignToEditor(c) {
  document.getElementById('camp-name').value = c.name;
  document.getElementById('camp-subject').value = c.subject;
  document.getElementById('camp-body').value = c.html_content || c.text_content || '';
  State.editingCampaignId = c.id;
  toast(`Loaded: ${c.name}`, 'info');
}

async function saveCampaign() {
  const name = document.getElementById('camp-name').value.trim();
  const subject = document.getElementById('camp-subject').value.trim();
  const body = document.getElementById('camp-body').value.trim();
  if (!name || !subject) return toast('Campaign name and subject are required', 'warning');
  try {
    if (State.editingCampaignId) {
      await api('PUT', `/api/email/campaigns/${State.editingCampaignId}`, { name, subject, html_content: body, text_content: body });
    } else {
      await api('POST', '/api/email/campaigns', { name, subject, html_content: body, text_content: body });
    }
    toast('Campaign saved!', 'success');
    State.editingCampaignId = null;
    loadCampaigns();
  } catch (err) { toast(err.message, 'error'); }
}

async function sendCampaign() {
  const name = document.getElementById('camp-name').value.trim();
  const subject = document.getElementById('camp-subject').value.trim();
  const body = document.getElementById('camp-body').value.trim();
  if (!name || !subject || !body) return toast('Please fill in all campaign fields first', 'warning');
  if (!confirm(`Send "${name}" to all active subscribers?`)) return;
  const btn = document.getElementById('btn-send-camp');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  try {
    if (!State.editingCampaignId) await saveCampaign();
    const campId = State.editingCampaignId;
    if (!campId) { toast('Save the campaign first', 'warning'); return; }
    const result = await api('POST', `/api/email/campaigns/${campId}/send`);
    toast(`Sent to ${result.sent} subscribers!`, 'success');
    State.editingCampaignId = null;
    loadCampaigns();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '📤 Send Now'; }
}

async function deleteCampaign(id) {
  if (!confirm('Delete this campaign?')) return;
  await api('DELETE', `/api/email/campaigns/${id}`);
  if (State.editingCampaignId === id) State.editingCampaignId = null;
  loadCampaigns();
}

async function loadSubscribers() {
  const list = document.getElementById('subscribers-list');
  const countEl = document.getElementById('sub-count');
  if (!list) return;
  try {
    const subs = await api('GET', '/api/email/subscribers');
    if (countEl) countEl.textContent = subs.length;
    if (!subs.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">👥</div><div class="empty-title">No subscribers yet</div></div>';
      return;
    }
    list.innerHTML = subs.map(s => `
      <div class="scheduled-item">
        <div class="scheduled-content">
          <div class="scheduled-text"><strong>${escapeHtml(s.email)}</strong>${s.name ? ` — ${escapeHtml(s.name)}` : ''}</div>
          <div style="display:flex;gap:6px;margin-top:4px">
            <span class="badge badge-${s.status==='active'?'green':'red'}">${s.status}</span>
            ${s.tags ? s.tags.split(',').map(t => `<span class="tag">${escapeHtml(t.trim())}</span>`).join('') : ''}
            <span class="tag">${new Date(s.created_at * 1000).toLocaleDateString()}</span>
          </div>
        </div>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteSubscriber(${s.id})" title="Remove">🗑</button>
      </div>`).join('');
  } catch {}
}

async function addSubscriber() {
  const email = document.getElementById('sub-email').value.trim();
  const name = document.getElementById('sub-name').value.trim();
  const tags = document.getElementById('sub-tags').value.trim();
  if (!email) return toast('Email is required', 'warning');
  try {
    await api('POST', '/api/email/subscribers', { email, name, tags });
    document.getElementById('sub-email').value = '';
    document.getElementById('sub-name').value = '';
    document.getElementById('sub-tags').value = '';
    toast(`${email} added!`, 'success');
    loadSubscribers();
  } catch (err) { toast(err.message, 'error'); }
}

async function bulkImportSubscribers() {
  const emails = document.getElementById('bulk-emails').value.trim();
  if (!emails) return toast('Please enter email addresses', 'warning');
  try {
    const result = await api('POST', '/api/email/subscribers/bulk', { emails });
    document.getElementById('bulk-emails').value = '';
    toast(`Imported ${result.added} of ${result.total} emails`, 'success');
    loadSubscribers();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteSubscriber(id) {
  await api('DELETE', `/api/email/subscribers/${id}`);
  loadSubscribers();
}

async function generateEmail() {
  const btn = document.getElementById('btn-gen-email');
  const out = document.getElementById('email-gen-output');
  const sendBtn = document.getElementById('btn-email-to-camp');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/email/generate', {
      type: document.getElementById('email-gen-type').value,
      app_name: document.getElementById('email-gen-app').value,
      topic: document.getElementById('email-gen-topic').value,
      tone: document.getElementById('email-gen-tone').value,
    });
    State.lastGeneratedEmail = data;
    out.innerHTML = `
      <div class="seo-result-group"><div class="seo-result-label">Subject Line A</div><div style="font-size:14px;font-weight:600">${escapeHtml(data.subject)}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">Subject Line B (A/B Test)</div><div style="font-size:13px;color:var(--text-secondary)">${escapeHtml(data.subject_b || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">Preview Text</div><div style="font-size:12px;color:var(--text-muted)">${escapeHtml(data.preview_text || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">CTA Button</div><div><span class="badge badge-purple">${escapeHtml(data.cta_text || '')}</span></div></div>
      <details style="margin-top:12px"><summary style="cursor:pointer;font-size:13px;color:var(--accent-blue);font-weight:600">HTML Body (click to expand)</summary><div style="font-size:11px;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;margin-top:8px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto">${escapeHtml(data.html_body || '')}</div></details>`;
    sendBtn.disabled = false;
    toast('Email generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '✨ Generate Email'; }
}

function sendGeneratedToCampaign() {
  const d = State.lastGeneratedEmail;
  if (!d) return;
  document.getElementById('camp-name').value = `${document.getElementById('email-gen-type').value} — ${new Date().toLocaleDateString()}`;
  document.getElementById('camp-subject').value = d.subject;
  document.getElementById('camp-body').value = d.html_body || d.text_body || '';
  State.editingCampaignId = null;
  switchEmailTab('campaigns', document.querySelector('[data-tab="campaigns"]'));
  toast('Email loaded into campaign editor', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// Ad Copy & Press Release
// ─────────────────────────────────────────────────────────────────────────────

function switchAdTab(tab, btn) {
  document.querySelectorAll('.adcopy-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`adcopy-panel-${tab}`).style.display = '';
  document.querySelectorAll('.adcopy-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
}

async function generateAdCopy() {
  const btn = document.getElementById('btn-gen-ad');
  const out = document.getElementById('ad-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/tools/ad-copy', {
      product: document.getElementById('ad-product').value,
      target_audience: document.getElementById('ad-audience').value,
      usp: document.getElementById('ad-usp').value,
      goal: document.getElementById('ad-goal').value,
    });
    const copyBtn = (label, text) => `<button class="btn btn-secondary btn-sm" style="margin-top:4px" onclick="navigator.clipboard.writeText(${JSON.stringify(text||'')});toast('Copied!','success')">📋 ${label}</button>`;
    const g = data.google_ads || {};
    const m = data.meta_ads || {};
    let html = `<div class="seo-result-group"><div class="seo-result-label" style="color:#4285f4">🔵 Google Ads</div>
      <div style="background:rgba(66,133,244,0.1);border-radius:8px;padding:12px;font-size:13px">
        <div><b>H1:</b> ${escapeHtml(g.headline_1||'')} <span class="badge badge-${(g.headline_1||'').length>30?'red':'green'}">${(g.headline_1||'').length}</span></div>
        <div><b>H2:</b> ${escapeHtml(g.headline_2||'')} <span class="badge badge-${(g.headline_2||'').length>30?'red':'green'}">${(g.headline_2||'').length}</span></div>
        <div><b>H3:</b> ${escapeHtml(g.headline_3||'')} <span class="badge badge-${(g.headline_3||'').length>30?'red':'green'}">${(g.headline_3||'').length}</span></div>
        <div style="margin-top:8px"><b>D1:</b> ${escapeHtml(g.description_1||'')} <span class="badge badge-${(g.description_1||'').length>90?'red':'green'}">${(g.description_1||'').length}</span></div>
        <div><b>D2:</b> ${escapeHtml(g.description_2||'')} <span class="badge badge-${(g.description_2||'').length>90?'red':'green'}">${(g.description_2||'').length}</span></div>
      </div>
      ${copyBtn('Copy Headlines', [g.headline_1, g.headline_2, g.headline_3].join(' | '))}
      ${copyBtn('Copy Descriptions', [g.description_1, g.description_2].join(' | '))}
    </div>
    <div class="seo-result-group"><div class="seo-result-label" style="color:#1877f2">📘 Meta Ads (Facebook/Instagram)</div>
      <div style="background:rgba(24,119,242,0.1);border-radius:8px;padding:12px;font-size:13px">
        <div><b>Primary Text:</b> ${escapeHtml(m.primary_text||'')}</div>
        <div style="margin-top:6px"><b>Headline:</b> ${escapeHtml(m.headline||'')} | <b>CTA:</b> <span class="badge badge-blue">${escapeHtml(m.cta||'')}</span></div>
      </div>
      ${copyBtn('Copy Meta Ad', `${m.primary_text||''}\n\n${m.headline||''}`)}
    </div>`;
    if (data.variations?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">🔄 Variations</div>${data.variations.map(v => `<div style="background:var(--glass);border-radius:8px;padding:10px;margin-bottom:8px;font-size:13px"><b>${escapeHtml(v.headline||'')}</b><br>${escapeHtml(v.text||'')} ${copyBtn('Copy', `${v.headline||''}\n${v.text||''}`)}</div>`).join('')}</div>`;
    }
    if (data.target_keywords?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">🔑 Suggested Keywords</div><div style="display:flex;gap:6px;flex-wrap:wrap">${data.target_keywords.map(k => `<span class="badge badge-blue">${escapeHtml(k)}</span>`).join('')}</div></div>`;
    }
    out.innerHTML = html;
    toast('Ad copy generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '📣 Generate Ad Copy'; }
}

async function generatePressRelease() {
  const btn = document.getElementById('btn-gen-pr');
  const out = document.getElementById('pr-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/tools/press-release', {
      app_name: document.getElementById('pr-app').value,
      announcement: document.getElementById('pr-announcement').value,
      company_name: document.getElementById('pr-company').value,
      features: document.getElementById('pr-features').value,
      quote: document.getElementById('pr-quote').value,
    });
    State.lastPressRelease = data.content;
    out.innerHTML = `<div style="font-family:'Inter',sans-serif;font-size:13px;line-height:1.8;white-space:pre-wrap;color:var(--text-primary)">${escapeHtml(data.content)}</div>`;
    toast('Press release generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '📰 Generate Press Release'; }
}

function copyPressRelease() {
  if (State.lastPressRelease) { navigator.clipboard.writeText(State.lastPressRelease); toast('Press release copied!', 'success'); }
}

async function getBestTimes() {
  const btn = document.getElementById('btn-best-times');
  const out = document.getElementById('best-times-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analyzing…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/tools/best-times', {
      industry: document.getElementById('bt-industry').value,
      audience: document.getElementById('bt-audience').value,
    });
    const icons = { linkedin: '🔵', facebook: '📘', instagram: '📸', twitter: '🐦', pinterest: '📌' };
    let html = '';
    for (const [platform, rec] of Object.entries(data.recommendations || {})) {
      html += `<div class="seo-result-group">
        <div class="seo-result-label">${icons[platform] || '📱'} ${platform.charAt(0).toUpperCase()+platform.slice(1)}</div>
        <div style="font-size:12px"><b>Best Days:</b> ${(rec.best_days||[]).join(', ')}</div>
        <div style="font-size:12px;margin-top:4px"><b>Best Times:</b> ${(rec.best_times||[]).map(t=>`<span class="badge badge-purple">${t}</span>`).join(' ')}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${escapeHtml(rec.tip||'')}</div>
        ${data.optimal_frequency?.[platform] ? `<div style="font-size:11px;margin-top:4px"><span class="badge badge-blue">Frequency: ${data.optimal_frequency[platform]}</span></div>` : ''}
      </div>`;
    }
    if (data.general_advice) html += `<div class="seo-result-group"><div class="seo-result-label">💡 General Strategy</div><div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(data.general_advice)}</div></div>`;
    out.innerHTML = html || '<div style="color:var(--text-muted);padding:20px">No data</div>';
    toast('Best times fetched!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '⏰ Get Best Times'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Media Creator
// ─────────────────────────────────────────────────────────────────────────────

function switchMediaTab(tab, btn) {
  document.querySelectorAll('.media-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`media-panel-${tab}`).style.display = '';
  document.querySelectorAll('.media-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');

  // Show relevant model bar
  const imgBar = document.getElementById('img-model-bar');
  const vidBar = document.getElementById('vid-model-bar');
  if (imgBar) imgBar.style.display = (tab === 'image') ? 'flex' : 'none';
  if (vidBar) vidBar.style.display = (tab === 'video') ? 'flex' : 'none';
}

async function enhanceImagePrompt() {
  const btn = document.getElementById('btn-enhance-prompt');
  const promptEl = document.getElementById('img-prompt');
  if (!promptEl.value.trim()) return toast('Enter a prompt first', 'warning');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await api('POST', '/api/media/enhance-prompt', {
      prompt: promptEl.value, media_type: 'image', style: document.getElementById('img-style').value,
    });
    promptEl.value = data.enhanced_prompt || promptEl.value;
    if (data.negative_prompt) document.getElementById('img-negative').value = data.negative_prompt;
    toast('Prompt enhanced!', 'success');
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '✨ Enhance Prompt'; }
}

async function generateImage() {
  const btn = document.getElementById('btn-gen-image');
  const out = document.getElementById('image-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…';
  out.innerHTML = '<div style="text-align:center;padding:60px"><span class="spinner lg"></span><div style="margin-top:16px;color:var(--text-muted);font-size:13px">Generating image (10-30s)…</div></div>';
  try {
    const data = await api('POST', '/api/media/generate-image', {
      prompt: document.getElementById('img-prompt').value,
      style: document.getElementById('img-style').value,
      negative_prompt: document.getElementById('img-negative').value,
      preferred_provider: ModelState.imageModel?.provider || null,
    });

    let imgEl;
    if (data.image_base64) {
      State.lastImageBase64 = data.image_base64;
      imgEl = `<img src="data:image/png;base64,${data.image_base64}" style="max-width:100%;border-radius:12px" />`;
    } else if (data.image_url) {
      State.lastImageUrl = data.image_url;
      imgEl = `<img src="${data.image_url}" style="max-width:100%;border-radius:12px" crossorigin="anonymous" />`;
    }
    out.innerHTML = imgEl || '<div style="color:#ef4444">No image returned</div>';
    document.getElementById('btn-dl-image').disabled = false;
    document.getElementById('btn-use-image').disabled = false;
    toast('Image generated!', 'success');
  } catch (err) {
    out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
    if (err.message.includes('not configured')) {
      out.innerHTML += `<div style="margin-top:12px;font-size:12px;color:var(--text-muted)">Add <code>STABILITY_API_KEY</code> or <code>OPENAI_API_KEY</code> to your .env file and restart the server.</div>`;
    }
    toast(err.message, 'error');
  }
  finally { btn.disabled = false; btn.innerHTML = '🖼️ Generate Image'; }
}

function downloadMedia(type) {
  if (type === 'image') {
    if (State.lastImageBase64) {
      const a = document.createElement('a');
      a.href = `data:image/png;base64,${State.lastImageBase64}`;
      a.download = `nexus-image-${Date.now()}.png`;
      a.click();
    } else if (State.lastImageUrl) {
      window.open(State.lastImageUrl, '_blank');
    }
  }
}

function useImageInCompose() {
  if (State.lastImageUrl) {
    document.getElementById('compose-image').value = State.lastImageUrl;
    navigateTo('compose');
    toast('Image URL added to Compose', 'success');
  } else if (State.lastImageBase64) {
    toast('For compose, use a hosted image URL. Download the image and upload to your hosting.', 'info', 6000);
  }
}

async function generateVideo() {
  const btn = document.getElementById('btn-gen-video');
  const out = document.getElementById('video-output');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Starting…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span><div style="margin-top:12px;color:var(--text-muted);font-size:13px">Starting video generation…</div></div>';
  try {
    const data = await api('POST', '/api/media/generate-video', {
      prompt: document.getElementById('vid-prompt').value,
      image_url: document.getElementById('vid-image').value || undefined,
      aspect_ratio: document.getElementById('vid-ratio').value,
    });
    out.innerHTML = `
      <div style="padding:20px;text-align:center">
        <div style="font-size:32px;margin-bottom:12px">🎬</div>
        <div style="font-weight:600;margin-bottom:8px">Video Generation Started</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Provider: ${data.provider} | Job: <code>${data.job_id}</code></div>
        <div class="badge badge-orange" style="font-size:12px">Processing — takes 30-120 seconds</div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" onclick="pollVideoStatus('${data.provider}','${data.job_id}',this)" id="btn-poll-video">🔄 Check Status</button>
        </div>
        <div id="video-poll-result" style="margin-top:16px"></div>
      </div>`;
    toast('Video generation started!', 'success');
  } catch (err) {
    out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
    toast(err.message, 'error');
  }
  finally { btn.disabled = false; btn.innerHTML = '🎬 Generate Video'; }
}

async function pollVideoStatus(provider, jobId, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Checking…';
  try {
    const data = await api('GET', `/api/media/video-status/${provider}/${jobId}`);
    const resultEl = document.getElementById('video-poll-result');
    if (data.done && data.video_url) {
      resultEl.innerHTML = `<div><div class="badge badge-green" style="font-size:12px;margin-bottom:12px">✅ Completed</div><br><video src="${data.video_url}" controls style="max-width:100%;border-radius:12px;margin-top:8px"></video><br><a href="${data.video_url}" download class="btn btn-primary btn-sm" style="margin-top:8px">⬇️ Download</a></div>`;
    } else if (data.status === 'failed') {
      resultEl.innerHTML = `<div class="badge badge-red">❌ Generation failed</div>`;
    } else {
      resultEl.innerHTML = `<div class="badge badge-orange">⏳ Still processing — check again in a few seconds</div>`;
      btn.disabled = false; btn.innerHTML = '🔄 Check Status';
    }
  } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = '🔄 Check Status'; }
}

async function generateAnimation() {
  const btn = document.getElementById('btn-gen-anim');
  const out = document.getElementById('animation-output');
  const imageData = document.getElementById('anim-image').value.trim();
  if (!imageData) return toast('Please provide an image (base64 or generate one first)', 'warning');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Starting…';
  out.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner lg"></span></div>';
  try {
    const payload = { motion_bucket_id: parseInt(document.getElementById('anim-motion').value) };
    if (imageData.startsWith('http')) { payload.image_url = imageData; }
    else { payload.image_base64 = imageData.replace(/^data:image\/\w+;base64,/, ''); }
    const data = await api('POST', '/api/media/generate-animation', payload);
    out.innerHTML = `
      <div style="text-align:center;padding:16px">
        <div class="badge badge-orange">⏳ Animation processing…</div>
        <div style="font-size:12px;color:var(--text-muted);margin:8px 0">Job ID: ${data.job_id}</div>
        <button class="btn btn-primary btn-sm" onclick="pollAnimationStatus('${data.job_id}',this)">🔄 Check Status</button>
        <div id="anim-poll-result" style="margin-top:12px"></div>
      </div>`;
    toast('Animation started!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:12px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '✨ Generate Animation'; }
}

async function pollAnimationStatus(jobId, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await api('GET', `/api/media/animation-status/${jobId}`);
    const r = document.getElementById('anim-poll-result');
    if (data.done && data.video_base64) {
      r.innerHTML = `<div class="badge badge-green">✅ Done</div><br><video src="data:video/mp4;base64,${data.video_base64}" autoplay loop muted style="max-width:100%;border-radius:12px;margin-top:8px"></video>`;
    } else {
      r.innerHTML = `<div class="badge badge-orange">⏳ Still processing</div>`;
      btn.disabled = false; btn.innerHTML = '🔄 Check Status';
    }
  } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = '🔄 Check'; }
}

async function generateCaption() {
  const btn = document.getElementById('btn-gen-caption');
  const out = document.getElementById('caption-output');
  const useBtn = document.getElementById('btn-caption-to-compose');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing…';
  out.innerHTML = '<div style="text-align:center;padding:30px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/media/generate-text-post', {
      image_description: document.getElementById('cap-description').value,
      platform: document.getElementById('cap-platform').value,
      tone: document.getElementById('cap-tone').value,
      include_hashtags: true,
    });
    State.lastCaption = data.caption;
    out.innerHTML = `
      <div class="seo-result-group"><div class="seo-result-label">Main Caption</div><div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${escapeHtml(data.caption || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">Short Version</div><div style="font-size:13px;color:var(--text-secondary)">${escapeHtml(data.short_caption || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">Hashtags</div><div style="font-size:12px;color:var(--accent-blue)">${escapeHtml(data.hashtags || '')}</div></div>
      <div class="seo-result-group"><div class="seo-result-label">CTA</div><div style="font-size:12px">${escapeHtml(data.cta || '')}</div></div>`;
    useBtn.disabled = false;
    toast('Caption generated!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '💬 Write Caption'; }
}

function sendCaptionToCompose() {
  if (!State.lastCaption) return;
  document.getElementById('compose-content').value = State.lastCaption;
  navigateTo('compose'); updateComposeCharCount();
  toast('Caption loaded into Compose', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// Hashtag Research
// ─────────────────────────────────────────────────────────────────────────────

async function researchHashtags() {
  const btn = document.getElementById('btn-hashtags');
  const out = document.getElementById('hashtag-output');
  const copyBtn = document.getElementById('btn-copy-hashtags');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Researching…';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/tools/hashtags', {
      topic: document.getElementById('ht-topic').value,
      platform: document.getElementById('ht-platform').value,
      count: parseInt(document.getElementById('ht-count').value),
    });
    State.lastHashtags = data;
    const renderGroup = (label, tags) => tags?.length
      ? `<div class="seo-result-group"><div class="seo-result-label">${label}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${tags.map(t=>`<span class="badge badge-blue" style="cursor:pointer" onclick="navigator.clipboard.writeText('${escapeHtml(t)}');toast('Copied!','success')">${escapeHtml(t)}</span>`).join('')}</div></div>` : '';
    const ht = data.hashtags || {};
    out.innerHTML = `
      ${renderGroup('🔥 High Volume', ht.high_volume)}
      ${renderGroup('📊 Medium Volume', ht.medium_volume)}
      ${renderGroup('🎯 Niche', ht.niche)}
      ${renderGroup('⚡ Trending', ht.trending)}
      ${data.recommended_mix ? `<div class="seo-result-group"><div class="seo-result-label">⭐ Recommended Mix</div><div style="font-size:13px;color:var(--accent-blue);word-break:break-all">${escapeHtml(data.recommended_mix)}</div><button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="navigator.clipboard.writeText('${escapeHtml(data.recommended_mix||'')}');toast('Copied!','success')">📋 Copy Mix</button></div>` : ''}
      ${data.instagram_set ? `<div class="seo-result-group"><div class="seo-result-label">📸 Instagram Set (30 tags)</div><div style="font-size:12px;color:var(--text-secondary);word-break:break-all">${escapeHtml(data.instagram_set)}</div><button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="navigator.clipboard.writeText('${escapeHtml(data.instagram_set||'')}');toast('Copied!','success')">📋 Copy IG Set</button></div>` : ''}
      ${data.tip ? `<div class="seo-result-group"><div class="seo-result-label">💡 Tip</div><div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(data.tip)}</div></div>` : ''}`;
    copyBtn.disabled = false;
    toast('Hashtags researched!', 'success');
  } catch (err) { out.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`; toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '#️⃣ Research Hashtags'; }
}

function copyHashtags() {
  const d = State.lastHashtags;
  if (!d) return;
  const all = Object.values(d.hashtags || {}).flat().join(' ');
  navigator.clipboard.writeText(all);
  toast('All hashtags copied!', 'success');
}

// ─────────────────────────────────────────────────────────────────────────────
// UTM Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildUTMLink() {
  const url = document.getElementById('utm-url').value.trim();
  const source = document.getElementById('utm-source').value.trim();
  const campaign = document.getElementById('utm-campaign').value.trim();
  if (!url || !source || !campaign) return toast('URL, source, and campaign are required', 'warning');

  const params = new URLSearchParams();
  ['utm-source','utm-medium','utm-campaign','utm-term','utm-content'].forEach(id => {
    const val = document.getElementById(id).value.trim();
    if (val) params.set(id.replace('-','_'), val);
  });

  const sep = url.includes('?') ? '&' : '?';
  const full = `${url}${sep}${params.toString()}`;
  State.lastUTMLink = full;

  document.getElementById('utm-result').innerHTML = `<a href="${escapeHtml(full)}" target="_blank" style="color:var(--accent-blue);word-break:break-all">${escapeHtml(full)}</a>`;
  document.getElementById('btn-copy-utm').disabled = false;
  document.getElementById('btn-save-utm').disabled = false;
}

function copyUTMLink() {
  if (State.lastUTMLink) { navigator.clipboard.writeText(State.lastUTMLink); toast('Link copied!', 'success'); }
}

async function saveUTMLink() {
  if (!State.lastUTMLink) return;
  try {
    await api('POST', '/api/tools/utm-links', {
      original_url: document.getElementById('utm-url').value.trim(),
      utm_source: document.getElementById('utm-source').value.trim(),
      utm_medium: document.getElementById('utm-medium').value.trim(),
      utm_campaign: document.getElementById('utm-campaign').value.trim(),
      utm_term: document.getElementById('utm-term').value.trim(),
      utm_content: document.getElementById('utm-content').value.trim(),
      label: document.getElementById('utm-label').value.trim(),
    });
    toast('UTM link saved!', 'success');
    loadUTMLinks();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadUTMLinks() {
  const list = document.getElementById('utm-links-list');
  if (!list) return;
  try {
    const links = await api('GET', '/api/tools/utm-links');
    if (!links.length) {
      list.innerHTML = '<div class="empty-state" style="padding:20px 0"><div class="empty-icon">🔗</div><div class="empty-title">No saved links</div></div>';
      return;
    }
    list.innerHTML = links.map(l => `
      <div class="scheduled-item">
        <div class="scheduled-content">
          <div class="scheduled-text">${l.label ? `<strong>${escapeHtml(l.label)}</strong> — ` : ''}<span class="badge badge-blue">${escapeHtml(l.utm_source||'')}</span> <span class="badge badge-purple">${escapeHtml(l.utm_campaign||'')}</span></div>
          <div style="font-size:11px;color:var(--text-muted);word-break:break-all;margin-top:4px">${escapeHtml((l.full_url||'').substring(0,80))}…</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-secondary btn-sm btn-icon" onclick="navigator.clipboard.writeText('${escapeHtml(l.full_url||'')}');toast('Copied!','success')" title="Copy">📋</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteUTMLink(${l.id})" title="Delete">🗑</button>
        </div>
      </div>`).join('');
  } catch {}
}

async function deleteUTMLink(id) {
  await api('DELETE', `/api/tools/utm-links/${id}`);
  loadUTMLinks();
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Templates
// ─────────────────────────────────────────────────────────────────────────────

async function loadTemplates() {
  const list = document.getElementById('templates-list');
  if (!list) return;
  const filter = document.getElementById('tmpl-filter')?.value || '';
  try {
    const templates = await api('GET', `/api/tools/templates${filter ? `?type=${filter}` : ''}`);
    if (!templates.length) {
      list.innerHTML = '<div class="empty-state" style="padding:40px 0"><div class="empty-icon">🗂️</div><div class="empty-title">No templates yet</div><div class="empty-desc">Save your best posts as reusable templates.</div></div>';
      return;
    }
    list.innerHTML = templates.map(t => `
      <div class="scheduled-item" style="cursor:pointer" onclick="previewTemplate(${JSON.stringify(t).replace(/"/g, '&quot;')})">
        <div class="scheduled-content">
          <div class="scheduled-text"><strong>${escapeHtml(t.name)}</strong></div>
          <div style="display:flex;gap:6px;margin-top:4px">
            <span class="badge badge-purple">${t.type}</span>
            ${t.tags ? t.tags.split(',').map(tag => `<span class="tag">${escapeHtml(tag.trim())}</span>`).join('') : ''}
          </div>
        </div>
        <button class="btn btn-danger btn-sm btn-icon" onclick="event.stopPropagation();deleteTemplate(${t.id})" title="Delete">🗑</button>
      </div>`).join('');
  } catch {}
}

function previewTemplate(t) {
  document.getElementById('tmpl-preview-title').textContent = `📋 ${t.name}`;
  document.getElementById('tmpl-preview-content').textContent = t.content;
  document.getElementById('btn-use-tmpl').disabled = false;
  State.selectedTemplate = t.content;
}

function useTemplate() {
  if (!State.selectedTemplate) return;
  document.getElementById('compose-content').value = State.selectedTemplate;
  navigateTo('compose'); updateComposeCharCount();
  toast('Template loaded into Compose', 'success');
}

function openSaveTemplateModal() {
  const compose = document.getElementById('compose-content');
  if (compose?.value) document.getElementById('tmpl-save-content').value = compose.value;
  document.getElementById('save-template-modal').style.display = 'flex';
}

async function saveTemplate() {
  const name = document.getElementById('tmpl-save-name').value.trim();
  const content = document.getElementById('tmpl-save-content').value.trim();
  if (!name || !content) return toast('Name and content are required', 'warning');
  try {
    await api('POST', '/api/tools/templates', {
      name, content,
      type: document.getElementById('tmpl-save-type').value,
      tags: document.getElementById('tmpl-save-tags').value,
    });
    document.getElementById('save-template-modal').style.display = 'none';
    document.getElementById('tmpl-save-name').value = '';
    document.getElementById('tmpl-save-content').value = '';
    toast('Template saved!', 'success');
    if (State.currentPage === 'templates') loadTemplates();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await api('DELETE', `/api/tools/templates/${id}`);
  loadTemplates();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama / Local AI
// ─────────────────────────────────────────────────────────────────────────────

async function checkOllamaStatus() {
  const dot  = document.getElementById('ollama-status-dot');
  const text = document.getElementById('ollama-status-text');
  const installGuide = document.getElementById('ollama-install-guide');
  const modelsList   = document.getElementById('ollama-models-list');
  const modelsGrid   = document.getElementById('ollama-models-grid');
  const toggle       = document.getElementById('ollama-enabled-toggle');
  const toggleLabel  = document.getElementById('ollama-enabled-label');

  text.textContent = 'Checking…';
  try {
    const data = await api('GET', '/api/config/ollama/status');

    if (data.running) {
      dot.style.background = '#10b981';
      dot.style.boxShadow  = '0 0 8px #10b981';
      text.textContent = `✅ Ollama running — ${data.models.length} model${data.models.length !== 1 ? 's' : ''} downloaded`;
      installGuide.style.display = 'none';

      if (data.models.length) {
        modelsList.style.display = 'block';
        modelsGrid.innerHTML = data.models.map(m => {
          const sizeGB = m.size ? (m.size / 1e9).toFixed(1) + ' GB' : '';
          return `<span class="badge badge-purple" style="cursor:pointer" onclick="selectOllamaModel('${escapeHtml(m.name)}')">${escapeHtml(m.name)} ${sizeGB}</span>`;
        }).join('');

        // Auto-select current model in dropdown
        const sel = document.getElementById('ollama-model-select');
        if (sel && data.current) {
          const opt = Array.from(sel.options).find(o => o.value === data.current);
          if (opt) sel.value = data.current;
          else {
            const newOpt = new Option(data.current, data.current);
            sel.add(newOpt);
            sel.value = data.current;
          }
        }
      }
    } else {
      dot.style.background = '#ef4444';
      dot.style.boxShadow  = 'none';
      text.textContent = '❌ Ollama not running — follow the install guide below';
      installGuide.style.display = 'block';
      modelsList.style.display = 'none';
    }

    if (toggle) {
      toggle.checked = data.enabled;
      toggleLabel.textContent = data.enabled ? 'Enabled' : 'Disabled';
      toggleLabel.style.color  = data.enabled ? 'var(--accent-green)' : 'var(--text-muted)';
    }

    const urlInput = document.getElementById('ollama-base-url');
    if (urlInput && data.base) urlInput.value = data.base;

  } catch (err) {
    dot.style.background = '#ef4444';
    text.textContent = '❌ Cannot reach Ollama — install it first';
  }
}

function selectOllamaModel(name) {
  const sel = document.getElementById('ollama-model-select');
  if (!sel) return;
  const existing = Array.from(sel.options).find(o => o.value === name);
  if (!existing) { const o = new Option(name, name); sel.add(o); }
  sel.value = name;
  toast(`Model set to ${name}`, 'info');
}

async function saveOllamaSettings() {
  const enabled  = document.getElementById('ollama-enabled-toggle')?.checked;
  const model    = document.getElementById('ollama-model-select')?.value;
  const base_url = document.getElementById('ollama-base-url')?.value.trim();
  const label    = document.getElementById('ollama-enabled-label');

  try {
    await api('POST', '/api/config/ollama/enable', { enabled, model, base_url });
    if (label) { label.textContent = enabled ? 'Enabled' : 'Disabled'; label.style.color = enabled ? 'var(--accent-green)' : 'var(--text-muted)'; }
    toast(enabled ? `✅ Ollama enabled — using ${model}` : 'Ollama disabled — using cloud AI', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function pullOllamaModel() {
  const input    = document.getElementById('ollama-pull-input');
  const progress = document.getElementById('ollama-pull-progress');
  const btn      = document.getElementById('btn-pull-model');
  const model    = input.value.trim();
  if (!model) return toast('Enter a model name', 'warning');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  progress.style.display = 'block';
  progress.textContent = `Pulling ${model}…`;

  try {
    const response = await fetch(`/api/config/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.status === 'done') {
            progress.textContent = `✅ ${model} downloaded!`;
            toast(`${model} pulled successfully!`, 'success');
            input.value = '';
            checkOllamaStatus();
          } else if (data.status === 'error') {
            progress.textContent = `❌ Error: ${data.error || 'Pull failed'}`;
          } else if (data.completed && data.total) {
            const pct = Math.round((data.completed / data.total) * 100);
            progress.textContent = `⬇️ ${data.status} — ${pct}% (${(data.completed / 1e6).toFixed(0)}MB / ${(data.total / 1e6).toFixed(0)}MB)`;
          } else {
            progress.textContent = `⬇️ ${data.status || 'downloading'}…`;
          }
        } catch {}
      }
    }
  } catch (err) {
    progress.textContent = `❌ ${err.message}`;
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Pull';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand Kit
// ─────────────────────────────────────────────────────────────────────────────

async function loadBrandKit() {
  try {
    const kit = await api('GET', '/api/tools/brand-kit');
    if (!kit || !kit.company_name) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('brand-name', kit.company_name);
    set('brand-tagline', kit.tagline);
    set('brand-audience', kit.target_audience);
    set('brand-voice', kit.brand_voice);
    set('brand-logo', kit.logo_url);
    set('brand-primary-hex', kit.primary_color || '#7c3aed');
    set('brand-secondary-hex', kit.secondary_color || '#3b82f6');
    set('brand-accent-hex', kit.accent_color || '#06b6d4');
    if (document.getElementById('brand-primary-color')) document.getElementById('brand-primary-color').value = kit.primary_color || '#7c3aed';
    if (document.getElementById('brand-secondary-color')) document.getElementById('brand-secondary-color').value = kit.secondary_color || '#3b82f6';
    if (document.getElementById('brand-accent-color')) document.getElementById('brand-accent-color').value = kit.accent_color || '#06b6d4';
    if (kit.font_name) { const sel = document.getElementById('brand-font'); if (sel) sel.value = kit.font_name; }
    updateBrandPreview();
  } catch {}
}

async function saveBrandKit() {
  try {
    await api('POST', '/api/tools/brand-kit', {
      company_name: document.getElementById('brand-name').value,
      tagline: document.getElementById('brand-tagline').value,
      target_audience: document.getElementById('brand-audience').value,
      brand_voice: document.getElementById('brand-voice').value,
      logo_url: document.getElementById('brand-logo').value,
      primary_color: document.getElementById('brand-primary-hex').value,
      secondary_color: document.getElementById('brand-secondary-hex').value,
      accent_color: document.getElementById('brand-accent-hex').value,
      font_name: document.getElementById('brand-font').value,
    });
    toast('Brand kit saved!', 'success');
    updateBrandPreview();
  } catch (err) { toast(err.message, 'error'); }
}

function syncColorInput(type) {
  const hex = document.getElementById(`brand-${type}-hex`).value;
  const picker = document.getElementById(`brand-${type}-color`);
  if (picker && /^#[0-9a-fA-F]{6}$/.test(hex)) { picker.value = hex; }
  updateBrandPreview();
}

function updateBrandPreview() {
  const name = document.getElementById('brand-name')?.value || 'Your Brand';
  const tagline = document.getElementById('brand-tagline')?.value || 'Your tagline here';
  const primary = document.getElementById('brand-primary-hex')?.value || '#7c3aed';
  const secondary = document.getElementById('brand-secondary-hex')?.value || '#3b82f6';
  const accent = document.getElementById('brand-accent-hex')?.value || '#06b6d4';
  const logo = document.getElementById('brand-logo')?.value;

  const previewName = document.getElementById('preview-name');
  const previewTagline = document.getElementById('preview-tagline');
  const previewLogo = document.getElementById('preview-logo');
  const previewPalette = document.getElementById('preview-palette');

  if (previewName) previewName.textContent = name;
  if (previewTagline) previewTagline.textContent = tagline;
  if (previewLogo) {
    if (logo) previewLogo.innerHTML = `<img src="${escapeHtml(logo)}" style="width:40px;height:40px;border-radius:8px;object-fit:cover">`;
    else previewLogo.style.background = primary;
  }
  if (previewPalette) {
    previewPalette.innerHTML = `
      <div style="width:32px;height:32px;border-radius:6px;background:${escapeHtml(primary)}" title="Primary"></div>
      <div style="width:32px;height:32px;border-radius:6px;background:${escapeHtml(secondary)}" title="Secondary"></div>
      <div style="width:32px;height:32px;border-radius:6px;background:${escapeHtml(accent)}" title="Accent"></div>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const data = await fetch('/users/me').then(r => r.json());
    if (!data.authenticated) { window.location.href = '/login.html'; return false; }
    State.user = data.user;
    // Update user menu
    const nameEl   = document.getElementById('user-name-label');
    const avatarEl = document.getElementById('user-avatar');
    const infoEl   = document.getElementById('user-info-header');
    if (nameEl)   nameEl.textContent   = data.user.name || data.user.email;
    if (avatarEl) avatarEl.textContent = (data.user.name || data.user.email)[0].toUpperCase();
    if (infoEl)   infoEl.innerHTML     = `
      <div style="font-weight:600;color:var(--text-primary)">${escapeHtml(data.user.name || '')}</div>
      <div>${escapeHtml(data.user.email)}</div>
      ${data.user.role==='admin' ? '<div><span class="badge badge-purple" style="font-size:10px;margin-top:4px">👑 Super Admin</span></div>' : ''}`;

    // Show admin nav item only for admins
    if (data.user.role === 'admin') {
      const adminNav = document.getElementById('nav-admin');
      if (adminNav) adminNav.style.display = '';
      // Add admin link to user dropdown
      const adminDropBtn = document.createElement('button');
      adminDropBtn.className = 'btn';
      adminDropBtn.style = 'width:100%;justify-content:flex-start;border-radius:0;padding:10px 16px;font-size:13px;color:var(--text-primary)';
      adminDropBtn.innerHTML = '👑 Admin Dashboard';
      adminDropBtn.onclick = () => { navigateTo('admin'); toggleUserMenu(); };
      const logoutBtn = document.querySelector('#user-dropdown .btn-danger');
      if (logoutBtn) logoutBtn.parentNode.insertBefore(adminDropBtn, logoutBtn);
    }
    return true;
  } catch { return false; }
}

function toggleUserMenu() {
  const dd = document.getElementById('user-dropdown');
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('user-menu-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

async function doLogout() {
  await fetch('/users/logout', { method: 'POST' });
  window.location.href = '/login.html';
}


// ─────────────────────────────────────────────────────────────────────────────
// User API Settings (per-user keys)
// ─────────────────────────────────────────────────────────────────────────────

async function loadUserSettings() {
  try {
    const s = await fetch('/users/settings').then(r => r.json());
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('u-google-key',     s.google_ai_key);
    set('u-anthropic-key',  s.anthropic_key);
    set('u-stability-key',  s.stability_key);
    set('u-openai-key',     s.openai_key);
    set('u-luma-key',       s.luma_key);
    set('u-runway-key',     s.runway_key);
    set('u-ollama-model',   s.ollama_model);
    const toggle = document.getElementById('u-ollama-enabled');
    if (toggle) toggle.checked = !!s.ollama_enabled;
  } catch {}
}

async function saveUserApiSettings() {
  const get = id => document.getElementById(id)?.value?.trim() || '';
  try {
    await fetch('/users/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        google_ai_key:  get('u-google-key'),
        anthropic_key:  get('u-anthropic-key'),
        stability_key:  get('u-stability-key'),
        openai_key:     get('u-openai-key'),
        luma_key:       get('u-luma-key'),
        runway_key:     get('u-runway-key'),
        ollama_model:   get('u-ollama-model'),
        ollama_enabled: document.getElementById('u-ollama-enabled')?.checked ? 1 : 0,
      }),
    });
    toast('✅ API keys saved to your account!', 'success');
    loadModels(); // refresh model selector
  } catch (err) { toast(err.message, 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Tools Directory
// ─────────────────────────────────────────────────────────────────────────────

const AI_TOOLS = {
  'Text Generation': {
    free: [
      { name: 'Ollama',          desc: 'Run Llama, Mistral, Gemma locally. 100% free, 100% private.',  url: 'https://ollama.com',                  badge: '🦙 Local' },
      { name: 'Google Gemini',   desc: 'Gemini 1.5 Flash — free tier with generous limits.',           url: 'https://aistudio.google.com',         badge: '✨ Free tier' },
      { name: 'Claude.ai',       desc: 'Anthropic Claude — free tier for personal use.',               url: 'https://claude.ai',                   badge: '🤖 Free tier' },
      { name: 'ChatGPT',         desc: 'OpenAI GPT-4o mini — free tier available.',                    url: 'https://chat.openai.com',             badge: '🟢 Free tier' },
      { name: 'Groq',            desc: 'Blazing fast Llama/Mixtral inference. Generous free API.',     url: 'https://console.groq.com',            badge: '⚡ Free API' },
      { name: 'Perplexity',      desc: 'AI search + generation. Free tier available.',                 url: 'https://www.perplexity.ai',           badge: '🔍 Free' },
      { name: 'Mistral',         desc: 'French AI — free Le Chat + free API tier.',                    url: 'https://mistral.ai',                  badge: '🆓 Free API' },
      { name: 'Hugging Face',    desc: 'Access thousands of open models via free inference API.',      url: 'https://huggingface.co',              badge: '🤗 Free' },
      { name: 'Together AI',     desc: 'Open source models with free $5 starter credits.',             url: 'https://www.together.ai',             badge: '💰 Free credits' },
      { name: 'Cohere',          desc: 'Command R+ — free trial API for text tasks.',                  url: 'https://cohere.com',                  badge: '🆓 Trial' },
    ],
    paid: [
      { name: 'OpenAI GPT-4o',   desc: '$5/1M input tokens. Best for complex reasoning tasks.',        url: 'https://platform.openai.com',         badge: '💲 $5/1M' },
      { name: 'Claude Opus',     desc: '$15/1M tokens. Anthropic\'s most capable model.',              url: 'https://console.anthropic.com',       badge: '💲 $15/1M' },
      { name: 'Gemini Pro 1.5',  desc: '$3.5/1M tokens. Best price/performance for long context.',     url: 'https://aistudio.google.com',         badge: '💲 $3.5/1M' },
      { name: 'Groq API',        desc: '$0.27/1M tokens. Fastest inference available.',                url: 'https://console.groq.com',            badge: '💲 $0.27/1M' },
      { name: 'Mistral Large',   desc: '$8/1M tokens. Strong multilingual & coding model.',            url: 'https://mistral.ai',                  badge: '💲 $8/1M' },
      { name: 'Cohere C4AI',     desc: '$3/1M tokens. Great for RAG and enterprise tasks.',            url: 'https://cohere.com',                  badge: '💲 $3/1M' },
      { name: 'AWS Bedrock',     desc: 'Access all major models via AWS infrastructure.',              url: 'https://aws.amazon.com/bedrock',      badge: '☁️ AWS' },
      { name: 'Azure OpenAI',    desc: 'OpenAI models with enterprise security and SLAs.',             url: 'https://azure.microsoft.com/ai',      badge: '☁️ Azure' },
      { name: 'Vertex AI',       desc: 'Google Cloud — Gemini + Claude + Llama on cloud.',             url: 'https://cloud.google.com/vertex-ai',  badge: '☁️ GCP' },
      { name: 'Fireworks AI',    desc: '$0.20/1M tokens. Fast open-source model hosting.',             url: 'https://fireworks.ai',                badge: '💲 $0.20/1M' },
    ],
  },
  'Image Generation': {
    free: [
      { name: 'ComfyUI (Local)', desc: 'Most powerful local image gen. Stable Diffusion + Flux.',      url: 'https://github.com/comfyanonymous/ComfyUI', badge: '🖥️ Local' },
      { name: 'Stable Diffusion',desc: 'AUTOMATIC1111 WebUI — run any model locally.',                 url: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui', badge: '🖥️ Local' },
      { name: 'Bing Image Creator',desc: 'DALL-E based. Free with Microsoft account.',                 url: 'https://www.bing.com/images/create',   badge: '🆓 Free' },
      { name: 'Adobe Firefly',   desc: 'Commercially safe AI images. Free tier available.',            url: 'https://firefly.adobe.com',           badge: '🆓 Free tier' },
      { name: 'Canva AI',        desc: 'Text-to-image inside Canva. Free plan available.',             url: 'https://www.canva.com',               badge: '🆓 Free tier' },
      { name: 'Ideogram',        desc: 'Great for text-in-image. Free tier available.',                url: 'https://ideogram.ai',                 badge: '🆓 Free' },
      { name: 'Leonardo AI',     desc: '150 free tokens/day. High quality anime/art styles.',          url: 'https://leonardo.ai',                 badge: '🆓 150/day' },
      { name: 'NightCafe',       desc: 'Free credits daily. Many art styles.',                         url: 'https://creator.nightcafe.studio',    badge: '🆓 Daily credits' },
      { name: 'Craiyon',         desc: 'Unlimited free image generation (slower).',                    url: 'https://www.craiyon.com',             badge: '🆓 Unlimited' },
      { name: 'DreamStudio',     desc: 'Stability AI official — 25 free credits on signup.',           url: 'https://dreamstudio.ai',              badge: '🆓 25 credits' },
    ],
    paid: [
      { name: 'Stability AI API',desc: '$0.01/image. SDXL + SD3 via API. Best for apps.',             url: 'https://stability.ai',                badge: '💲 $0.01' },
      { name: 'DALL-E 3 API',    desc: '$0.04/image. OpenAI\'s best image model.',                    url: 'https://platform.openai.com',         badge: '💲 $0.04' },
      { name: 'Midjourney',      desc: '$10/mo. Best artistic quality. Discord-based.',                url: 'https://www.midjourney.com',          badge: '💲 $10/mo' },
      { name: 'Flux Pro API',    desc: '$0.05/image. State-of-art image quality (2024).',              url: 'https://replicate.com/black-forest-labs', badge: '💲 $0.05' },
      { name: 'Adobe Firefly API',desc: '$0.02/image. Commercially safe, no copyright issues.',       url: 'https://developer.adobe.com/firefly', badge: '💲 $0.02' },
      { name: 'Ideogram API',    desc: '$0.08/image. Best for text inside images.',                    url: 'https://ideogram.ai/api',             badge: '💲 $0.08' },
      { name: 'Leonardo API',    desc: '$10/mo. Anime, concept art, product images.',                  url: 'https://leonardo.ai',                 badge: '💲 $10/mo' },
      { name: 'Imagen 3',        desc: 'Google\'s best image model. Available via Vertex AI.',         url: 'https://cloud.google.com/vertex-ai',  badge: '☁️ GCP' },
      { name: 'Recraft AI',      desc: '$15/mo. SVG + consistent brand image generation.',             url: 'https://www.recraft.ai',              badge: '💲 $15/mo' },
      { name: 'Getimg.ai',       desc: '$12/mo. 3000+ models including fine-tunes.',                   url: 'https://getimg.ai',                   badge: '💲 $12/mo' },
    ],
  },
  'Video Generation': {
    free: [
      { name: 'Stable Video (Local)', desc: 'Animate images locally with Stability AI SVD.',          url: 'https://stability.ai/stable-video',   badge: '🖥️ Local' },
      { name: 'Kling AI',        desc: 'High quality video. Free tier with limited credits.',          url: 'https://klingai.com',                 badge: '🆓 Free tier' },
      { name: 'Pika',            desc: 'AI video creation. Free tier available.',                      url: 'https://pika.art',                    badge: '🆓 Free' },
      { name: 'CapCut AI',       desc: 'Free AI video editing and generation. Mobile + web.',          url: 'https://www.capcut.com',              badge: '🆓 Free' },
      { name: 'Canva Video AI',  desc: 'AI video with templates. Free plan available.',                url: 'https://www.canva.com',               badge: '🆓 Free tier' },
      { name: 'InVideo AI',      desc: 'Text-to-video. Free tier with watermark.',                     url: 'https://invideo.io',                  badge: '🆓 Free tier' },
      { name: 'HeyGen',          desc: 'AI avatars and video. Free trial.',                            url: 'https://www.heygen.com',              badge: '🆓 Trial' },
      { name: 'Synthesia',       desc: 'AI presenter videos. Free trial.',                             url: 'https://www.synthesia.io',            badge: '🆓 Trial' },
      { name: 'Runway (Trial)',  desc: '125 free credits. Professional AI video.',                     url: 'https://runwayml.com',                badge: '💰 125 credits' },
      { name: 'Luma (Trial)',    desc: '30 free videos/month. Photorealistic quality.',                url: 'https://lumalabs.ai',                 badge: '🆓 30/month' },
    ],
    paid: [
      { name: 'Luma Dream Machine', desc: '$29/mo. Best image-to-video. NEXUS integrated.',           url: 'https://lumalabs.ai',                 badge: '💲 $29/mo' },
      { name: 'Runway Gen-3',    desc: '$15/mo. 625 credits. Professional video gen.',                 url: 'https://runwayml.com',                badge: '💲 $15/mo' },
      { name: 'Kling AI Pro',    desc: '$10/mo. Chinese model, excellent quality.',                    url: 'https://klingai.com',                 badge: '💲 $10/mo' },
      { name: 'Pika 2.0',        desc: '$8/mo. 150 videos/month. Good for social.',                   url: 'https://pika.art',                    badge: '💲 $8/mo' },
      { name: 'HeyGen',          desc: '$29/mo. Best for talking avatar videos.',                      url: 'https://www.heygen.com',              badge: '💲 $29/mo' },
      { name: 'Synthesia',       desc: '$22/mo. AI presenter for training & marketing.',               url: 'https://www.synthesia.io',            badge: '💲 $22/mo' },
      { name: 'Sora (OpenAI)',   desc: 'In ChatGPT Plus $20/mo. 50 videos/month.',                    url: 'https://sora.com',                    badge: '💲 $20/mo' },
      { name: 'Veo 2 (Google)',  desc: 'Google\'s most advanced video model. Enterprise.',             url: 'https://deepmind.google/veo',         badge: '☁️ Enterprise' },
      { name: 'Minimax',         desc: '$0.14/video. Good quality, API available.',                    url: 'https://minimaxi.com',                badge: '💲 $0.14' },
      { name: 'Lightricks LTX',  desc: '$10/mo. Real-time video generation.',                         url: 'https://www.lightricks.com',          badge: '💲 $10/mo' },
    ],
  },
  'SEO Tools': {
    free: [
      { name: 'Google Search Console', desc: 'Free keyword data, ranking, click analytics.',          url: 'https://search.google.com/search-console', badge: '🆓 Free' },
      { name: 'Ubersuggest (Free)', desc: '3 searches/day. Keywords, competitor analysis.',           url: 'https://neilpatel.com/ubersuggest',    badge: '🆓 3/day' },
      { name: 'Google Keyword Planner', desc: 'Free keyword research via Google Ads account.',        url: 'https://ads.google.com',              badge: '🆓 Free' },
      { name: 'AnswerThePublic', desc: 'Visual keyword research. 3 free searches/day.',               url: 'https://answerthepublic.com',         badge: '🆓 3/day' },
      { name: 'Yoast SEO',       desc: 'Free WordPress plugin for on-page SEO optimization.',         url: 'https://yoast.com',                   badge: '🆓 WordPress' },
      { name: 'SEOquake',        desc: 'Free browser extension for SEO metrics.',                     url: 'https://www.seoquake.com',            badge: '🆓 Extension' },
      { name: 'Moz Bar',         desc: 'Free DA/PA checker browser extension.',                       url: 'https://moz.com/products/pro/seo-toolbar', badge: '🆓 Extension' },
      { name: 'Keyword Surfer',  desc: 'Free Chrome extension for keyword volumes in SERPs.',         url: 'https://surferseo.com/keyword-surfer-extension', badge: '🆓 Extension' },
      { name: 'Rank Math (Free)',desc: 'Free WordPress SEO plugin with AI suggestions.',              url: 'https://rankmath.com',                badge: '🆓 WordPress' },
      { name: 'Screaming Frog',  desc: 'Free for up to 500 URLs. Best site crawler.',                 url: 'https://www.screamingfrog.co.uk',     badge: '🆓 500 URLs' },
    ],
    paid: [
      { name: 'Ahrefs',          desc: '$99/mo. Most complete SEO tool. Best backlink data.',          url: 'https://ahrefs.com',                  badge: '💲 $99/mo' },
      { name: 'Semrush',         desc: '$130/mo. Comprehensive SEO + competitor + ads.',              url: 'https://www.semrush.com',             badge: '💲 $130/mo' },
      { name: 'Moz Pro',         desc: '$99/mo. Industry standard. DA/PA metrics.',                   url: 'https://moz.com',                     badge: '💲 $99/mo' },
      { name: 'Surfer SEO',      desc: '$89/mo. AI content optimization for rankings.',               url: 'https://surferseo.com',               badge: '💲 $89/mo' },
      { name: 'SE Ranking',      desc: '$55/mo. Best value full-suite SEO platform.',                 url: 'https://seranking.com',               badge: '💲 $55/mo' },
      { name: 'Ubersuggest Pro', desc: '$12/mo. Keyword + content + backlink tools.',                 url: 'https://neilpatel.com',               badge: '💲 $12/mo' },
      { name: 'Clearscope',      desc: '$170/mo. AI content optimization for SEO writers.',           url: 'https://www.clearscope.io',           badge: '💲 $170/mo' },
      { name: 'Mangools',        desc: '$29/mo. Beginner-friendly. KWFinder + SERPChecker.',          url: 'https://mangools.com',                badge: '💲 $29/mo' },
      { name: 'SpyFu',           desc: '$39/mo. Best for competitor PPC & SEO spying.',               url: 'https://www.spyfu.com',               badge: '💲 $39/mo' },
      { name: 'Majestic SEO',    desc: '$50/mo. Best backlink database and Trust Flow.',              url: 'https://majestic.com',                badge: '💲 $50/mo' },
    ],
  },
  'Email Marketing': {
    free: [
      { name: 'Brevo (Sendinblue)', desc: '300 emails/day free. Full marketing platform.',           url: 'https://www.brevo.com',               badge: '🆓 300/day' },
      { name: 'Mailchimp',       desc: '500 contacts, 1000 sends/month free.',                        url: 'https://mailchimp.com',               badge: '🆓 500 contacts' },
      { name: 'MailerLite',      desc: '1000 subscribers, 12k emails/month free.',                    url: 'https://www.mailerlite.com',          badge: '🆓 1k subs' },
      { name: 'Klaviyo',         desc: '500 emails/month free. Best for e-commerce.',                 url: 'https://www.klaviyo.com',             badge: '🆓 500/mo' },
      { name: 'HubSpot Email',   desc: '2000 emails/month in HubSpot free CRM.',                      url: 'https://www.hubspot.com',             badge: '🆓 2k/mo' },
      { name: 'Omnisend',        desc: '500 emails/month. Good for WooCommerce/Shopify.',             url: 'https://www.omnisend.com',            badge: '🆓 500/mo' },
      { name: 'Sender',          desc: '2500 subscribers, 15k emails/month free.',                    url: 'https://www.sender.net',              badge: '🆓 2.5k subs' },
      { name: 'Benchmark Email', desc: '500 subscribers, 3500 emails/month free.',                    url: 'https://www.benchmarkemail.com',      badge: '🆓 500 subs' },
      { name: 'Elastic Email',   desc: '100 emails/day free. API-first platform.',                    url: 'https://elasticemail.com',            badge: '🆓 100/day' },
      { name: 'Gmail + Google Apps Script', desc: 'Free bulk email via personal Gmail. 500/day.',    url: 'https://script.google.com',           badge: '🆓 500/day' },
    ],
    paid: [
      { name: 'Klaviyo',         desc: '$45/mo. Best ROI for e-commerce email + SMS.',                url: 'https://www.klaviyo.com',             badge: '💲 $45/mo' },
      { name: 'ActiveCampaign',  desc: '$29/mo. CRM + email + automation powerhouse.',                url: 'https://www.activecampaign.com',      badge: '💲 $29/mo' },
      { name: 'Mailchimp Pro',   desc: '$13/mo. Industry standard. Good analytics.',                  url: 'https://mailchimp.com',               badge: '💲 $13/mo' },
      { name: 'ConvertKit',      desc: '$25/mo. Best for creators and newsletters.',                  url: 'https://convertkit.com',              badge: '💲 $25/mo' },
      { name: 'Drip',            desc: '$39/mo. E-commerce focused automation.',                      url: 'https://www.drip.com',                badge: '💲 $39/mo' },
      { name: 'SendGrid',        desc: '$20/mo. Developer-friendly. Best deliverability.',            url: 'https://sendgrid.com',                badge: '💲 $20/mo' },
      { name: 'Mailgun',         desc: '$35/mo. API-first. Used by large enterprises.',               url: 'https://www.mailgun.com',             badge: '💲 $35/mo' },
      { name: 'Campaign Monitor',desc: '$11/mo. Beautiful templates. Easy to use.',                   url: 'https://www.campaignmonitor.com',     badge: '💲 $11/mo' },
      { name: 'Brevo Pro',       desc: '$25/mo. Unlimited contacts + CRM + SMS.',                    url: 'https://www.brevo.com',               badge: '💲 $25/mo' },
      { name: 'Amazon SES',      desc: '$0.10/1000 emails. Cheapest at scale. AWS.',                  url: 'https://aws.amazon.com/ses',          badge: '💲 $0.10/1k' },
    ],
  },
  'Social Media Management': {
    free: [
      { name: 'NEXUS (This App)', desc: 'Free, local, AI-powered social marketing suite.',            url: 'http://localhost:3000',               badge: '⚡ You are here' },
      { name: 'Buffer (Free)',    desc: '3 channels, 10 scheduled posts free.',                       url: 'https://buffer.com',                  badge: '🆓 3 channels' },
      { name: 'Later (Free)',     desc: '30 posts/month per social profile.',                          url: 'https://later.com',                   badge: '🆓 30 posts/mo' },
      { name: 'Zoho Social',     desc: '1 user, 1 brand free. Good all-round tool.',                  url: 'https://www.zoho.com/social',         badge: '🆓 1 brand' },
      { name: 'Hootsuite (Trial)',desc: '30-day free trial. Industry leader.',                         url: 'https://hootsuite.com',               badge: '🆓 30-day trial' },
      { name: 'Canva',           desc: 'Free design tool with social publishing.',                     url: 'https://www.canva.com',               badge: '🆓 Free' },
      { name: 'Facebook Creator Studio', desc: 'Free Meta tool for FB + Instagram scheduling.',       url: 'https://business.facebook.com',       badge: '🆓 Free' },
      { name: 'TweetDeck',       desc: 'Free Twitter/X management and scheduling.',                   url: 'https://tweetdeck.twitter.com',       badge: '🆓 Free' },
      { name: 'Followerwonk',    desc: 'Free Twitter analytics and follower management.',              url: 'https://followerwonk.com',            badge: '🆓 Free' },
      { name: 'Metricool (Free)',desc: '50 posts/month free. Analytics included.',                    url: 'https://metricool.com',               badge: '🆓 50 posts/mo' },
    ],
    paid: [
      { name: 'Hootsuite',       desc: '$99/mo. Enterprise social management leader.',                url: 'https://hootsuite.com',               badge: '💲 $99/mo' },
      { name: 'Sprout Social',   desc: '$249/mo. Best analytics + team collaboration.',              url: 'https://sproutsocial.com',            badge: '💲 $249/mo' },
      { name: 'Buffer Pro',      desc: '$6/mo. Simple, clean, affordable scheduling.',               url: 'https://buffer.com',                  badge: '💲 $6/mo' },
      { name: 'ContentStudio',   desc: '$25/mo. AI content + scheduling all-in-one.',               url: 'https://contentstudio.io',            badge: '💲 $25/mo' },
      { name: 'Agorapulse',      desc: '$79/mo. Best inbox management + team features.',             url: 'https://www.agorapulse.com',          badge: '💲 $79/mo' },
      { name: 'SocialBee',       desc: '$29/mo. Category-based scheduling + AI writer.',             url: 'https://socialbee.com',               badge: '💲 $29/mo' },
      { name: 'Publer',          desc: '$12/mo. Great value. Bulk scheduling + AI.',                 url: 'https://publer.io',                   badge: '💲 $12/mo' },
      { name: 'Metricool',       desc: '$22/mo. Analytics + scheduling + link in bio.',              url: 'https://metricool.com',               badge: '💲 $22/mo' },
      { name: 'Sendible',        desc: '$29/mo. Agency-friendly multi-client management.',           url: 'https://www.sendible.com',            badge: '💲 $29/mo' },
      { name: 'Iconosquare',     desc: '$49/mo. Best Instagram analytics + scheduling.',             url: 'https://www.iconosquare.com',         badge: '💲 $49/mo' },
    ],
  },
};

function renderToolsDirectory() {
  const container = document.getElementById('tools-directory-content');
  if (!container) return;

  container.innerHTML = Object.entries(AI_TOOLS).map(([category, { free, paid }]) => `
    <div style="margin-bottom:32px">
      <div class="section-title" style="margin-bottom:16px">${category}</div>
      <div class="grid-2">
        <!-- Free -->
        <div class="card">
          <div class="card-header">
            <div class="card-title" style="color:var(--accent-green)">🆓 Free Tools</div>
            <span class="badge badge-green">${free.length} tools</span>
          </div>
          <div class="card-body" style="padding:0">
            ${free.map(t => toolCard(t)).join('')}
          </div>
        </div>
        <!-- Paid -->
        <div class="card">
          <div class="card-header">
            <div class="card-title" style="color:var(--accent-orange)">💲 Paid Tools</div>
            <span class="badge badge-orange">${paid.length} tools</span>
          </div>
          <div class="card-body" style="padding:0">
            ${paid.map(t => toolCard(t)).join('')}
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function toolCard(t) {
  return `
    <a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--border);text-decoration:none;transition:var(--transition);"
       onmouseover="this.style.background='var(--glass)'" onmouseout="this.style.background='none'">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(t.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;line-height:1.4">${escapeHtml(t.desc)}</div>
      </div>
      <span class="badge badge-${t.badge.includes('🆓')||t.badge.includes('Local')||t.badge.includes('Free')||t.badge.includes('free') ? 'green' : t.badge.includes('💲') ? 'orange' : 'purple'}" style="font-size:10px;flex-shrink:0;white-space:nowrap">${escapeHtml(t.badge)}</span>
    </a>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Auth check — redirect to login if not authenticated
  const authed = await checkAuth();
  if (!authed) return;

  initPlatformSelectors();
  initTheme();
  handleURLParams();

  // Restore API key
  if (State.anthropicKey) {
    const keyInput = document.getElementById('setting-anthropic-key');
    if (keyInput) keyInput.value = State.anthropicKey;
  }

  // Set default post mode
  setPostMode('now');

  // Load initial page
  navigateTo('dashboard');

  // Poll status every 60s
  setInterval(refreshStatus, 60000);

  // Live brand preview
  ['brand-name','brand-tagline','brand-logo','brand-primary-hex','brand-secondary-hex','brand-accent-hex'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateBrandPreview);
  });
  ['brand-primary-color','brand-secondary-color','brand-accent-color'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      const type = id.replace('brand-','').replace('-color','');
      const hexEl = document.getElementById(`brand-${type}-hex`);
      if (hexEl) { hexEl.value = el.value; updateBrandPreview(); }
    });
  });

  console.log('NEXUS v2.0 initialized ⚡ — Full Digital Marketing Suite');
});
