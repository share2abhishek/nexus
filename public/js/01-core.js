// NexaDrip app — Core: state, platform list, navigation, API calls, messages.
// One of the files in public/js, loaded in order by index.html (they share one
// global scope, like the single app.js they came from).

/* ─────────────────────────────────────────────────────────────────────────────
   NexaDrip — Frontend Application Script
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
  email:     { title: 'Email & Outreach',       subtitle: 'Cold outreach sequences, email marketing campaigns and newsletters' },
  'sellbird': { title: 'Email & Outreach',       subtitle: 'Cold outreach sequences, email marketing campaigns and newsletters' },
  'crm-pipeline':    { title: 'Lead CRM & Pipeline',   subtitle: 'Visual sales pipeline, deal tracking, lead qualification & Salesforce handover' },
  'lead-ads':        { title: 'WhatsApp · Contacts',   subtitle: 'People who wrote to you or filled in your ad forms' },
  'leads-contacts':  { title: 'WhatsApp · Contacts',   subtitle: 'People who wrote to you or filled in your ad forms' },
  'leads-inbox':     { title: 'WhatsApp · Chats',      subtitle: 'Reply to customers on WhatsApp and Messenger' },
  'leads-bot':       { title: 'WhatsApp · Auto-replies', subtitle: 'Answer customers automatically, day and night' },
  'ai-knowledge-base': { title: 'AI Chat Knowledge Base', subtitle: 'Train & manage what your AI chatbot knows across WhatsApp & Website Live Chat' },
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
  admin:             { title: 'Users & access',     subtitle: 'Who can use NexaDrip on this PC' },
  settings:          { title: 'Settings',           subtitle: 'Accounts, AI, email, backups and licence' },
  clients:           { title: 'Clients',            subtitle: 'A separate brand for each client' },
  feeds:             { title: 'Blog & news feeds', subtitle: 'New articles become posts automatically' },
  inbox:             { title: 'Inbox',              subtitle: 'Comments on your posts' },
  library:           { title: 'Media library',      subtitle: 'Your pictures and videos' },
  bio:               { title: 'Link in bio',        subtitle: 'One page with all your links' },
};

// Official vector SVG brand icons
const SOCIAL_ICONS = {
  linkedin: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
  facebook: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  instagram: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="#E1306C"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,
  pinterest: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="#E60023"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345-.09.375-.291 1.199-.332 1.357-.053.211-.174.256-.402.151-1.499-.696-2.435-2.889-2.435-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z"/></svg>`,
  twitter: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  google_business: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/></svg>`,
  threads: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.186 24C5.58 24 0 18.528 0 12S5.58 0 12.186 0c6.438 0 11.83 5.253 12.158 11.667h-3.473c-.314-4.516-4.148-8.194-8.685-8.194-4.793 0-8.713 3.92-8.713 8.713 0 4.793 3.92 8.713 8.713 8.713 3.655 0 6.762-2.247 8.083-5.467h-4.307a3.86 3.86 0 0 1-3.776 3.014c-2.128 0-3.86-1.732-3.86-3.86 0-2.128 1.732-3.86 3.86-3.86 1.636 0 3.033 1.026 3.606 2.473h3.513C22.25 9.07 17.65 6.2 12.186 6.2c-3.203 0-5.8 2.597-5.8 5.8s2.597 5.8 5.8 5.8c2.052 0 3.864-1.071 4.908-2.697.525.845 1.252 1.542 2.126 2.037C17.608 21.848 15.02 24 12.186 24z"/></svg>`,
  bluesky: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="#0085FF"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.765.139 2.342 0 3.68 0 4.606c0 3.844 2.14 13.064 3.774 15.111C5.228 21.547 7.784 21.9 9.3 21.4c2.254-.743 3.037-3.044 2.7-5.4.337 2.356 1.12 4.657 3.374 5.4 1.516.5 4.072.147 5.526-1.683C22.44 17.67 24 8.45 24 4.606c0-.926-.139-2.264-.902-2.841-.659-.499-1.664-.821-4.3-1.041C16.046 4.747 13.087 8.686 12 10.8z"/></svg>`,
  whatsapp: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="#25D366"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm5.43 12.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.06 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/></svg>`,
  youtube: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
  tiktok: `<svg class="platform-icon-svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.24 1.07-.14 1.61.24 1.64 1.82 2.89 3.5 2.76 1.37-.05 2.6-1.01 2.94-2.33.15-.55.19-1.12.19-1.69V.02h.48z"/></svg>`
};

// ── Platform Config ───────────────────────────────────────────────────────────
const PLATFORMS = {
  linkedin:        { label: 'LinkedIn',         icon: SOCIAL_ICONS.linkedin,        class: 'linkedin'        },
  facebook:        { label: 'Facebook',         icon: SOCIAL_ICONS.facebook,        class: 'facebook'        },
  instagram:       { label: 'Instagram',        icon: SOCIAL_ICONS.instagram,       class: 'instagram'       },
  pinterest:       { label: 'Pinterest',        icon: SOCIAL_ICONS.pinterest,       class: 'pinterest'       },
  twitter:         { label: 'Twitter/X',        icon: SOCIAL_ICONS.twitter,         class: 'twitter'         },
  youtube:         { label: 'YouTube',          icon: SOCIAL_ICONS.youtube,         class: 'youtube', hidden: true },
  google_business: { label: 'Google Business',  icon: SOCIAL_ICONS.google_business, class: 'google_business' },
  tiktok:          { label: 'TikTok',           icon: SOCIAL_ICONS.tiktok,          class: 'tiktok', hidden: true },
  threads:         { label: 'Threads',          icon: SOCIAL_ICONS.threads,         class: 'threads'         },
  bluesky:         { label: 'Bluesky',          icon: SOCIAL_ICONS.bluesky,         class: 'bluesky'         },
  whatsapp:        { label: 'WhatsApp',         icon: SOCIAL_ICONS.whatsapp,        class: 'whatsapp'        },
};

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

// Screens that moved or merged
const PAGE_REDIRECTS = {
  'user-settings': ['settings', 'ai'],
  'email': ['sellbird', 'newsletters'],
};

function navigateTo(page) {
  // Close mobile sidebar if open
  if (typeof closeSidebar === 'function') closeSidebar();

  if (PAGE_REDIRECTS[page]) {
    const [to, tab] = PAGE_REDIRECTS[page];
    if (to === 'settings') {
      State.pendingSettingsTab = tab;
    } else if (to === 'sellbird') {
      setTimeout(() => {
        if (typeof switchSellbirdTab === 'function') switchSellbirdTab(tab);
      }, 50);
    }
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
  const isLeadPage = ['lead-ads', 'leads-contacts', 'leads-inbox', 'leads-bot', 'ai-knowledge-base', 'leads-templates', 'leads-broadcast', 'leads-settings'].includes(page);
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
      'ai-knowledge-base': 'nav-sub-ai-knowledge-base',
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
    sellbird:  () => {
      if (typeof window.loadSellbird === 'function') window.loadSellbird();
      else if (typeof loadSellbird === 'function') loadSellbird();
      if (typeof window.loadEmailCampaigns === 'function') window.loadEmailCampaigns();
      if (typeof window.loadSubscribers === 'function') window.loadSubscribers();
    },
    'crm-pipeline':    () => (typeof window.loadCrmPipeline === 'function' ? window.loadCrmPipeline() : null),
    'lead-ads':        () => (typeof window.loadLeadPipeline === 'function' ? window.loadLeadPipeline() : null),
    'leads-contacts':   () => (typeof window.loadLeadPipeline === 'function' ? window.loadLeadPipeline() : null),
    'leads-inbox':      () => {
      if (typeof window.loadLeadPipeline === 'function') window.loadLeadPipeline();
      if (typeof window.loadWhatsAppConversations === 'function') window.loadWhatsAppConversations();
    },
    'leads-broadcast':  () => {
      if (typeof window.loadLeadPipeline === 'function') window.loadLeadPipeline();
      if (typeof window.loadBroadcastPage === 'function') window.loadBroadcastPage();
    },
    'leads-templates':  () => {
      if (typeof window.loadLeadPipeline === 'function') window.loadLeadPipeline();
      if (typeof window.loadWhatsAppTemplates === 'function') window.loadWhatsAppTemplates();
    },
    'leads-bot':        () => {
      if (typeof window.loadLeadPipeline === 'function') window.loadLeadPipeline();
      if (typeof window.loadWhatsAppBot === 'function') window.loadWhatsAppBot();
    },
    'ai-knowledge-base': () => {
      if (typeof window.loadLeadPipeline === 'function') window.loadLeadPipeline();
      if (typeof window.loadAiKnowledgeBase === 'function') window.loadAiKnowledgeBase();
    },
    'leads-settings':   () => (typeof window.loadLeadPipeline === 'function' ? window.loadLeadPipeline() : null),
    brand:     () => (typeof window.loadBrandKit === 'function' ? window.loadBrandKit() : (typeof loadBrandKit === 'function' ? loadBrandKit() : null)),
    // Server edition: open on the Autopilot tab the first time
    seo:       () => (typeof loadFeatures === 'function' ? loadFeatures().then(f => { if (f.seo_autopilot && !State.seoTabChosen) { State.seoTabChosen = true; switchSeoTab('autopilot'); } }) : null),
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

function toggleSidebar(force) {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  const isOpen = force !== undefined ? force : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', isOpen);
  if (backdrop) backdrop.classList.toggle('active', isOpen);
  document.body.classList.toggle('sidebar-mobile-open', isOpen);
}

function closeSidebar() {
  toggleSidebar(false);
}

window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;

// Close mobile sidebar on Escape key or desktop resize
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) closeSidebar();
});

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
    throw new Error('Can’t reach the NexaDrip server. Make sure the app is running, then try again.');
  }
  // A page instead of data: the server doesn't know this action yet (an older
  // server still running after an update sends its main page for unknown addresses)
  if (res.ok && /^\/(api|auth|users)\//.test(path) && !(res.headers.get('content-type') || '').includes('json')) {
    throw new Error('The app’s server doesn’t know this action yet. It was started before an update: close NexaDrip completely (tray icon → Quit) and start it again.');
  }
  const data = await res.json().catch(() => ({}));

  // Signed out (the session ended): go to sign-in. Other 401s (e.g. "your current
  // password is not right") are shown as messages, not a sudden sign-out.
  if (res.status === 401 && (data.redirect === '/login' || data.error === 'Not authenticated' || !data.error)) {
    window.location.href = '/login.html';
    return;
  }
  if (!res.ok) {
    if (data.error) throw new Error(data.error);
    // No message from the server: say what it means instead of "HTTP 404"
    if (res.status === 404) throw new Error('The app’s server doesn’t know this action. It was probably started before an update: close NexaDrip completely and start it again.');
    if (res.status >= 500) throw new Error('Something went wrong in the app’s server. Try again; if it keeps happening, restart NexaDrip.');
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
