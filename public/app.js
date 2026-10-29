/* ─────────────────────────────────────────────────────────────────────────────
   Social-Nexus — Frontend Application Script
   ───────────────────────────────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────────────────────────
const State = {
  currentPage: 'dashboard',
  platformStatus: {},
  selectedTone: 'professional',
  postMode: 'schedule', // safer default: nothing goes out by accident
  calendarDate: new Date(),
  scheduledPosts: [],
  generatedContent: '',
  selectedFileContent: '',
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
  dashboard: { title: 'Home',                   subtitle: 'Your posts, schedule and next steps' },
  generate:  { title: 'AI Writer',              subtitle: 'Write a version for each platform with AI' },
  compose:   { title: 'Create Post',            subtitle: 'Write, then publish or schedule' },
  calendar:  { title: 'Calendar',               subtitle: 'Everything scheduled, published and in progress' },
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
  clients:           { title: 'Clients & Brands',    subtitle: 'Manage client brand workspaces and isolated social media channels' },
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
  // Pages under "More tools": keep that group open so the current page is visible
  if (document.getElementById(`nav-${page}`)?.closest('#nav-more')) toggleMoreTools(true);

  // Compose opens in "Schedule" mode with a time 1 hour ahead (unless one is already picked)
  if (page === 'compose') setPostMode(State.postMode);

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
    clients:          loadClients,
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
  if (body) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error('Can’t reach the Social-Nexus server. Make sure the app is running, then try again.');
  }
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) { window.location.href = '/login.html'; return; }
  if (!res.ok) {
    if (data.error) throw new Error(data.error);
    // No message from the server: say what it means instead of "HTTP 404"
    if (res.status === 404) throw new Error('The app’s server doesn’t know this action. It was probably started before an update: close Social-Nexus completely and start it again.');
    if (res.status >= 500) throw new Error('Something went wrong in the app’s server. Try again; if it keeps happening, restart Social-Nexus.');
    throw new Error(`The request failed (error ${res.status}). Try again.`);
  }
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
  // Messages often contain server errors or user data — always plain text
  const icon = document.createElement('span');
  icon.textContent = icons[type] || 'ℹ️';
  el.append(icon, ` ${message}`);
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
        if (container.id === 'compose-platforms') updateComposeCharCount();
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
  const all = Object.values(State.platformStatus);
  const count = all.filter(s => s?.connected).length;
  setEl('stat-platforms', `${count}/${all.length || 8}`);
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
    // Count only posts that actually went out on at least one platform
    setEl('stat-total-posts', posts.filter(p => p.status !== 'failed').length);
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
  const targets = platform ? [platform] : (State.generatedPlatforms || []);
  if (!startNewCompose({ text, platforms: targets })) return;
  toast('Opened in Create Post', 'success');
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

// ─────────────────────────────────────────────────────────────────────────────
// Compose & Post
// ─────────────────────────────────────────────────────────────────────────────

// Character limits for a post's text on each network
const PLATFORM_CHAR_LIMITS = {
  twitter: 280, pinterest: 500, google_business: 1500, instagram: 2200,
  tiktok: 2200, linkedin: 3000, youtube: 5000, facebook: 63206,
};
const PLATFORM_NEEDS_MEDIA = { instagram: 'an image', tiktok: 'a video' };

// Warnings for the current Compose text/platforms, checked before posting too
function composeWarnings() {
  const content = document.getElementById('compose-content').value;
  const hasMedia = !!document.getElementById('compose-image').value.trim();
  const warnings = [];
  for (const p of getSelectedPlatforms('compose-platforms')) {
    const label = PLATFORMS[p]?.label || p;
    const limit = PLATFORM_CHAR_LIMITS[p];
    if (limit && content.length > limit) warnings.push(`${label} allows ${limit} characters — this post has ${content.length}.`);
    if (PLATFORM_NEEDS_MEDIA[p] && !hasMedia) warnings.push(`${label} needs ${PLATFORM_NEEDS_MEDIA[p]} — add an image/video URL.`);
  }
  return warnings;
}

function updateComposeCharCount() {
  const content = document.getElementById('compose-content').value;
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
  const content = document.getElementById('compose-content').value.trim();
  const platforms = getSelectedPlatforms('compose-platforms');
  const image_url = document.getElementById('compose-image').value.trim() || null;
  return { content, platforms, image_url };
}

function resetCompose() {
  State.composeDraftId = null;
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
  const { content, platforms, image_url } = composeFields();
  return JSON.stringify([content, [...platforms].sort(), image_url || '']);
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
  if (image_url) document.getElementById('compose-image').value = image_url;
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
  document.getElementById('compose-image').value = item.image_url || '';
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
  return (typeof ModelState !== 'undefined' && ModelState.textModel?.id) || null;
}

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
  const { content, platforms, image_url } = composeFields();
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
        const patch = { body: content, platforms, image_url, expected_updated_at: editing.updated_at };
        if (content !== (State.composeSavedText || '').trim()) patch.title = null; // name follows the new text
        updated = await api('PATCH', `/api/content/${editing.id}`, patch);
      } catch (err) {
        // Keep the person's work: offer to save it as a separate new draft
        if (editing.workspaceId === currentWorkspaceId
            && confirm(`Couldn’t save your changes to the existing post: ${err.message}\n\nSave your text as a new draft instead?`)) {
          State.composeEditing = null;
          State.composeDraftId = null;
          document.getElementById('compose-editing').hidden = true;
          const created = await api('POST', '/api/content', { body: content, platforms, image_url });
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
          await api('PATCH', `/api/content/${State.composeDraftId}`, { body: content, platforms, image_url });
        } catch { State.composeDraftId = null; } // gone or no longer editable: save a new one
      }
      if (!State.composeDraftId) {
        const created = await api('POST', '/api/content', { body: content, platforms, image_url });
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

// ─────────────────────────────────────────────────────────────────────────────
// Content Calendar & Unified Content Model (Phase 1b)
// ─────────────────────────────────────────────────────────────────────────────

State.calendarView = 'week';
State.calendarEvents = [];
State.selectedContentItem = null;
State.userWorkspaces = [];

function changeCalendarView(view) {
  State.calendarView = view;
  ['week', 'month', 'agenda'].forEach(v => {
    const btn = document.getElementById(`view-btn-${v}`);
    if (btn) {
      if (v === view) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  // Adjust calendar-grid layout class
  const grid = document.getElementById('calendar-grid');
  if (grid) {
    grid.className = `calendar-grid ${view}-view`;
  }

  renderCalendar(State.calendarDate);
}

function navigateCalendar(dir) {
  const date = State.calendarDate;
  if (State.calendarView === 'week') {
    date.setDate(date.getDate() + dir * 7);
  } else {
    // Month or Agenda: navigate by month
    date.setMonth(date.getMonth() + dir);
  }
  State.calendarDate = date;
  renderCalendar(date);
}

// Backward compatibility helper
function changeMonth(dir) {
  navigateCalendar(dir);
}

async function renderCalendar(date) {
  if (!currentWorkspaceId) {
    const grid = document.getElementById('calendar-grid');
    if (grid) grid.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px">Please select a workspace context first.</div>';
    return;
  }

  // Calculate start/end of view
  let start, end;
  const year = date.getFullYear();
  const month = date.getMonth();

  if (State.calendarView === 'week') {
    start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const formatOptions = { month: 'short', day: 'numeric' };
    document.getElementById('calendar-date-label').textContent = 
      `${start.toLocaleDateString('en', formatOptions)} – ${end.toLocaleDateString('en', formatOptions)}, ${start.getFullYear()}`;
  } else if (State.calendarView === 'month') {
    // Month view shows surrounding filler days (up to 42 cells)
    const firstOfMonth = new Date(year, month, 1);
    const startDay = firstOfMonth.getDay();
    start = new Date(year, month, 1 - startDay);
    start.setHours(0, 0, 0, 0);

    end = new Date(start);
    end.setDate(start.getDate() + 41);
    end.setHours(23, 59, 59, 999);

    document.getElementById('calendar-date-label').textContent = 
      date.toLocaleDateString('en', { month: 'long', year: 'numeric' });
  } else {
    // Agenda: whole current month
    start = new Date(year, month, 1, 0, 0, 0);
    end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    document.getElementById('calendar-date-label').textContent = 
      `Agenda: ${date.toLocaleDateString('en', { month: 'long', year: 'numeric' })}`;
  }

  const from = Math.floor(start.getTime() / 1000);
  const to = Math.floor(end.getTime() / 1000);

  try {
    const events = await api('GET', `/api/content/calendar?from=${from}&to=${to}`);
    State.calendarEvents = events;
    renderCalendarData();
  } catch (err) {
    console.error('Error fetching calendar data:', err);
    toast('Error fetching calendar content items', 'error');
  }
}

function renderCalendarData() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;

  const activeStatuses = Array.from(document.querySelectorAll('#calendar-filters input[type="checkbox"]:checked'))
    .map(el => el.value);

  const filteredEvents = State.calendarEvents.filter(e => activeStatuses.includes(e.status));

  if (State.calendarView === 'week') {
    renderWeekView(State.calendarDate, filteredEvents);
  } else if (State.calendarView === 'month') {
    renderMonthView(State.calendarDate, filteredEvents);
  } else {
    renderAgendaView(State.calendarDate, filteredEvents);
  }
}

function renderWeekView(date, events) {
  const grid = document.getElementById('calendar-grid');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  // Find start of week
  const startOfWeek = new Date(date);
  startOfWeek.setDate(date.getDate() - date.getDay());

  let html = days.map(d => `<div class="calendar-day-label">${d}</div>`).join('');

  for (let i = 0; i < 7; i++) {
    const currentDay = new Date(startOfWeek);
    currentDay.setDate(startOfWeek.getDate() + i);
    const isToday = currentDay.toDateString() === today.toDateString();
    
    // Filter events for this specific date
    const dayEvents = events.filter(e => {
      const ed = e.scheduled_at ? new Date(e.scheduled_at * 1000) : new Date(e.created_at * 1000);
      return ed.toDateString() === currentDay.toDateString();
    });

    // Sort by scheduled time, then created time
    dayEvents.sort((a, b) => (a.scheduled_at || a.created_at) - (b.scheduled_at || b.created_at));

    html += `
      <div class="calendar-day ${isToday ? 'today' : ''}" style="min-height: 250px">
        <div class="calendar-day-num" style="display:flex;justify-content:space-between;align-items:center">
          <span>${currentDay.getDate()}</span>
          <span style="font-size:10px;opacity:0.6">${currentDay.toLocaleDateString('en', {month:'short'})}</span>
        </div>
        <div style="margin-top:8px">
          ${dayEvents.map(e => {
            const timeLabel = e.scheduled_at 
              ? new Date(e.scheduled_at * 1000).toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'}) 
              : 'Draft';
            const titleSnippet = escapeHtml(e.title || e.body.substring(0, 35) + (e.body.length > 35 ? '…' : ''));
            const platformIcons = e.platforms.map(p => PLATFORMS[p]?.icon || '').join('');
            return `
              <div class="calendar-event-card event-status-${e.status}" onclick="openContentDetail(${e.id})">
                <div style="font-weight:700;font-size:10px;display:flex;justify-content:space-between">
                  <span>${timeLabel}</span>
                  <span>${platformIcons}</span>
                </div>
                <div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${titleSnippet}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  grid.innerHTML = html;
}

function renderMonthView(date, events) {
  const grid = document.getElementById('calendar-grid');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  const year = date.getFullYear();
  const month = date.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startDay = firstOfMonth.getDay();

  let html = days.map(d => `<div class="calendar-day-label">${d}</div>`).join('');

  // 42 cells total (6 weeks)
  const cellStartDate = new Date(year, month, 1 - startDay);

  for (let i = 0; i < 42; i++) {
    const currentDay = new Date(cellStartDate);
    currentDay.setDate(cellStartDate.getDate() + i);
    
    const isToday = currentDay.toDateString() === today.toDateString();
    const isOtherMonth = currentDay.getMonth() !== month;

    const dayEvents = events.filter(e => {
      const ed = e.scheduled_at ? new Date(e.scheduled_at * 1000) : new Date(e.created_at * 1000);
      return ed.toDateString() === currentDay.toDateString();
    });

    dayEvents.sort((a, b) => (a.scheduled_at || a.created_at) - (b.scheduled_at || b.created_at));

    html += `
      <div class="calendar-day ${isToday ? 'today' : ''} ${isOtherMonth ? 'other-month' : ''}" style="min-height: 100px">
        <div class="calendar-day-num">${currentDay.getDate()}</div>
        <div style="margin-top:4px">
          ${dayEvents.map(e => {
            const titleSnippet = escapeHtml(e.title || e.body.substring(0, 15) + (e.body.length > 15 ? '…' : ''));
            const timeLabel = e.scheduled_at 
              ? new Date(e.scheduled_at * 1000).toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit', hour12:false}) 
              : 'D';
            return `
              <div class="calendar-event-card event-status-${e.status}" onclick="openContentDetail(${e.id})" style="padding:3px 6px;margin-bottom:2px;border-radius:4px;font-size:10px">
                <span style="font-weight:700;opacity:0.8">${timeLabel}: ${titleSnippet}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  grid.innerHTML = html;
}

function renderAgendaView(date, events) {
  const grid = document.getElementById('calendar-grid');
  if (!events.length) {
    grid.innerHTML = `
      <div class="empty-state" style="padding:40px 0">
        <div class="empty-icon">📅</div>
        <div class="empty-title">No content scheduled</div>
        <div class="empty-desc">Create content items or change the filter status to see items in the agenda.</div>
      </div>`;
    return;
  }

  // Sort events chronologically
  const sorted = [...events].sort((a, b) => (a.scheduled_at || a.created_at) - (b.scheduled_at || b.created_at));

  // Group events by date string
  const groups = {};
  sorted.forEach(e => {
    const d = e.scheduled_at ? new Date(e.scheduled_at * 1000) : new Date(e.created_at * 1000);
    const dateStr = d.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(e);
  });

  let html = '';
  Object.entries(groups).forEach(([dateLabel, dayEvents]) => {
    html += `
      <div style="margin-bottom:20px">
        <div style="font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:4px">${dateLabel}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${dayEvents.map(e => {
            const timeLabel = e.scheduled_at 
              ? new Date(e.scheduled_at * 1000).toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'}) 
              : 'Not scheduled (Draft)';
            const platformsText = e.platforms.map(p => (PLATFORMS[p]?.icon || '') + ' ' + (PLATFORMS[p]?.label || p)).join(', ');
            return `
              <div class="scheduled-item" style="cursor:pointer" onclick="openContentDetail(${e.id})">
                <div class="scheduled-time" style="min-width: 100px">
                  <div style="font-size:12px;font-weight:700;color:#a78bfa">${timeLabel}</div>
                </div>
                <div class="scheduled-content">
                  <div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:4px">${escapeHtml(postTitle(e))}</div>
                  <div class="scheduled-text" style="-webkit-line-clamp: 2; line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden">${escapeHtml(e.body)}</div>
                  <div style="display:flex;gap:12px;align-items:center;margin-top:6px">
                    <span style="font-size:11px;color:var(--text-muted)">Channels: ${platformsText}</span>
                    <span class="badge event-status-${e.status}" style="font-size:9.5px;padding:2px 8px">${statusLabel(e.status)}</span>
                  </div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openContentDetail(${e.id})">View Details</button>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  });

  grid.innerHTML = html;
}

// ── Role Gating & Permissions frontend helpers ───────────────────────────────

function getCurrentWorkspaceRole() {
  const current = State.userWorkspaces?.find(w => w.workspace_id === currentWorkspaceId);
  return current ? current.role : null;
}

function hasWorkspacePermission(permission) {
  const role = getCurrentWorkspaceRole();
  if (!role) return false;
  const permissions = {
    manager:  ['social.manage','members.manage','content.create','content.edit','content.submit',
               'content.approve','content.comment','content.publish','content.schedule',
               'content.view','analytics.view'],
    creator:  ['content.create','content.edit','content.submit','content.view','analytics.view'],
    reviewer: ['content.approve','content.comment','content.view','analytics.view'],
    client:   ['content.approve','content.comment','content.view','analytics.view'],
    analyst:  ['content.view','analytics.view'],
  };
  return permissions[role]?.includes(permission) || false;
}

// ── Slide-in Detail Panel Logic ──────────────────────────────────────────────

// Friendly names for content statuses and people (instead of "in_review" / "User #3")
// A post's title, or its first words when it has none
function postTitle(item) {
  if (item?.title) return item.title;
  const words = String(item?.body || '').replace(/\s+/g, ' ').trim();
  return words ? (words.length > 48 ? `${words.slice(0, 48).trim()}…` : words) : 'Untitled post';
}

const STATUS_LABELS = { draft: 'Draft', in_review: 'In review', approved: 'Approved', scheduled: 'Scheduled', publishing: 'Publishing…', published: 'Published', failed: 'Failed' };
const statusLabel = (s) => STATUS_LABELS[s] || s;

State.memberNames = {};
async function loadMemberNames() {
  if (!currentWorkspaceId) return;
  try {
    const members = await fetch(`/workspaces/${currentWorkspaceId}/members`).then(r => r.json());
    for (const m of members || []) State.memberNames[m.user_id] = m.name || m.email;
  } catch {}
}
function userLabel(id) {
  if (!id) return 'someone';
  if (State.user && String(State.user.id) === String(id)) return 'you';
  return State.memberNames[id] || 'a team member';
}

async function openContentDetail(itemId) {
  try {
    const [item] = await Promise.all([api('GET', `/api/content/${itemId}`), loadMemberNames()]);
    State.selectedContentItem = item;

    // Set panel info
    document.getElementById('detail-status-badge').textContent = statusLabel(item.status);
    document.getElementById('detail-status-badge').className = `badge event-status-${item.status}`;
    // Part of a repeating schedule?
    const badge = document.getElementById('detail-status-badge');
    badge.parentElement.querySelector('.series-chip')?.remove();
    if (item.series_id) {
      const chip = document.createElement('span');
      chip.className = 'series-chip';
      chip.style.marginLeft = '6px';
      chip.textContent = `🔁 ${REPEAT_LABEL[item.series_every] || 'Repeats'} · post ${item.series_index} of ${item.series_total}`;
      badge.after(chip);
    }
    document.getElementById('detail-title-label').textContent = postTitle(item);
    document.getElementById('detail-body-container').textContent = item.body;
    
    // Image Preview
    const imgContainer = document.getElementById('detail-image-container');
    const imgPreview = document.getElementById('detail-image-preview');
    if (item.image_url) {
      imgPreview.src = item.image_url;
      imgContainer.style.display = 'block';
    } else {
      imgContainer.style.display = 'none';
      imgPreview.src = '';
    }

    // Error container
    const errContainer = document.getElementById('detail-error-container');
    if (item.status === 'failed' && item.error_message) {
      errContainer.textContent = `⚠️ Publish failed: ${item.error_message}`;
      errContainer.style.display = 'block';
    } else {
      errContainer.style.display = 'none';
    }

    // Channels
    const accountsContainer = document.getElementById('detail-accounts-list');
    accountsContainer.innerHTML = item.platforms.map(p => `
      <span class="badge badge-purple" style="display:inline-flex;align-items:center;gap:4px">
        <span>${PLATFORMS[p]?.icon || '🔗'}</span>
        <span>${PLATFORMS[p]?.label || p}</span>
      </span>
    `).join('');

    // Audit logs formatting
    const auditLogs = document.getElementById('detail-audit-logs');
    let auditHtml = `<div>📅 Created on ${new Date(item.created_at * 1000).toLocaleString()}</div>`;
    if (item.submitted_by) auditHtml += `<div>✍️ Created by ${escapeHtml(userLabel(item.submitted_by))}</div>`;
    if (item.reviewed_by) auditHtml += `<div>👀 Reviewed by ${escapeHtml(userLabel(item.reviewed_by))}</div>`;
    if (item.approved_by) auditHtml += `<div>✅ Approved by ${escapeHtml(userLabel(item.approved_by))}</div>`;
    if (item.scheduled_at) auditHtml += `<div>⏰ Scheduled for ${new Date(item.scheduled_at * 1000).toLocaleString()}</div>`;
    if (item.published_at) auditHtml += `<div>🚀 Published on ${new Date(item.published_at * 1000).toLocaleString()}</div>`;
    auditLogs.innerHTML = auditHtml;

    // Populate comments
    renderCommentsList(item.comments || []);

    // Render footer buttons dynamically based on roles
    renderDetailActionButtons(item);

    // Slide panel open
    document.getElementById('content-detail-backdrop').classList.add('open');
    document.getElementById('content-detail-panel').classList.add('open');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function closeContentDetail() {
  document.getElementById('content-detail-backdrop').classList.remove('open');
  document.getElementById('content-detail-panel').classList.remove('open');
  State.selectedContentItem = null;
}

function renderCommentsList(comments) {
  const container = document.getElementById('detail-comments-list');
  if (!comments || comments.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12.5px;text-align:center;padding:12px 0">No comments yet.</div>';
    return;
  }
  container.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-header">
        <span class="comment-author">${escapeHtml(userLabel(c.user_id))}</span>
        <span>${new Date(c.created_at).toLocaleString()}</span>
      </div>
      <div class="comment-body">${escapeHtml(c.body)}</div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

async function submitCommentDetail() {
  if (!State.selectedContentItem) return;
  const input = document.getElementById('detail-comment-input');
  const body = input.value.trim();
  if (!body) return;

  try {
    const comment = await api('POST', `/api/content/${State.selectedContentItem.id}/comments`, { body });
    if (!State.selectedContentItem.comments) State.selectedContentItem.comments = [];
    State.selectedContentItem.comments.push(comment);
    renderCommentsList(State.selectedContentItem.comments);
    input.value = '';
    toast('Comment added', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderDetailActionButtons(item) {
  const container = document.getElementById('detail-panel-actions');
  container.innerHTML = '';

  const canSubmit = hasWorkspacePermission('content.submit');
  const canApprove = hasWorkspacePermission('content.approve');
  const canSchedule = hasWorkspacePermission('content.schedule');
  const canEdit = hasWorkspacePermission('content.edit');

  const buttons = [];

  // People who may approve their own work schedule a draft in one step;
  // asking for review is only offered in Agency mode (or to those who can't approve)
  const selfApprove = canApprove && canSchedule;

  // Transition: Submit (draft -> in_review)
  if (item.status === 'draft' && canSubmit && (!selfApprove || isAgencyMode())) {
    buttons.push(`<button class="btn ${selfApprove ? 'btn-secondary' : 'btn-primary'}" onclick="transitionContentStatus(${item.id}, 'in_review')">📤 Ask for review</button>`);
  }

  // Transition: Approve/Reject (in_review -> approved / draft)
  if (item.status === 'in_review' && canApprove) {
    buttons.push(`<button class="btn btn-success" onclick="transitionContentStatus(${item.id}, 'approved')">✅ Approve</button>`);
    buttons.push(`<button class="btn btn-danger" onclick="transitionContentStatus(${item.id}, 'draft')">❌ Ask for changes</button>`);
  }

  // Transition: Cancel Approval (approved -> draft)
  if (item.status === 'approved' && canApprove) {
    buttons.push(`<button class="btn btn-danger" onclick="transitionContentStatus(${item.id}, 'draft')">↩️ Revoke Approval</button>`);
  }

  // Transition: Schedule (approved -> scheduled, or draft -> scheduled in one step)
  if ((item.status === 'approved' && canSchedule) || (item.status === 'draft' && selfApprove)) {
    buttons.push(`
      <div style="display:flex;align-items:center;gap:6px">
        <input type="datetime-local" class="form-input" id="detail-schedule-time" value="${toLocalInputValue(new Date(item.scheduled_at && item.scheduled_at * 1000 > Date.now() ? item.scheduled_at * 1000 : Date.now() + 3600000))}" title="${item.scheduled_at && item.scheduled_at * 1000 > Date.now() ? 'Suggested time from the author' : ''}" style="padding:6px 8px;font-size:12px;width:170px" />
        <button class="btn btn-primary" onclick="scheduleContentDetail(${item.id})">📅 Schedule</button>
      </div>`);
  }

  // Transition: Cancel Schedule (scheduled -> approved)
  if (item.status === 'scheduled' && canSchedule) {
    buttons.push(`<button class="btn btn-secondary" onclick="transitionContentStatus(${item.id}, 'approved')">📅 Unschedule</button>`);
  }

  // Stop a repeating schedule (removes its posts that haven't gone out yet)
  if (item.series_id && item.status === 'scheduled' && canSchedule) {
    buttons.push(`<button class="btn btn-secondary" onclick="stopSeries(${jsAttr(item.series_id)}, null).then(closeContentDetail)">⏹ Stop series</button>`);
  }

  // Retry a failed or missed post (goes out within about a minute)
  if (item.status === 'failed' && canSchedule) {
    buttons.push(`<button class="btn btn-primary" onclick="retryContentItem(${item.id})">🔁 Retry now</button>`);
  }

  // Edit / Delete
  if (canEdit) {
    if (['draft', 'in_review', 'failed'].includes(item.status)) {
      buttons.push(`<button class="btn btn-secondary btn-sm" onclick="openEditContentModal(${item.id})">✏️ Edit</button>`);
    }
    if (['draft', 'failed'].includes(item.status)) {
      buttons.push(`<button class="btn btn-danger btn-sm" onclick="deleteContentItem(${item.id})">🗑️ Delete</button>`);
    }
  }

  container.innerHTML = buttons.join('');
}

async function scheduleContentDetail(itemId) {
  const input = document.getElementById('detail-schedule-time');
  const dtStr = input?.value;
  if (!dtStr) return toast('Please select date and time', 'warning');
  
  const epoch = Math.floor(new Date(dtStr).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  if (epoch <= now) return toast('Schedule date must be in the future', 'warning');

  await transitionContentStatus(itemId, 'scheduled', epoch);
}

async function transitionContentStatus(itemId, toStatus, scheduled_at = null) {
  try {
    const body = { toStatus };
    if (scheduled_at) body.scheduled_at = scheduled_at;
    
    await api('PATCH', `/api/content/${itemId}/status`, body);
    const done = { in_review: 'Sent for review', approved: 'Approved', draft: 'Moved back to draft', scheduled: 'Scheduled', published: 'Published' };
    toast(done[toStatus] || 'Updated', 'success');
    
    await openContentDetail(itemId);
    renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function retryContentItem(itemId) {
  try {
    await api('PATCH', `/api/content/${itemId}/status`, { toStatus: 'scheduled', scheduled_at: Math.floor(Date.now() / 1000) + 60 });
    toast('Queued again: it will be posted within about a minute', 'success');
    await openContentDetail(itemId);
    renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteContentItem(itemId) {
  if (!confirm('Are you sure you want to permanently delete this content item?')) return;
  try {
    await api('DELETE', `/api/content/${itemId}`);
    toast('Content deleted successfully', 'success');
    closeContentDetail();
    renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Calendar → Create Post ────────────────────────────────────────────────────
// New posts and edits both happen in Create Post.
function openNewContentModal() {
  if (startNewCompose()) document.getElementById('compose-content').focus();
}

// Calendar "Edit": open the saved post in Create Post (same editor and AI tools)
async function openEditContentModal(itemId) {
  try {
    const item = await api('GET', `/api/content/${itemId}`);
    if (!['draft', 'in_review', 'failed'].includes(item.status)) {
      return toast(`This post is ${statusLabel(item.status).toLowerCase()}, so it can’t be edited.`, 'warning');
    }
    closeContentDetail();
    startEditCompose(item);
  } catch (err) {
    toast(err.message, 'error');
  }
}

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
    State.postsHistoryMap = {};
    posts.forEach(p => { State.postsHistoryMap[p.id] = p; });

    list.innerHTML = posts.map(post => {
      const platforms = Array.isArray(post.platforms) ? post.platforms : [];
      const date = new Date(post.created_at * 1000);
      const waText = encodeURIComponent(post.content?.substring(0, 1000) || '');
      return `
        <div class="history-item" style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:8px">
          <div class="history-content" style="white-space:pre-wrap;margin-bottom:8px;max-height:160px;overflow-y:auto">${escapeHtml(post.content)}</div>
          <div class="history-tags" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${platforms.map(p => `<span class="tag purple">${PLATFORMS[p]?.icon || ''} ${p}</span>`).join('')}
            <span class="tag">${date.toLocaleDateString()}</span>
            <span class="badge badge-${post.status === 'published' ? 'green' : 'orange'}">${post.status}</span>
            <div style="margin-left:auto;display:flex;gap:6px">
              <button class="btn btn-secondary btn-sm" onclick="copyPostHistory(${post.id})">📋 Copy</button>
              <a class="btn btn-sm" style="background:rgba(37,211,102,0.15);color:#25d366;border:1px solid rgba(37,211,102,0.3);text-decoration:none" href="https://api.whatsapp.com/send?text=${waText}" target="_blank">💬 WhatsApp</a>
              <button class="btn btn-primary btn-sm" onclick="openRepostModal(${post.id})">✏️ Edit & Repost</button>
            </div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
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
    State.aiHistoryMap = State.aiHistoryMap || {};
    history.forEach(h => { State.aiHistoryMap[h.id] = h; });

    list.innerHTML = history.map(h => `
      <div class="history-item" style="margin-bottom:12px;padding:12px;border:1px solid var(--border);border-radius:8px">
        <div class="history-prompt" style="font-weight:600;font-size:12px;color:var(--text-muted);margin-bottom:4px">"${escapeHtml(h.prompt.substring(0, 100))}${h.prompt.length > 100 ? '…' : ''}"</div>
        <div class="history-content" style="white-space:pre-wrap;margin-bottom:8px;max-height:160px;overflow-y:auto">${escapeHtml(h.response)}</div>
        <div class="history-tags" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="tag blue">${escapeHtml(h.model || 'ai')}</span>
          <span class="tag">${h.tokens_used || '?'} tokens</span>
          <span class="tag">${new Date(h.created_at * 1000).toLocaleDateString()}</span>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm" onclick="copyAIGenHistory(${h.id})">📋 Copy</button>
            <button class="btn btn-primary btn-sm" onclick="useAIGenHistory(${h.id})">✏️ Use in Compose</button>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
  }
}

function useAIGenHistory(id) {
  const item = State.aiHistoryMap?.[id];
  if (!item || !item.response) return toast('Content not found', 'error');

  if (!startNewCompose({ text: item.response })) return;
  State.generatedContent = item.response;

  const genOut = document.getElementById('gen-output');
  if (genOut) genOut.textContent = item.response;
  closeAIHistory();
  toast('✅ Content loaded into Compose!', 'success');
}

function usePostHistory(id) {
  const post = State.postsHistoryMap?.[id];
  if (!post || !post.content) return toast('Post content not found', 'error');

  if (!startNewCompose({ text: post.content, image_url: post.image_url || '', platforms: Array.isArray(post.platforms) ? post.platforms : null })) return;
  toast('✅ Post copied to Compose ready for re-posting!', 'success');
}

function copyAIGenHistory(id) {
  const item = State.aiHistoryMap?.[id];
  if (!item || !item.response) return;
  navigator.clipboard.writeText(item.response);
  toast('📋 Copied to clipboard!', 'info');
}

function copyPostHistory(id) {
  const post = State.postsHistoryMap?.[id];
  if (!post || !post.content) return;
  navigator.clipboard.writeText(post.content);
  toast('📋 Copied to clipboard!', 'info');
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
      return `<div class="file-item" onclick="previewFile(${jsAttr(f.name)}, '${targetListId}')">
        <span class="file-ext-badge ${ext}">${ext}</span>
        <span class="file-name">${escapeHtml(f.name)}</span>
        <span class="file-size">${size}</span>
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
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
  if (!startNewCompose({ text: State.selectedFileContent })) return;
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
      closeFileBrowserModal();
      if (!startNewCompose({ text: data.content })) return;
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
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">Analytics appear here after your first published post. (Want a preview? Click "Show sample data (demo)" — those numbers are made up.)</td></tr>';
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

// ─────────────────────────────────────────────────────────────────────────────
// ❓ Help & User Guide (public/help.html; opens in its own window in the desktop app)
// ─────────────────────────────────────────────────────────────────────────────

// Help section for each screen (ids in public/help.html)
const HELP_TOPICS = {
  dashboard: 'tour', compose: 'write', generate: 'write', calendar: 'schedule', history: 'failed',
  templates: 'templates', brand: 'templates', hashtags: 'hashtags', utm: 'hashtags', seo: 'seo', aso: 'seo',
  adcopy: 'seo', media: 'ai-keys', email: 'email', clients: 'clients', analytics: 'tour', files: 'data',
  admin: 'team', 'tools-directory': 'ai-keys',
  // Settings tabs
  'settings:platforms': 'connect', 'settings:license': 'licence', 'settings:ai': 'ai-keys',
  'settings:smtp': 'email',
  'settings:members': 'team', 'settings:about': 'support',
};

function helpTopicForPage() {
  const page = document.querySelector('.page.active')?.id?.replace(/^page-/, '') || '';
  if (page === 'settings') {
    const panel = [...document.querySelectorAll('.settings-panel')].find(p => p.style.display !== 'none');
    const tab = panel?.id?.replace(/^settings-panel-/, '');
    if (tab && HELP_TOPICS[`settings:${tab}`]) return HELP_TOPICS[`settings:${tab}`];
  }
  return HELP_TOPICS[page] || '';
}

function openHelp(topic = '') {
  const url = `/help.html${topic ? `#${encodeURIComponent(topic)}` : ''}`;
  const win = window.open(url, 'social-nexus-help');
  if (!win) location.href = url; // pop-ups blocked: open it here instead
}

// F1 opens help for the current screen, like other Windows apps
document.addEventListener('keydown', (e) => {
  if (e.key === 'F1') { e.preventDefault(); openHelp(helpTopicForPage()); }
});

// Settings tabs that change things for everyone on this PC: only the admin can
// edit them. Others see a short note and read-only controls instead of a form
// that would only fail when saved.
const ADMIN_ONLY_TABS = {
  smtp: 'Email sending (SMTP) is set up once for everyone by the admin of this installation. Ask them if emails are not going out.',
  ai: 'Local AI and the default model are set up for everyone by the admin of this installation. You can still save your own API keys below — they are stored on your account only.',
};
function applyAdminOnly(tab) {
  const panel = document.getElementById(`settings-panel-${tab}`);
  if (!panel || !ADMIN_ONLY_TABS[tab]) return;
  const isAdmin = State.user?.role === 'admin';
  let note = panel.querySelector(':scope > .admin-note');
  if (!isAdmin && !note) {
    note = document.createElement('div');
    note.className = 'admin-note';
    note.textContent = '🔒 ' + ADMIN_ONLY_TABS[tab];
    panel.prepend(note);
  }
  if (isAdmin && note) note.remove();
  panel.querySelectorAll('input, select, textarea, button').forEach(el => {
    if (el.closest('.admin-note') || el.closest('.user-scoped') || el.classList.contains('admin-note-exempt')) return;
    if (!isAdmin) { el.dataset.adminLocked = '1'; el.disabled = true; }
    else if (el.dataset.adminLocked) { el.disabled = false; delete el.dataset.adminLocked; }
  });
}

function switchSettingsTab(tab, btn) {
  document.querySelectorAll('.settings-panel').forEach(p => p.style.display = 'none');
  document.getElementById(`settings-panel-${tab}`).style.display = '';
  document.querySelectorAll('.settings-tab-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
  if (btn) { btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary'); }
  if (tab === 'members') loadMembers();
  applyAdminOnly(tab);
  if (tab === 'license') { if (State.license) renderLicensePanel(State.license); loadLicense(); }
}

async function loadSettings() {
  try {
    const platforms = await api('GET', '/api/config/platforms');
    renderPlatformCards(platforms);
  } catch (err) {
    document.getElementById('platform-cards-container').innerHTML =
      `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
  }
  try {
    const envStatus = await api('GET', '/api/config/env-status');
    const el = document.getElementById('setting-default-model');
    if (el && envStatus.default_text_model) {
      el.value = envStatus.default_text_model;
    }
  } catch {}
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
      : p.needs_reconnect
        ? `<span class="badge badge-orange" style="font-size:11px" title="The saved sign-in can't be used to post. Click Connect to sign in again.">● Sign in again</span>`
      : isConfigured
        ? `<span class="badge badge-orange" style="font-size:11px">● Ready to Connect</span>`
        : State.user?.role === 'admin' ? `<span class="badge badge-red" style="font-size:11px">● Credentials Needed</span>` : `<span class="badge badge-orange" style="font-size:11px">● Waiting for admin</span>`;

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

    // App keys are shared by everyone on this PC, so only the admin enters them
    const isAdminUser = State.user?.role === 'admin';
    const credentialsHtml = !p.credentials?.length ? '' : !isAdminUser ? `
      <div class="admin-note">
        ${isConfigured
          ? `✅ Your admin has set up ${escapeHtml(p.label || key)}. Click <strong>Connect</strong> to link your own account.`
          : `🔒 Your admin needs to add the ${escapeHtml(p.label || key)} app keys first (Settings → Social Platforms). Then you can click <strong>Connect</strong> here.`}
      </div>` : p.credentials?.length ? `
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

    // Step-by-step guide (open by default until the platform is connected)
    const g = p.guide;
    const availBadge = !g ? '' : g.availability === 'unavailable'
      ? '<span class="badge badge-red" style="font-size:10px">Not available yet</span>'
      : g.availability === 'limited' ? '<span class="badge badge-orange" style="font-size:10px">Works with limits</span>' : '';
    const guideHtml = !g ? '' : `
      <details style="margin-bottom:12px" ${!isConnected && isAdminUser && g.availability !== 'unavailable' ? 'open' : ''}>
        <summary style="font-size:12px;font-weight:600;color:var(--text-secondary);cursor:pointer;padding:4px 0">
          📘 Setup guide ${g.time && g.time !== '—' ? `<span style="font-weight:400;color:var(--text-muted)">· ${escapeHtml(g.time)}</span>` : ''} ${availBadge}
        </summary>
        <div style="font-size:13px;margin-top:8px">
          <div style="color:var(--text-muted);margin-bottom:6px">You need: ${g.needs.map(n => escapeHtml(n)).join(' · ')}</div>
          <ol style="margin:0 0 0 18px;padding:0;display:flex;flex-direction:column;gap:6px">
            ${g.steps.map(st => `<li>${escapeHtml(st.text)}
              ${st.link ? ` <a href="${escapeHtml(st.link)}" target="_blank" rel="noopener" style="color:#60a5fa">Open ↗</a>` : ''}
              ${st.copy ? `<div style="display:flex;gap:6px;margin-top:4px"><code style="flex:1;padding:6px 8px;background:var(--glass);border-radius:6px;font-size:12px;word-break:break-all">${escapeHtml(st.copy)}</code><button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(st.copy)});toast('Copied — paste it into the developer portal','success')">📋 Copy</button></div>` : ''}
            </li>`).join('')}
          </ol>
          ${g.notes?.length ? `<div style="margin-top:8px;color:var(--text-muted);font-size:12px">${g.notes.map(n => `ℹ️ ${escapeHtml(n)}`).join('<br>')}</div>` : ''}
        </div>
      </details>`;

    const noteHtml = p.note ? `<div style="font-size:11px;color:var(--text-muted);background:rgba(255,255,255,0.03);border-radius:6px;padding:8px;margin-bottom:10px">💡 ${escapeHtml(p.note)}</div>` : '';

    const manualTokenHtml = !isConnected && isConfigured && key === 'facebook' ? `
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
      ? `<div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="triggerPlatformConnection('${key}', event)" title="Refresh & re-verify status">🔄 Refresh</button>
          <button class="btn btn-danger btn-sm" onclick="disconnect('${key}')">Disconnect</button>
         </div>`
      : `<div style="display:flex;gap:6px">
          <button class="btn btn-secondary btn-sm" onclick="triggerPlatformConnection('${key}', event)" title="Check or trigger connection">🔄 Refresh</button>
          <a href="${escapeHtml(p.oauth_url)}" class="btn btn-${isConfigured ? 'primary' : 'secondary'} btn-sm" ${!isConfigured ? 'title="Save credentials first"' : ''}>Connect</a>
         </div>`;

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
        ${guideHtml}
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
          <button class="btn btn-secondary btn-sm" onclick="setFBPage(${jsAttr(pg.id)},${jsAttr(pg.name)})" style="justify-content:flex-start;text-align:left">
            📄 ${escapeHtml(pg.name)} <span style="font-size:10px;color:var(--text-muted);margin-left:auto">${escapeHtml(pg.id)}</span>
          </button>`).join('')}
      </div>`;
  } catch (err) { container.innerHTML = `<div style="color:#ef4444;font-size:12px">${escapeHtml(err.message)}</div>`; }
}

async function setFBPage(id, name) {
  try {
    const result = await api('POST', '/api/config/facebook/set-page', { page_id: id });
    const msg = result.instagram_connected ? `Page "${name}" set, and its Instagram account is connected too. ✅`
      : result.instagram_detected ? `Page "${name}" set. ✅ To post to its linked Instagram, click Connect on the Instagram card.`
      : `Page "${name}" set as default. ✅`;
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
          <button class="btn btn-secondary btn-sm" onclick="setPinterestBoard(${jsAttr(b.id)},${jsAttr(b.name)})" style="justify-content:flex-start">
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

async function saveDefaultModelSetting() {
  const model = document.getElementById('setting-default-model').value;
  try {
    await api('POST', '/api/config/ai-keys', { DEFAULT_TEXT_MODEL: model });
    toast('✅ Default AI model saved!', 'success');
    loadSettings();
    loadModels();
  } catch (err) { toast(err.message, 'error'); }
}

// All AI and media keys are saved to the signed-in user's own account
// (POST /users/settings) — never shared with other users of this PC.
const ENV_TO_USER_SETTING = {
  GOOGLE_AI_KEY: 'google_ai_key', ANTHROPIC_API_KEY: 'anthropic_key',
  STABILITY_API_KEY: 'stability_key', OPENAI_API_KEY: 'openai_key',
  LUMA_API_KEY: 'luma_key', RUNWAY_API_KEY: 'runway_key',
};

async function saveUserKey(settingKey, value, label) {
  if (!value) return toast(`Please enter your ${label}`, 'warning');
  try {
    await api('POST', '/users/settings', { [settingKey]: value });
    toast(`✅ ${label} saved to your account`, 'success');
    loadModels?.();
  } catch (err) { toast(err.message, 'error'); }
}

function saveApiKey() {
  return saveUserKey('google_ai_key', document.getElementById('setting-anthropic-key').value.trim(), 'Google Gemini API key');
}

function saveClaudeKey() {
  return saveUserKey('anthropic_key', document.getElementById('setting-claude-key').value.trim(), 'Anthropic API key');
}

async function saveMediaKey(envKey, inputId) {
  const settingKey = ENV_TO_USER_SETTING[envKey];
  if (!settingKey) return toast('Unknown key type', 'error');
  return saveUserKey(settingKey, document.getElementById(inputId)?.value.trim(), 'key');
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

async function triggerPlatformConnection(platform, evt) {
  const btn = evt?.currentTarget || (evt?.target?.tagName === 'BUTTON' ? evt.target : null);
  const origHtml = btn ? btn.innerHTML : '🔄 Refresh';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Verifying…'; }

  try {
    const res = await api('POST', `/auth/refresh/${platform}`);
    if (res.connected) {
      toast(`✅ ${platform} connection verified & refreshed!`, 'success');
      await refreshStatus();
      loadSettings();
      renderDashboardPlatforms();
    } else if (res.oauth_url) {
      toast(`Starting ${platform} authorization…`, 'info');
      window.location.href = res.oauth_url;
    }
  } catch (err) {
    toast(err.message, 'warning');
    const oauthUrl = `/auth/${platform}`;
    if (confirm(`${err.message}\n\nWould you like to connect ${platform} now?`)) {
      window.location.href = oauthUrl;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
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

// Escapes text for HTML content AND attribute values (quotes included).
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A value passed as an argument inside an inline handler, e.g.
//   onclick="switchWorkspace(${id}, ${jsAttr(name)})"
// JSON-encodes it (a valid JS literal) and then HTML-escapes it for the attribute,
// so names like "Priya's Workspace" or text with quotes can't break the handler.
function jsAttr(value) {
  return escapeHtml(JSON.stringify(value === undefined ? null : value));
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
            <button class="btn btn-secondary btn-sm btn-icon" onclick="adminResetPassword(${u.id},${jsAttr(u.email)})" title="Reset Password">🔑</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="deleteUser(${u.id},${jsAttr(u.email)})" title="Delete">🗑</button>
          </div>
        </td>
      </tr>`).join('');
  } catch (err) { tbody.innerHTML = `<tr><td colspan="9" style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</td></tr>`; }
}

async function adminCreateUser() {
  const email    = document.getElementById('new-user-email')?.value.trim();
  const password = document.getElementById('new-user-password')?.value;
  const name     = document.getElementById('new-user-name')?.value.trim();
  const role     = document.getElementById('new-user-role')?.value;
  if (!email || !password) return toast('Email and password are required', 'warning');
  try {
    const r = await fetch('/admin/users/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, role }),
    }).then(r => r.json());
    if (r.error) return toast(r.error, 'error');
    toast(`✅ User created: ${email}`, 'success');
    document.getElementById('new-user-email').value    = '';
    document.getElementById('new-user-password').value = '';
    document.getElementById('new-user-name').value     = '';
    loadAdminUsers(); loadAdminDashboard();
  } catch (err) { toast(err.message, 'error'); }
}

async function adminResetPassword(id, email) {
  const pwd = prompt(`Reset password for ${email}\n\nEnter new password (min 6 chars):`);
  if (!pwd) return;
  if (pwd.length < 6) return toast('Password must be at least 6 characters', 'warning');
  try {
    await fetch(`/admin/users/${id}/password`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd }),
    });
    toast(`Password reset for ${email}`, 'success');
  } catch (err) { toast(err.message, 'error'); }
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
          <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(data.code)});toast('Code copied!','success')">📋 Copy Code</button>
          <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(shareUrl)});toast('Link copied!','success')">🔗 Copy Link</button>
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
            <button class="btn btn-secondary btn-sm btn-icon" onclick="navigator.clipboard.writeText(${jsAttr(c.code)});toast('Copied!','success')" title="Copy">📋</button>
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
    if (nameEl) nameEl.value = config.app_name || 'Social-Nexus';
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
  document.getElementById('theme-icon')?.querySelector('use')?.setAttribute('href', `icons/sprite.svg#i-${isLight ? 'sun' : 'moon'}`);
  if (btn) btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
}

function initTheme() {
  const saved = localStorage.getItem('nexus_theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
    const btn = document.getElementById('btn-theme');
    document.getElementById('theme-icon')?.querySelector('use')?.setAttribute('href', 'icons/sprite.svg#i-sun');
    if (btn) btn.title = 'Switch to dark mode';
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
    if (connected === 'facebook' && params.get('select_page')) {
      toast(params.get('instagram')
        ? 'You manage several Facebook Pages — choose the one linked to your Instagram in Settings → Facebook → Select page. Instagram connects when you pick it.'
        : 'You manage several Facebook Pages — choose which one Social-Nexus posts to in Settings → Facebook → Select page.', 'info', 9000);
    }
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
      oauth_state_invalid: 'Sign-in link expired or was not started from Social-Nexus — please try connecting again',
      instagram_not_found: 'Facebook is connected, but no Instagram account is linked to your Facebook Page. In Instagram, switch to a Business or Creator account and link it to the Page, then click Connect on the Instagram card again.',
    };
    if (error === 'not_configured') {
      const names = { linkedin: 'LinkedIn', facebook: 'Facebook', pinterest: 'Pinterest', twitter: 'Twitter/X', google: 'YouTube / Google Business', tiktok: 'TikTok' };
      const name = names[params.get('platform')] || 'this platform';
      toast(`Before connecting ${name}, add your ${name} app details in Settings → Social Platforms (open "API Credentials" on its card).`, 'warning', 8000);
      navigateTo('settings');
      window.history.replaceState({}, '', '/');
      return;
    }
    toast(msgs[error] || `OAuth error: ${error}`, 'error', error === 'instagram_not_found' ? 12000 : 6000);
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

    // Auto-select active or first available
    if (data.text?.length) {
      const activeModel = data.text.find(m => m.active);
      const currentId = ModelState.textModel?.id;
      const targetModel = activeModel || data.text[0];
      if (!ModelState.textModel || (activeModel && activeModel.id !== currentId)) {
        selectModel(targetModel, 'text');
      }
    }
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
  container.innerHTML = models.map((m) => {
    const colorClass = PROVIDER_COLORS[m.provider] || 'badge-purple';
    const icon = PROVIDER_ICONS[m.provider] || '🤖';
    const sizeText = m.size ? ` · ${(m.size/1e9).toFixed(1)}GB` : '';
    const isActive = m.active;
    const bg = isActive ? 'rgba(124,58,237,0.2)' : 'var(--glass)';
    const bc = isActive ? 'var(--accent-purple)' : 'var(--border)';
    const color = isActive ? '#a78bfa' : 'var(--text-secondary)';
    return `<button class="model-chip" data-model-id="${m.id}" onclick="selectModel(${jsAttr(m)}, '${type}')"
      style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:20px;border:1px solid ${bc};background:${bg};cursor:pointer;font-size:12px;font-weight:500;color:${color};transition:var(--transition)">
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
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing… (can take up to a minute)';
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
        <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(data.meta_title || '')});toast('Copied!','success')" style="margin-top:6px">📋 Copy</button>
      </div>
      <div class="seo-result-group"><div class="seo-result-label">Meta Description <span class="badge badge-${data.meta_description?.length > 160 ? 'red' : 'green'}">${data.meta_description?.length || 0} chars</span></div>
        <div class="seo-result-value">${escapeHtml(data.meta_description || '')}</div>
        <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText(${jsAttr(data.meta_description || '')});toast('Copied!','success')" style="margin-top:6px">📋 Copy</button>
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
        `<div class="kw-row"><span class="kw-term">${escapeHtml(k.keyword)}</span><span class="badge badge-${k.difficulty==='low'?'green':k.difficulty==='medium'?'orange':'red'}">${k.difficulty}</span><span class="badge badge-blue">${k.intent}</span><button class="btn btn-secondary btn-sm" onclick="addTrackedFromResearch(${jsAttr(k.keyword)})">+ Track</button></div>`).join('')}</div>`;
    }
    if (data.long_tail_keywords?.length) {
      html += `<div class="seo-result-group"><div class="seo-result-label">📏 Long-tail Keywords</div>${data.long_tail_keywords.map(k =>
        `<div class="kw-row"><span class="kw-term">${escapeHtml(k.keyword)}</span><span class="badge badge-${k.difficulty==='low'?'green':k.difficulty==='medium'?'orange':'red'}">${k.difficulty}</span><button class="btn btn-secondary btn-sm" onclick="addTrackedFromResearch(${jsAttr(k.keyword)})">+ Track</button></div>`).join('')}</div>`;
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
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing… (can take up to a minute)';
  out.innerHTML = '<div style="text-align:center;padding:60px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/seo/aso', {
      app_name: document.getElementById('aso-app-name').value,
      app_description: document.getElementById('aso-app-desc').value,
      category: document.getElementById('aso-category').value,
      platform: document.getElementById('aso-platform').value,
      competitors: document.getElementById('aso-competitors').value,
    });
    const copyBtn = (text) => `<button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="navigator.clipboard.writeText(${jsAttr(text)});toast('Copied!','success')">📋 Copy</button>`;
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
      <div class="scheduled-item" style="cursor:pointer" onclick="loadCampaignToEditor(${jsAttr(c)})">
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
  if (!name || !subject) { toast('Campaign name and subject are required', 'warning'); return null; }
  // Plain-text part for mail clients that don't show HTML
  const text = body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
  try {
    if (State.editingCampaignId) {
      await api('PUT', `/api/email/campaigns/${State.editingCampaignId}`, { name, subject, html_content: body, text_content: text });
    } else {
      const res = await api('POST', '/api/email/campaigns', { name, subject, html_content: body, text_content: text });
      // Keep editing the saved campaign: later saves update it and Send can send it
      State.editingCampaignId = res.id;
    }
    toast('Campaign saved!', 'success');
    loadCampaigns();
    return State.editingCampaignId;
  } catch (err) { toast(err.message, 'error'); return null; }
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
    // Always save first, so the latest subject/body edits are what gets sent
    const campId = await saveCampaign();
    if (!campId) return;
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
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing… (can take up to a minute)';
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
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing… (can take up to a minute)';
  out.innerHTML = '<div style="text-align:center;padding:40px"><span class="spinner lg"></span></div>';
  try {
    const data = await api('POST', '/api/tools/ad-copy', {
      product: document.getElementById('ad-product').value,
      target_audience: document.getElementById('ad-audience').value,
      usp: document.getElementById('ad-usp').value,
      goal: document.getElementById('ad-goal').value,
    });
    const copyBtn = (label, text) => `<button class="btn btn-secondary btn-sm" style="margin-top:4px" onclick="navigator.clipboard.writeText(${jsAttr(text||'')});toast('Copied!','success')">📋 ${label}</button>`;
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
    if (/No image generator/.test(err.message)) {
      out.innerHTML += `<div style="margin-top:12px"><button class="btn btn-secondary btn-sm" onclick="navigateTo('user-settings')">⚙️ Open My API Keys</button></div>`;
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
    toast(State.composeEditing ? 'Image added to the post you’re editing — Save to keep it' : 'Image added to Create Post', 'success');
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
          <button class="btn btn-primary" onclick="pollVideoStatus(${jsAttr(data.provider)},${jsAttr(data.job_id)},this)" id="btn-poll-video">🔄 Check Status</button>
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
        <button class="btn btn-primary btn-sm" onclick="pollAnimationStatus(${jsAttr(data.job_id)},this)">🔄 Check Status</button>
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
  if (!startNewCompose({ text: State.lastCaption })) return;
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
      ? `<div class="seo-result-group"><div class="seo-result-label">${label}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${tags.map(t=>`<span class="badge badge-blue" style="cursor:pointer" onclick="navigator.clipboard.writeText(${jsAttr(t)});toast('Copied!','success')">${escapeHtml(t)}</span>`).join('')}</div></div>` : '';
    const ht = data.hashtags || {};
    out.innerHTML = `
      ${renderGroup('🔥 High Volume', ht.high_volume)}
      ${renderGroup('📊 Medium Volume', ht.medium_volume)}
      ${renderGroup('🎯 Niche', ht.niche)}
      ${renderGroup('⚡ Trending', ht.trending)}
      ${data.recommended_mix ? `<div class="seo-result-group"><div class="seo-result-label">⭐ Recommended Mix</div><div style="font-size:13px;color:var(--accent-blue);word-break:break-all">${escapeHtml(data.recommended_mix)}</div><button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="navigator.clipboard.writeText(${jsAttr(data.recommended_mix||'')});toast('Copied!','success')">📋 Copy Mix</button></div>` : ''}
      ${data.instagram_set ? `<div class="seo-result-group"><div class="seo-result-label">📸 Instagram Set (30 tags)</div><div style="font-size:12px;color:var(--text-secondary);word-break:break-all">${escapeHtml(data.instagram_set)}</div><button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="navigator.clipboard.writeText(${jsAttr(data.instagram_set||'')});toast('Copied!','success')">📋 Copy IG Set</button></div>` : ''}
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
          <button class="btn btn-secondary btn-sm btn-icon" onclick="navigator.clipboard.writeText(${jsAttr(l.full_url||'')});toast('Copied!','success')" title="Copy">📋</button>
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
      <div class="scheduled-item" style="cursor:pointer" onclick="previewTemplate(${jsAttr(t)})">
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
  if (!startNewCompose({ text: State.selectedTemplate })) return;
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
          return `<span class="badge badge-purple" style="cursor:pointer" onclick="selectOllamaModel(${jsAttr(m.name)})">${escapeHtml(m.name)} ${sizeGB}</span>`;
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

// Close dropdowns when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('user-menu-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.style.display = 'none';
  }
  if (!document.getElementById('workspace-switcher-wrap')?.contains(e.target)) {
    const dd = document.getElementById('workspace-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

async function doLogout() {
  await fetch('/users/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ── Workspace Switcher ────────────────────────────────────────────────────────

let currentWorkspaceId = null;
let currentWorkspaceName = '';

function toggleWorkspaceSwitcher() {
  const dd = document.getElementById('workspace-dropdown');
  dd.style.display = dd.style.display === 'none' ? '' : 'none';
}

async function loadWorkspaces() {
  try {
    const res = await fetch('/me/workspaces');
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    const workspaces = await res.json();
    State.userWorkspaces = workspaces;
    
    if (workspaces.length > 0 && !currentWorkspaceId) {
      currentWorkspaceId = workspaces[0].workspace_id;
      currentWorkspaceName = workspaces[0].workspace_name;
      const label = document.getElementById('workspace-name-label');
      if (label) label.textContent = currentWorkspaceName;
    }

    const list = document.getElementById('workspace-list');
    if (!list) return;
    list.innerHTML = workspaces.map(w => `
      <button class="btn" onclick="switchWorkspace(${w.workspace_id},${jsAttr(w.workspace_name)})"
        style="width:100%;justify-content:flex-start;border-radius:0;padding:10px 14px;font-size:13px;color:var(--text-primary);${w.workspace_id === currentWorkspaceId ? 'background:var(--glass)' : ''}">
        ${w.workspace_id === currentWorkspaceId ? '✓ ' : ''}${escapeHtml(w.workspace_name)}
        <span style="font-size:11px;color:var(--text-muted);margin-left:auto">${w.role}</span>
      </button>`).join('');
  } catch (err) {
    console.error('loadWorkspaces error:', err);
  }
}

async function switchWorkspace(wsId, wsName, closeDropdown = true) {
  // Create Post belongs to the current workspace (client): never carry it over
  if (String(wsId) !== String(currentWorkspaceId) && typeof composeHasUnsaved === 'function') {
    if (composeHasUnsaved() && !confirm('Create Post has changes you haven’t saved. Switch workspace and discard them?')) return;
    resetCompose();
  }
  try {
    const res = await fetch('/session/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: wsId }),
    });
    if (res.status === 401) { window.location.href = '/login.html'; return; }

    currentWorkspaceId = wsId;
    currentWorkspaceName = wsName;

    const label = document.getElementById('workspace-name-label');
    if (label) label.textContent = wsName;

    if (closeDropdown) {
      const dd = document.getElementById('workspace-dropdown');
      if (dd) dd.style.display = 'none';
    }

    await loadWorkspaces();
    await refreshStatus();

    if (typeof State !== 'undefined' && State.currentPage) {
      const hooks = {
        dashboard: loadDashboard,
        calendar:  () => renderCalendar(State.calendarDate),
        history:   loadHistory,
        analytics: loadAnalytics,
        files:     loadLocalFiles,
        compose:   loadScheduled,
        templates: loadTemplates,
        utm:       loadUTMLinks,
        email:     loadEmailPage,
        brand:     loadBrandKit,
        seo:       loadTrackedKeywords,
        settings:  loadSettings,
        clients:   loadClients,
        generate:  loadModels,
        media:     loadModels,
        'user-settings': loadUserSettings,
        admin:     loadAdminDashboard,
      };
      if (hooks[State.currentPage]) hooks[State.currentPage]();
    }
  } catch (err) {
    console.error('Workspace switch error:', err);
  }
}

// ── Client & Brand Management ──────────────────────────────────────────────────

async function loadClients() {
  const grid = document.getElementById('clients-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted)"><div class="spinner lg" style="margin: 0 auto 12px"></div>Loading client brands…</div>';

  try {
    const clients = await fetch('/workspaces').then(r => r.json());
    if (!clients || clients.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1;" class="empty-state">
          <div class="empty-icon">👥</div>
          <div class="empty-title">No client brands found</div>
          <div class="empty-desc">Get started by adding your first client brand portfolio.</div>
          <button class="btn btn-primary" onclick="openAddClientModal()" style="margin-top:16px">➕ Add Client Brand</button>
        </div>`;
      return;
    }

    grid.innerHTML = clients.map(c => {
      const activePlatforms = c.social_accounts && c.social_accounts.length > 0
        ? c.social_accounts.map(acc => {
            const p = PLATFORMS[acc.platform] || { icon: '🔗', label: acc.platform };
            return `<span class="badge badge-purple" title="${escapeHtml(acc.account_label || p.label)}" style="display:inline-flex;align-items:center;gap:4px;margin:2px">
              <span style="font-size:12px">${p.icon}</span> ${escapeHtml(p.label)}
            </span>`;
          }).join('')
        : '<span style="color:var(--text-muted);font-size:12.5px;font-style:italic">No platforms connected</span>';

      const isCurrent = (c.workspace_id === currentWorkspaceId);

      return `
        <div class="card" style="position:relative;display:flex;flex-direction:column;justify-content:between;transition:transform 0.2s, box-shadow 0.2s;${isCurrent ? 'border:1.5px solid var(--accent-purple);box-shadow: 0 0 15px rgba(124, 58, 237, 0.15)' : ''}">
          ${isCurrent ? '<div style="position:absolute;top:12px;right:12px;background:var(--accent-purple);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;text-transform:uppercase">Active</div>' : ''}
          <div class="card-body" style="padding:24px;flex-grow:1;display:flex;flex-direction:column;gap:12px">
            <div>
              <div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:4px">${escapeHtml(c.name)}</div>
            </div>
            
            <div style="border-top:1px solid var(--border);padding-top:12px">
              <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Connected Channels</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px">${activePlatforms}</div>
            </div>

            <div style="display:flex;justify-content:between;align-items:center;font-size:13px;color:var(--text-muted);margin-top:auto;border-top:1px solid var(--border);padding-top:12px">
              <span>👥 <strong>${c.member_count}</strong> Member${c.member_count !== 1 ? 's' : ''}</span>
              <span style="font-size:12px">Role: <strong style="text-transform:capitalize">${c.role}</strong></span>
            </div>
          </div>
          <div class="card-footer" style="padding:16px 24px;background:rgba(255,255,255,0.01);border-top:1px solid var(--border);display:flex;gap:8px">
            <button class="btn ${isCurrent ? 'btn-secondary' : 'btn-primary'}" onclick="switchClientWorkspace(${c.workspace_id}, ${jsAttr(c.name)})" style="flex:1" ${isCurrent ? 'disabled' : ''}>
              ${isCurrent ? '🟢 Managing Client' : '🔌 Manage Social Media'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="navigateTo('settings');setTimeout(()=>switchSettingsTab('members',document.querySelector('[data-tab=members]')),100)" title="Client Settings">⚙️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteClient(${c.workspace_id}, ${jsAttr(c.name)})" title="Delete Client Brand" ${c.role !== 'manager' ? 'disabled style="opacity:0.3;cursor:not-allowed"' : ''}>🗑️</button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-danger)">⚠️ Error loading client brands: ${escapeHtml(err.message)}</div>`;
  }
}

async function switchClientWorkspace(wsId, wsName) {
  await switchWorkspace(wsId, wsName);
  toast(`Switched workspace context to ${wsName}`, 'success');
  loadClients(); // reload grid to update active status border/buttons
}

async function openAddClientModal() {
  document.getElementById('client-name-input').value = '';
  document.getElementById('client-slug-input').value = '';
  document.getElementById('client-timezone-select').value = 'Asia/Kolkata';
  
  const orgSelect = document.getElementById('client-org-select');
  orgSelect.innerHTML = '<option>Loading organizations…</option>';
  
  try {
    const orgs = await fetch('/workspaces/organizations').then(r => r.json());
    if (!orgs || orgs.length === 0) {
      orgSelect.innerHTML = '<option value="">No Organization Found (Contact Admin)</option>';
      document.getElementById('client-org-group').style.display = 'block';
    } else {
      orgSelect.innerHTML = orgs.map(o => `<option value="${o.id}">${escapeHtml(o.name)} (${o.role})</option>`).join('');
      document.getElementById('client-org-group').style.display = orgs.length > 1 ? 'block' : 'none';
      if (orgs.length === 1) {
        orgSelect.value = orgs[0].id;
      }
    }
  } catch (err) {
    orgSelect.innerHTML = '<option value="">Error loading organizations</option>';
  }

  document.getElementById('add-client-modal').style.display = 'flex';
}

function closeAddClientModal() {
  document.getElementById('add-client-modal').style.display = 'none';
}

function autoGenerateClientSlug() {
  const name = document.getElementById('client-name-input').value;
  const slug = name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')     // remove non-alphanumeric, spaces or dashes
    .replace(/\s+/g, '-')             // replace spaces with single dashes
    .replace(/-+/g, '-');             // replace multiple dashes with single dashes
  document.getElementById('client-slug-input').value = slug;
}

async function submitCreateClient() {
  const name = document.getElementById('client-name-input').value.trim();
  // The short web name is generated from the client name unless the user typed one
  const slug = document.getElementById('client-slug-input').value.trim()
    || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const timezone = document.getElementById('client-timezone-select').value;
  const orgId = parseInt(document.getElementById('client-org-select').value);

  if (!name) {
    return toast('Please enter the client name', 'warning');
  }
  if (!orgId) {
    return toast('A valid Organization must be selected', 'warning');
  }

  try {
    const res = await fetch('/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, name, slug, timezone })
    });
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to create workspace');
    }

    toast('🎉 Client workspace created successfully!', 'success');
    closeAddClientModal();
    
    // Switch to new client workspace immediately
    const newWs = await res.json();
    await switchWorkspace(newWs.id, newWs.name);
    loadClients();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteClient(id, name) {
  if (!confirm(`Are you absolutely sure you want to delete client "${name}"?\nThis will permanently delete all associated social media tokens, scheduled posts, history, and brand assets for this client.`)) {
    return;
  }
  
  try {
    const res = await fetch(`/workspaces/${id}`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to delete workspace');
    }

    toast(`Deleted client brand "${name}"`, 'info');
    
    // If the deleted workspace was the active workspace, switch to first available
    if (id === currentWorkspaceId) {
      currentWorkspaceId = null;
      await loadWorkspaces(); // will auto-assign first available workspace
    }
    
    loadClients();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Members Panel ─────────────────────────────────────────────────────────────

async function loadMembers() {
  const el = document.getElementById('members-list');
  if (!el) return;
  if (!currentWorkspaceId) { el.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">No active workspace</div>'; return; }
  try {
    const members = await fetch(`/workspaces/${currentWorkspaceId}/members`).then(r => r.json());
    if (!members.length) { el.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">No members yet</div>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:11px;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:8px 4px">User</th>
        <th style="text-align:left;padding:8px 4px">Role</th>
        <th style="text-align:left;padding:8px 4px">Status</th>
      </tr></thead>
      <tbody>${members.map(m => `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:10px 4px;font-size:13px">${escapeHtml(m.name || m.email || `User #${m.user_id}`)}${m.name && m.email ? `<div style="font-size:11px;color:var(--text-muted)">${escapeHtml(m.email)}</div>` : ''}</td>
        <td style="padding:10px 4px"><span style="font-size:11px;background:var(--glass);padding:2px 8px;border-radius:20px">${escapeHtml(m.role)}</span></td>
        <td style="padding:10px 4px"><span style="font-size:11px;color:${m.status==='active'?'#22c55e':'var(--text-muted)'}">${escapeHtml(m.status)}</span></td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (err) {
    el.innerHTML = `<div style="color:#ef4444;padding:20px">Failed to load members</div>`;
  }
}

async function sendInvite() {
  const email = document.getElementById('invite-email')?.value.trim();
  const role = document.getElementById('invite-role')?.value;
  const resultEl = document.getElementById('invite-result');
  if (!email) { if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">Email is required</span>'; return; }
  if (!currentWorkspaceId) { if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">No active workspace</span>'; return; }
  try {
    const r = await fetch('/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: currentWorkspaceId, email, role }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to send invite');
    if (resultEl) resultEl.innerHTML = `<span style="color:#22c55e">Invite created. Copy this link and send it to them (it is not emailed automatically): <a href="${escapeHtml(data.invite_url)}" target="_blank" style="color:#60a5fa">${escapeHtml(data.invite_url)}</a></span>`;
    document.getElementById('invite-email').value = '';
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<span style="color:#ef4444">${escapeHtml(err.message)}</span>`;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// User API Settings (per-user keys)
// ─────────────────────────────────────────────────────────────────────────────

async function loadUserSettings() {
  try {
    const s = await fetch('/users/settings').then(r => r.json());
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('u-google-key',      s.google_ai_key);
    set('u-groq-key',        s.groq_key);
    set('u-openrouter-key',  s.openrouter_key);
    set('u-mistral-key',     s.mistral_key);
    set('u-anthropic-key',   s.anthropic_key);
    set('u-stability-key',   s.stability_key);
    set('u-openai-key',      s.openai_key);
    set('u-luma-key',        s.luma_key);
    set('u-runway-key',      s.runway_key);
    set('u-ollama-model',    s.ollama_model);
    set('u-ollama-url',      s.ollama_url);
    set('u-default-text-model', s.default_text_model);
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
        google_ai_key:    get('u-google-key'),
        groq_key:         get('u-groq-key'),
        openrouter_key:   get('u-openrouter-key'),
        mistral_key:      get('u-mistral-key'),
        anthropic_key:    get('u-anthropic-key'),
        stability_key:    get('u-stability-key'),
        openai_key:       get('u-openai-key'),
        luma_key:         get('u-luma-key'),
        runway_key:       get('u-runway-key'),
        ollama_model:     get('u-ollama-model'),
        ollama_url:       get('u-ollama-url'),
        ollama_enabled:   document.getElementById('u-ollama-enabled')?.checked ? 1 : 0,
        default_text_model: document.getElementById('u-default-text-model')?.value || 'ollama',
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
      { name: 'Google Gemini',   desc: 'Gemini Flash — free tier with generous limits.',           url: 'https://aistudio.google.com',         badge: '✨ Free tier' },
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
      { name: 'OpenAI GPT Image', desc: 'Paid per image. OpenAI image generation API.',               url: 'https://platform.openai.com',         badge: '💲 Paid' },
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
      { name: 'Luma Dream Machine', desc: '$29/mo. Best image-to-video. Social-Nexus integrated.',           url: 'https://lumalabs.ai',                 badge: '💲 $29/mo' },
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
      { name: 'Social-Nexus (This App)', desc: 'Free, local, AI-powered social marketing suite.',            url: 'http://localhost:3000',               badge: '⚡ You are here' },
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
  loadWorkspaces().then(initUiMode).catch(() => applyUiMode("simple"));
  try { if (localStorage.getItem("nexus_more_tools_open")) toggleMoreTools(true); } catch {}
  checkOnboarding();
  loadLicense();
  setInterval(loadLicense, 10 * 60 * 1000);

  // Handle local computer file import
  const fileInput = document.getElementById('computer-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target.result;
        closeFileBrowserModal();
        // A new post, so it never overwrites a post being edited
        if (!startNewCompose({ text: content })) return;
        toast(`Successfully imported "${file.name}"!`, 'success');
      };
      reader.onerror = () => {
        toast('Failed to read file from computer', 'error');
      };
      reader.readAsText(file);
      fileInput.value = ''; // reset
    });
  }

  // Keys used to be kept in browser storage, where the next person on this PC
  // could use them. They now live only in each user's account — remove leftovers.
  try { localStorage.removeItem('nexus_api_key'); localStorage.removeItem('nexus_claude_key'); } catch {}

  // Set default post mode
  setPostMode('schedule');

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

  console.log('Social-Nexus v2.0 initialized ⚡ — Full Digital Marketing Suite');
});

// ─────────────────────────────────────────────────────────────────────────────
// 🇮🇳 Indian Holidays & WhatsApp Features
// ─────────────────────────────────────────────────────────────────────────────

let _todayHolidays = [];

async function loadIndianHolidays() {
  try {
    const data = await fetch('/api/holidays').then(r => r.json());
    _todayHolidays = data.today || [];

    // Show dashboard banner if there's a holiday today
    if (_todayHolidays.length > 0) {
      const h = _todayHolidays[0];
      const banner = document.getElementById('india-holiday-banner');
      const nameEl = document.getElementById('holiday-banner-name');
      const emojiEl = document.getElementById('holiday-banner-emoji');
      if (banner && nameEl && emojiEl) {
        nameEl.textContent = `${h.emoji} ${h.name} — Post a special message today!`;
        emojiEl.textContent = h.emoji;
        banner.style.display = 'block';
      }

      // Show in generate page
      const genBar = document.getElementById('gen-holiday-bar');
      const genName = document.getElementById('gen-holiday-name');
      if (genBar && genName) {
        genName.textContent = `${h.emoji} ${h.name}`;
        genBar.style.display = 'block';
      }

      // Store globally for use
      window._activeHoliday = h;
    }

    // Mark upcoming holidays on calendar (if calendar is loaded)
    if (data.upcoming?.length) {
      window._upcomingHolidays = data.upcoming;
      updateCalendarWithHolidays(data.upcoming);
    }
  } catch { /* silent fail */ }
}

function updateCalendarWithHolidays(holidays) {
  holidays.forEach(h => {
    const dayEl = document.querySelector(`[data-date="${h.date}"]`);
    if (dayEl) {
      const badge = document.createElement('div');
      badge.style.cssText = 'font-size:10px;background:rgba(255,153,0,0.2);border-radius:4px;padding:2px 4px;color:#ff9900;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      badge.title = h.name;
      badge.textContent = `${h.emoji} ${h.name}`;
      dayEl.appendChild(badge);
    }
  });
}

async function generateHolidayContent() {
  const holiday = window._activeHoliday;
  if (!holiday) return;
  const platforms = getSelectedPlatforms('gen-platforms');
  const platform = platforms[0] || 'facebook';

  document.getElementById('gen-prompt').value = `Create an engaging ${platform} post for ${holiday.name}`;
  await generateContent();
}

async function generateHolidayContentFromDashboard() {
  const holiday = window._activeHoliday;
  if (!holiday) return;
  if (!startNewCompose()) return;
  document.getElementById('compose-ai-prompt').value = `An engaging post for ${holiday.name}. Warm, celebratory and relevant for Indian audiences.`;
  composeAiWrite();
}

function shareViaWhatsApp(text) {
  if (!text?.trim()) { toast('No content to share', 'warning'); return; }
  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔁 Edit & Repost Modal
// ─────────────────────────────────────────────────────────────────────────────

function openRepostModal(postId) {
  const post = State.postsHistoryMap?.[postId];
  if (!post) return;

  const modal = document.getElementById('repost-modal');
  const content = document.getElementById('repost-content');
  content.value = post.content || '';

  // Pre-select the same platforms
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];
  document.querySelectorAll('#repost-platforms .platform-toggle').forEach(el => {
    const p = el.dataset.platform;
    if (platforms.includes(p)) el.classList.add('selected');
    else el.classList.remove('selected');
    el.onclick = () => el.classList.toggle('selected');
  });

  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  window._repostPostId = postId;
}

function closeRepostModal() {
  const modal = document.getElementById('repost-modal');
  if (modal) modal.style.display = 'none';
}

function sendRepostToCompose() {
  const content = document.getElementById('repost-content')?.value;
  if (!content) return;
  closeRepostModal();
  if (!startNewCompose({ text: content })) return;
  toast('Content loaded into Compose ✏️', 'success');
}

async function publishRepost() {
  const content = document.getElementById('repost-content')?.value?.trim();
  if (!content) return toast('Add content before posting', 'warning');

  const platforms = [];
  document.querySelectorAll('#repost-platforms .platform-toggle.selected').forEach(el => {
    if (el.dataset.platform && el.dataset.platform !== 'whatsapp') {
      platforms.push(el.dataset.platform);
    }
  });

  if (!platforms.length) {
    // WhatsApp deep link if only WhatsApp is selected
    shareViaWhatsApp(content);
    closeRepostModal();
    return;
  }

  try {
    const btn = document.querySelector('#repost-modal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
    await api('POST', '/api/post/now', { content, platforms, image_url: '' });
    closeRepostModal();
    toast('✅ Reposted successfully!', 'success');
    loadPostHistory();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    const btn = document.querySelector('#repost-modal .btn-primary');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Post Now'; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🚀 Onboarding Wizard
// ─────────────────────────────────────────────────────────────────────────────

// Remembered per user, so a second person on the same PC still gets the welcome steps
function onboardingKey() {
  return `nexus_onboarding_v2_done_${State.user?.id || 'anon'}`;
}

function checkOnboarding() {
  let done = false;
  try { done = !!localStorage.getItem(onboardingKey()); } catch {}
  if (!done) setTimeout(() => showOnboarding(), 800);
}

function showOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
  }
}

function closeOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) overlay.style.display = 'none';
  try { localStorage.setItem(onboardingKey(), '1'); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple / Agency mode
//   Simple (default for one person): short menu, no review step, no client screens.
//   Agency: clients & brands, team review, workspace switcher, members.
// Saved per user; when never chosen, Agency is used once there are several
// workspaces or team members.
// ─────────────────────────────────────────────────────────────────────────────
function isAgencyMode() { return document.body.classList.contains('agency-mode'); }

function applyUiMode(mode) {
  const agency = mode === 'agency';
  document.body.classList.toggle('agency-mode', agency);
  const sw = document.getElementById('mode-switch');
  if (sw) sw.checked = agency;
}

async function initUiMode() {
  let mode = null;
  try { mode = (await fetch('/users/settings').then(r => r.json())).ui_mode || null; } catch {}
  if (!mode) {
    // Not chosen yet: decide from how the app is used
    try {
      const workspaces = await fetch('/workspaces').then(r => r.json());
      let members = 1;
      if (currentWorkspaceId) members = (await fetch(`/workspaces/${currentWorkspaceId}/members`).then(r => r.json())).length || 1;
      mode = (Array.isArray(workspaces) && workspaces.length > 1) || members > 1 ? 'agency' : 'simple';
    } catch { mode = 'simple'; }
  }
  applyUiMode(mode);
}

async function setUiMode(mode) {
  applyUiMode(mode);
  try { await api('POST', '/users/settings', { ui_mode: mode }); } catch {}
  toast(mode === 'agency'
    ? 'Agency mode: clients & brands, team review and the workspace switcher are now shown'
    : 'Simple mode: the menu shows just what one person needs', 'info');
  if (State.currentPage === 'calendar' && State.selectedContentItem) openContentDetail(State.selectedContentItem.id);
}

function toggleMoreTools(forceOpen) {
  const box = document.getElementById('nav-more');
  const btn = document.getElementById('nav-more-toggle');
  if (!box || !btn) return;
  const open = forceOpen === true ? true : !box.classList.contains('open');
  box.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  try { localStorage.setItem('nexus_more_tools_open', open ? '1' : ''); } catch {}
}

function openPlatformSettings() {
  navigateTo('settings');
  switchSettingsTab('platforms', document.querySelector('[data-tab=platforms]'));
}

// Welcome guide step 2: say so when Ollama is already installed and ready
async function checkOnboardOllama() {
  const box = document.getElementById('onboard-ollama-status');
  if (!box) return;
  try {
    const st = await fetch('/api/config/ollama/status').then(r => r.json());
    if (!st.running) return; // keep the download hint
    const want = String(st.current || 'llama3.2').split(':')[0];
    const ready = (st.models || []).some(m => m.name === st.current || m.name.split(':')[0] === want);
    if (ready) {
      // Nothing to set up: the main button just moves on
      const btn = document.getElementById('onboard-ai-btn');
      if (btn) { btn.textContent = 'Continue →'; btn.onclick = () => goOnboardStep(3); }
    }
    box.textContent = ready
      ? `✅ Ollama is running on this computer and ${st.current} is ready. Nothing else to set up.`
      : `✅ Ollama is running. Download the ${st.current} model in Settings → Local AI (one click).`;
  } catch {}
}

function goOnboardStep(step) {
  // Hide all panels
  document.querySelectorAll('.onboard-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById(`onboard-panel-${step}`);
  if (panel) panel.style.display = 'block';
  if (step === 2) checkOnboardOllama();

  // Update step indicators
  document.querySelectorAll('.onboard-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    if (s === step) {
      el.style.borderBottomColor = 'var(--accent-purple)';
      el.style.color = 'var(--accent-purple)';
    } else {
      el.style.borderBottomColor = 'var(--border)';
      el.style.color = 'var(--text-muted)';
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔑 Licence (Settings → Licence + top banner)
// ─────────────────────────────────────────────────────────────────────────────

const LICENSE_BUY_URL = 'https://license.radixile.com/buy';

function licenseDate(epoch) {
  return epoch ? new Date(epoch * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

async function loadLicense() {
  licenseLastCheck = Date.now();
  try {
    State.license = await api('GET', '/api/license');
  } catch { return; }
  if (!State.license?.state) return; // signed out: api() is sending the page to sign-in
  renderLicenseBanner(State.license);
  if (document.getElementById('settings-panel-license')?.style.display !== 'none') renderLicensePanel(State.license);
}

// The licence can change while this page stays open (activated in another tab or
// window, renewed, lease ran out): look again when the window comes back into view.
var licenseLastCheck = 0; // var: loadLicense may run before this line is reached
document.addEventListener('visibilitychange', () => {
  // State.user: only once signed in (also retries if the first check failed)
  if (document.visibilityState !== 'visible' || !State.user || Date.now() - licenseLastCheck < 30000) return;
  licenseLastCheck = Date.now();
  loadLicense();
});

function renderLicenseBanner(s) {
  const bar = document.getElementById('license-banner');
  if (!bar) return;
  // Start-up checks take a few seconds: don't flash a warning, just look again
  if (s.state === 'checking') {
    bar.style.display = 'none';
    clearTimeout(renderLicenseBanner._t);
    renderLicenseBanner._t = setTimeout(loadLicense, 3000);
    return;
  }
  const show = s.state !== 'active' || !!s.message;
  bar.style.display = show ? 'flex' : 'none';
  if (!show) return;
  document.getElementById('license-banner-text').textContent =
    s.state === 'active' ? `🔑 ${s.message}` : `🔑 ${s.message || 'Activate Social-Nexus to start publishing.'} You can keep writing, planning and exporting meanwhile.`;
  const btn = document.getElementById('license-banner-btn');
  const checkFirst = s.state === 'offline' || (s.lic && s.state === 'invalid');
  btn.textContent = s.state === 'active' ? 'Renew' : checkFirst ? 'Check now' : 'Activate';
  btn.onclick = () => {
    if (checkFirst) return licenseRefresh();
    navigateTo('settings');
    switchSettingsTab('license', document.querySelector('[data-tab=license]'));
  };
}

function renderLicensePanel(s) {
  const box = document.getElementById('license-panel');
  if (!box) return;
  const isAdmin = State.user?.role === 'admin';
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'onclick') e.addEventListener('click', v); else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v);
    }
    for (const k of kids) if (k !== null && k !== undefined) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  };
  const row = (label, value) => el('div', { class: 'settings-row' },
    el('div', { class: 'settings-row-info' }, el('div', { class: 'settings-row-title' }, label)),
    el('div', { style: 'font-size:13px;color:var(--text-secondary)' }, value));
  const stateText = { active: '✅ Active', checking: '⏳ Checking…', unlicensed: '⚪ Not activated', offline: '🟠 Needs internet', expired: '🔴 Ended', invalid: '🔴 Not valid on this PC' }[s.state] || s.state;

  const parts = [];
  if (s.message) parts.push(el('div', { style: 'padding:10px 12px;border-radius:8px;background:var(--glass);margin-bottom:12px;font-size:13px' }, s.message));
  parts.push(row('Status', stateText));
  if (s.lic) {
    parts.push(row('Licensed to', s.licensee || '—'));
    parts.push(row('Edition', `${s.edition_name || s.edition}${s.type === 'coupon' ? ' (coupon)' : s.type === 'subscription' ? ' (yearly)' : ' (one-time)'}`));
    if (s.expires_at) parts.push(row(s.type === 'coupon' ? 'Coupon ends' : 'Renews / ends', licenseDate(s.expires_at)));
    if (s.updates_until) parts.push(row('Updates included until', licenseDate(s.updates_until)));
    parts.push(row('Works offline until', `${licenseDate(s.lease_until)} (checks in automatically when online)`));
    const lim = s.limits || {};
    const n = (v) => (v === -1 ? 'unlimited' : v);
    const plural = (v, word) => `${v} ${word}${v === 1 ? '' : 's'}`;
    parts.push(row('Includes', [plural(n(lim.seats), 'PC'), plural(n(lim.workspaces), 'workspace'), plural(n(lim.users), 'user'), plural(n(lim.autopilot_rules), 'autopilot rule'), plural(n(lim.seo_sites), 'SEO site')].join(' · ')));
  }

  if (!isAdmin) {
    parts.push(el('p', { style: 'margin-top:12px;font-size:13px;color:var(--text-muted)' }, 'Only the admin of this installation can activate or change the licence.'));
    box.replaceChildren(...parts);
    return;
  }

  // A licence that stopped working may just need a check-in (renewed, lifted
  // suspension, lease ran out): offer that before asking for a new key
  if (s.lic && s.state !== 'active') {
    parts.push(el('div', { style: 'margin-top:16px' },
      el('button', { class: 'btn btn-primary', onclick: licenseRefresh }, '🔄 Check licence now'),
      el('span', { style: 'margin-left:10px;font-size:12px;color:var(--text-muted)' }, 'Renewed or moved your licence? Check first. Otherwise enter a key below.')));
  }

  // Activate (key or coupon)
  if (s.state !== 'active') {
    const code = el('input', { class: 'form-input', id: 'lic-code', placeholder: 'SNXP-… / SNXS-… licence key, or SNX-XXXX-XXXX coupon', style: 'font-family:monospace' });
    const email = el('input', { class: 'form-input', id: 'lic-email', type: 'email', placeholder: 'Your email (needed for coupons)' });
    const name = el('input', { class: 'form-input', id: 'lic-name', placeholder: 'Your name or business (shown as "Licensed to")' });
    const device = el('input', { class: 'form-input', id: 'lic-device', placeholder: 'Name for this computer, e.g. "Office PC" (optional)' });
    const msg = el('div', { style: 'font-size:13px;margin-top:8px' });
    const go = el('button', { class: 'btn btn-primary', onclick: async () => {
      go.disabled = true; msg.textContent = 'Activating…'; msg.style.color = '';
      try {
        const r = await api('POST', '/api/license/activate', { key: code.value, email: email.value, name: name.value, device_name: device.value });
        State.license = r;
        toast('Social-Nexus is activated ✅', 'success');
        renderLicensePanel(r); renderLicenseBanner(r);
      } catch (err) {
        msg.textContent = err.message; msg.style.color = '#ef4444';
      } finally { go.disabled = false; }
    } }, 'Activate');
    parts.push(el('h3', { style: 'margin:20px 0 8px;font-size:15px' }, 'Activate'),
      code, el('div', { style: 'height:8px' }), email, el('div', { style: 'height:8px' }), name, el('div', { style: 'height:8px' }), device,
      el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, go,
        el('a', { class: 'btn btn-secondary', href: LICENSE_BUY_URL, target: '_blank', rel: 'noopener' }, 'Buy a licence')),
      msg,
      el('p', { style: 'font-size:12px;color:var(--text-muted);margin-top:10px' },
        'Privacy: activation sends only scrambled (hashed) computer identifiers, the computer name you type, and your email for coupons. Your posts, accounts and keys never leave this PC.'));

    // Offline activation
    const offKey = el('input', { class: 'form-input', placeholder: 'Licence key (SNXP-… / SNXS-…)', style: 'font-family:monospace' });
    const file = el('input', { type: 'file', accept: '.snlic,application/json' });
    parts.push(el('details', { style: 'margin-top:16px' },
      el('summary', { style: 'cursor:pointer;font-size:13px;color:var(--accent-blue)' }, 'No internet on this computer? Activate offline'),
      el('ol', { style: 'font-size:13px;color:var(--text-secondary);margin:8px 0 8px 18px' },
        el('li', {}, 'Enter your licence key and save the request file.'),
        el('li', {}, 'On any device with internet, open license.radixile.com/offline and upload it.'),
        el('li', {}, 'Bring back the downloaded license.snlic and import it below.')),
      offKey,
      el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center' },
        el('button', { class: 'btn btn-secondary btn-sm', onclick: async () => {
          try {
            const req = await api('POST', '/api/license/offline-request', { key: offKey.value, device_name: device.value });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(req, null, 2)], { type: 'application/json' }));
            a.download = 'activation.snreq';
            a.click();
          } catch (err) { toast(err.message, 'error'); }
        } }, '💾 Save request file'),
        file,
        el('button', { class: 'btn btn-secondary btn-sm', onclick: async () => {
          const f = file.files[0];
          if (!f) return toast('Choose the license.snlic file first', 'warning');
          try {
            const r = await api('POST', '/api/license/import', { content: await f.text() });
            State.license = r; toast('Licence imported ✅', 'success'); renderLicensePanel(r); renderLicenseBanner(r);
          } catch (err) { toast(err.message, 'error'); }
        } }, '📥 Import licence file'))));
  } else {
    parts.push(el('div', { style: 'display:flex;gap:8px;margin-top:16px;flex-wrap:wrap' },
      el('button', { class: 'btn btn-secondary', onclick: licenseRefresh }, '🔄 Check licence now'),
      s.type !== 'perpetual' ? el('a', { class: 'btn btn-secondary', href: LICENSE_BUY_URL, target: '_blank', rel: 'noopener' }, s.type === 'coupon' ? 'Buy a licence' : 'Manage / renew') : null,
      el('button', { class: 'btn btn-danger', onclick: async () => {
        if (!confirm('Deactivate this computer? Use this before moving Social-Nexus to a new PC. Your data stays here; publishing stops until you activate again.')) return;
        try {
          const r = await api('POST', '/api/license/deactivate');
          State.license = r; toast('This computer was deactivated', 'info'); renderLicensePanel(r); renderLicenseBanner(r);
        } catch (err) { toast(err.message, 'error'); }
      } }, 'Deactivate this PC')));
  }
  box.replaceChildren(...parts);
}

async function licenseRefresh() {
  try {
    const r = await api('POST', '/api/license/refresh');
    State.license = r;
    toast(r.state === 'active' ? 'Licence confirmed ✅' : (r.last_error || r.message || 'Licence checked'), r.state === 'active' ? 'success' : 'warning');
    renderLicenseBanner(r);
    renderLicensePanel(r);
  } catch (err) { toast(err.message, 'error'); }
}
