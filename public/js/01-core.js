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
if (typeof window !== 'undefined') window.State = State;

// ── Page Titles ───────────────────────────────────────────────────────────────
const PAGE_META = {
  dashboard: { title: 'Home',                   subtitle: 'Your posts, schedule and next steps' },
  generate:  { title: 'AI writer',              subtitle: 'Describe your idea; get a version for each platform' },
  compose:   { title: 'Create post',            subtitle: 'Write (or let AI write), add a picture, then publish or schedule' },
  calendar:  { title: 'Calendar',               subtitle: 'Everything planned and published. Drag a post to move it' },
  history:   { title: 'Post history',           subtitle: 'What went out, and what didn’t' },
  templates: { title: 'Templates',              subtitle: 'Save posts you reuse' },
  files:     { title: 'Files on this PC',       subtitle: 'Pictures and spreadsheets in your content folder' },
  seo:       { title: 'Website SEO',            subtitle: 'Titles, descriptions and keywords for your website' },
  aso:       { title: 'App store listing',      subtitle: 'Text for your App Store and Play Store page' },
  email:     { title: 'Email',                  subtitle: 'Your subscribers and email campaigns' },
  'sellbird': { title: 'Sales outreach',        subtitle: 'Find business customers, check drafts, then send' },
  'lead-ads':        { title: 'WhatsApp · Contacts',   subtitle: 'People who wrote to you or filled in your ad forms' },
  'leads-contacts':  { title: 'WhatsApp · Contacts',   subtitle: 'People who wrote to you or filled in your ad forms' },
  'leads-inbox':     { title: 'WhatsApp · Chats',      subtitle: 'Reply to customers on WhatsApp and Messenger' },
  'leads-bot':       { title: 'WhatsApp · Auto-replies', subtitle: 'Answer customers automatically, day and night' },
  'leads-templates': { title: 'WhatsApp · Templates', subtitle: 'Approved messages for broadcasts and first contact' },
  'leads-broadcast': { title: 'WhatsApp · Broadcasts', subtitle: 'Send one message to many contacts' },
  'leads-settings':  { title: 'WhatsApp · Setup',      subtitle: 'Connect your WhatsApp Business number' },
  adcopy:    { title: 'Ads & press releases',   subtitle: 'Ad text for Google and Meta, and press releases' },
  media:     { title: 'AI images & video',      subtitle: 'Make pictures and short videos with AI' },
  hashtags:  { title: 'Hashtags',               subtitle: 'Hashtag ideas for your topic' },
  utm:       { title: 'Link tracker',           subtitle: 'Links that show which post brought a visitor' },
  brand:     { title: 'Brand kit',              subtitle: 'Your business name, voice and colours, used whenever AI writes' },
  analytics:         { title: 'Results',            subtitle: 'Likes, comments and reach of your posts' },
  'tools-directory': { title: 'Other AI tools',     subtitle: 'Useful free and paid AI tools' },
  admin:             { title: 'Users & access',     subtitle: 'Who can use Social-Nexus on this PC' },
  settings:          { title: 'Settings',           subtitle: 'Accounts, AI, email, backups and licence' },
  clients:           { title: 'Clients',            subtitle: 'A separate brand for each client' },
  feeds:             { title: 'Blog & news feeds', subtitle: 'New articles become posts automatically' },
  inbox:             { title: 'Inbox',              subtitle: 'Comments on your posts' },
  library:           { title: 'Media library',      subtitle: 'Your pictures and videos' },
  bio:               { title: 'Link in bio',        subtitle: 'One page with all your links' },
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

// Screens that moved into Settings
const PAGE_REDIRECTS = { 'user-settings': ['settings', 'ai'] };

function navigateTo(page) {
  if (PAGE_REDIRECTS[page]) {
    const [to, tab] = PAGE_REDIRECTS[page];
    State.pendingSettingsTab = tab;
    page = to;
  }
  // Reset scroll position so new page always starts cleanly at the top
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    const mainEl = document.querySelector('.main');
    if (mainEl) mainEl.scrollTop = 0;
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.scrollTop = 0;
  } catch (e) {}

  // Update nav items
  document.querySelectorAll('.nav-item, .nav-sub-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${page}`);
  if (navEl) navEl.classList.add('active');

  // Update pages
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  // Pages under "More tools": keep that group open so the current page is visible
  if (document.getElementById(`nav-${page}`)?.closest?.('#nav-more')) {
    if (typeof toggleMoreTools === 'function') toggleMoreTools(true);
    else if (typeof window.toggleMoreTools === 'function') window.toggleMoreTools(true);
  }

  // Keep Ad Leads & CRM submenu open when on any of its split screens
  const isLeadPage = ['lead-ads', 'leads-contacts', 'leads-inbox', 'leads-bot', 'leads-templates', 'leads-broadcast', 'leads-settings'].includes(page);
  const submenu = document.getElementById('sub-nav-lead-ads');
  const chevron = document.getElementById('chevron-lead-ads');
  if (isLeadPage) {
    if (submenu) submenu.style.display = 'flex';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    const parentNav = document.getElementById('nav-lead-ads');
    if (parentNav) parentNav.classList.add('active');

    // Highlight active submenu item
    document.querySelectorAll('#sub-nav-lead-ads .nav-sub-item').forEach(el => el.classList.remove('active'));
    const subMap = {
      'lead-ads': 'nav-sub-leads-contacts',
      'leads-contacts': 'nav-sub-leads-contacts',
      'leads-inbox': 'nav-sub-leads-inbox',
      'leads-bot': 'nav-sub-leads-bot',
      'leads-templates': 'nav-sub-leads-templates',
      'leads-broadcast': 'nav-sub-leads-broadcast',
      'leads-settings': 'nav-sub-leads-settings',
    };
    const activeSub = document.getElementById(subMap[page]);
    if (activeSub) activeSub.classList.add('active');
  }

  // Compose opens in "Schedule" mode with a time 1 hour ahead (unless one is already picked)
  if (page === 'compose') {
    if (typeof setPostMode === 'function') setPostMode(State.postMode);
    else if (typeof window.setPostMode === 'function') window.setPostMode(State.postMode);
  }

  // Update header
  const meta = PAGE_META[page] || {};
  document.getElementById('header-title').textContent = meta.title || page;
  document.getElementById('header-subtitle').textContent = meta.subtitle || '';

  State.currentPage = page;

  // Page-specific load hooks (safely checking existence so no ReferenceError is thrown)
  const hooks = {
    dashboard: () => (typeof window.loadDashboard === 'function' ? window.loadDashboard() : (typeof loadDashboard === 'function' ? loadDashboard() : null)),
    calendar:  () => (typeof window.renderCalendar === 'function' ? window.renderCalendar(State.calendarDate) : (typeof renderCalendar === 'function' ? renderCalendar(State.calendarDate) : null)),
    history:   () => (typeof window.loadHistory === 'function' ? window.loadHistory() : (typeof loadHistory === 'function' ? loadHistory() : null)),
    analytics: () => (typeof window.loadAnalytics === 'function' ? window.loadAnalytics() : (typeof loadAnalytics === 'function' ? loadAnalytics() : null)),
    files:     () => (typeof window.loadLocalFiles === 'function' ? window.loadLocalFiles() : (typeof loadLocalFiles === 'function' ? loadLocalFiles() : null)),
    compose:   () => {
      if (typeof window.loadScheduled === 'function') window.loadScheduled();
      else if (typeof loadScheduled === 'function') loadScheduled();
      if (typeof window.loadModels === 'function') window.loadModels();
      else if (typeof loadModels === 'function') loadModels();
      if (typeof window.loadPostExtras === 'function') window.loadPostExtras(); // signatures, quick platform choices
    },
    feeds:     () => (typeof window.loadFeedsPage === 'function' ? window.loadFeedsPage() : null),
    templates: () => (typeof window.loadTemplates === 'function' ? window.loadTemplates() : (typeof loadTemplates === 'function' ? loadTemplates() : null)),
    utm:       () => (typeof window.loadUTMLinks === 'function' ? window.loadUTMLinks() : (typeof loadUTMLinks === 'function' ? loadUTMLinks() : null)),
    email:     () => (typeof window.loadEmailPage === 'function' ? window.loadEmailPage() : (typeof loadEmailPage === 'function' ? loadEmailPage() : null)),
    sellbird:  () => (typeof window.loadSellbird === 'function' ? window.loadSellbird() : (typeof loadSellbird === 'function' ? loadSellbird() : null)),
    'lead-ads':        () => (typeof window.loadLeadPipeline === 'function' ? window.loadLeadPipeline() : (typeof loadLeadPipeline === 'function' ? loadLeadPipeline() : null)),
    'leads-contacts':   () => (typeof window.loadLeadPipeline === 'function' ? window.loadLeadPipeline() : (typeof loadLeadPipeline === 'function' ? loadLeadPipeline() : null)),
    'leads-inbox':      () => (typeof window.loadWhatsAppConversations === 'function' ? window.loadWhatsAppConversations() : (typeof loadWhatsAppConversations === 'function' ? loadWhatsAppConversations() : null)),
    'leads-broadcast':  () => (typeof window.loadBroadcastPage === 'function' ? window.loadBroadcastPage() : null),
    'leads-templates':  () => (typeof window.loadWhatsAppTemplates === 'function' ? window.loadWhatsAppTemplates() : null),
    'leads-bot':        () => (typeof window.loadWhatsAppBot === 'function' ? window.loadWhatsAppBot() : null),
    'leads-settings':   () => (typeof window.loadLeadPipeline === 'function' ? window.loadLeadPipeline() : (typeof loadLeadPipeline === 'function' ? loadLeadPipeline() : null)),
    brand:     () => (typeof window.loadBrandKit === 'function' ? window.loadBrandKit() : (typeof loadBrandKit === 'function' ? loadBrandKit() : null)),
    seo:       () => (typeof window.loadTrackedKeywords === 'function' ? window.loadTrackedKeywords() : (typeof loadTrackedKeywords === 'function' ? loadTrackedKeywords() : null)),
    settings:  () => (typeof window.loadSettings === 'function' ? window.loadSettings() : (typeof loadSettings === 'function' ? loadSettings() : null)),
    clients:   () => (typeof window.loadClients === 'function' ? window.loadClients() : (typeof loadClients === 'function' ? loadClients() : null)),
    generate:  () => (typeof window.loadModels === 'function' ? window.loadModels() : (typeof loadModels === 'function' ? loadModels() : null)),
    media:     () => (typeof window.loadModels === 'function' ? window.loadModels() : (typeof loadModels === 'function' ? loadModels() : null)),
    library:   () => (typeof window.loadMediaLibrary === 'function' ? window.loadMediaLibrary() : (typeof loadMediaLibrary === 'function' ? loadMediaLibrary() : null)),
    inbox:     () => (typeof window.loadInbox === 'function' ? window.loadInbox() : (typeof loadInbox === 'function' ? loadInbox() : null)),
    bio:       () => (typeof window.loadBio === 'function' ? window.loadBio() : (typeof loadBio === 'function' ? loadBio() : null)),
    'user-settings': () => (typeof window.loadUserSettings === 'function' ? window.loadUserSettings() : (typeof loadUserSettings === 'function' ? loadUserSettings() : null)),
    'tools-directory': () => (typeof window.renderToolsDirectory === 'function' ? window.renderToolsDirectory() : (typeof renderToolsDirectory === 'function' ? renderToolsDirectory() : null)),
    admin:     () => (typeof window.loadAdminDashboard === 'function' ? window.loadAdminDashboard() : (typeof loadAdminDashboard === 'function' ? loadAdminDashboard() : null)),
  };

  try {
    if (hooks[page]) hooks[page]();
  } catch (err) {
    console.warn(`[Navigation] Error running hook for page "${page}":`, err);
  }
}

// Attach nav click handlers
document.querySelectorAll('.nav-item[data-page]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(el.dataset.page);
  });
});

// Ad Leads & CRM Submenu Navigation
function toggleLeadSubmenu(e) {
  if (e) {
    e.preventDefault?.();
    e.stopPropagation?.();
  }
  const submenu = document.getElementById('sub-nav-lead-ads');
  const chevron = document.getElementById('chevron-lead-ads');
  if (!submenu) return;
  const isHidden = window.getComputedStyle ? (window.getComputedStyle(submenu).display === 'none') : (submenu.style.display === 'none');
  const nextDisplay = isHidden ? 'flex' : 'none';
  submenu.style.display = nextDisplay;
  if (chevron) chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

function navigateToLeadTab(tab, subItemEl) {
  const pageMap = {
    inbound: 'lead-ads',
    contacts: 'lead-ads',
    inbox: 'leads-inbox',
    outbound: 'leads-broadcast',
    broadcast: 'leads-broadcast',
    settings: 'leads-settings',
  };
  const targetPage = pageMap[tab] || 'lead-ads';
  navigateTo(targetPage);
}

window.navigateTo = navigateTo;
window.toggleLeadSubmenu = toggleLeadSubmenu;
window.navigateToLeadTab = navigateToLeadTab;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

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
