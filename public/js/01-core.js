// Social-Nexus app — Core: state, platform list, navigation, API calls, messages.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

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
  // Not postable yet (see services/platforms/available.js): labels kept for older posts
  youtube:         { label: 'YouTube',          icon: '▶️', class: 'youtube', hidden: true },
  google_business: { label: 'Google Business',  icon: '🏢', class: 'google_business' },
  tiktok:          { label: 'TikTok',           icon: '🎵', class: 'tiktok', hidden: true },
  threads:         { label: 'Threads',          icon: '🧵', class: 'threads'         },
  bluesky:         { label: 'Bluesky',          icon: '🦋', class: 'bluesky'         },
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
    library:          loadMediaLibrary,
    inbox:            loadInbox,
    bio:              loadBio,
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
  // A page instead of data: the server doesn't know this action yet (an older
  // server still running after an update sends its main page for unknown addresses)
  if (res.ok && /^\/(api|auth|users)\//.test(path) && !(res.headers.get('content-type') || '').includes('json')) {
    throw new Error('The app’s server doesn’t know this action yet. It was started before an update: close Social-Nexus completely (tray icon → Quit) and start it again.');
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
