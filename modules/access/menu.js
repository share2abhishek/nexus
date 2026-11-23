// Menu registry (data only). Spec: docs/platform/ACCESS-AND-ENTITLEMENTS.md 8.1.
// One entry per sidebar item of public/index.html (every data-page, plus the two action items). A0 only declares
// them: the sidebar is still static HTML. B1b renders it from GET /api/me/menu using this registry.
// whenLocked: 'show-locked' when the PLAN lacks the feature (a lock and an upgrade prompt); a ROLE that lacks the
// permission always hides the item. tests/access/catalogue.test.js checks every page, permission and feature here.

const BOTH = ['server', 'desktop'];
const m = (id, group, label, permission, feature, order, extra = {}) => ({
  id, group, label, page: id, permission, feature, order, editions: BOTH, whenLocked: 'show-locked', ...extra,
});

const GROUPS = [
  { id: 'social', label: 'Social Media Management', order: 10 },
  { id: 'seo', label: 'Website & SEO', order: 20 },
  { id: 'outreach', label: 'Outreach & Outbound', order: 30 },
  { id: 'inbound', label: 'Inbound & Bot', order: 40 },
  { id: 'settings', label: 'Settings', order: 50 },
];

const MENU = [
  m('dashboard', 'social', 'Home', 'content.view', 'core', 10, { whenLocked: 'hide' }),
  m('compose', 'social', 'Create post', 'content.create', 'social_publishing', 20),
  m('generate', 'social', 'AI writer', 'ai.text', 'ai_writer', 30),
  m('content-studio', 'social', 'Content Studio', 'content.create', 'content_studio', 40, { page: 'studio' }),
  m('calendar', 'social', 'Calendar', 'content.view', 'social_publishing', 50),
  m('bulk-schedule', 'social', 'Schedule from Excel', 'content.create', 'bulk_schedule', 60, { page: null, action: 'openBulkImport' }),
  m('history', 'social', 'Post history', 'content.view', 'social_publishing', 70),
  m('media', 'social', 'AI images & video', 'ai.image', 'ai_images', 80),
  m('tools-directory', 'social', 'Other AI tools', 'tools.use', 'ai_tools', 90),
  m('library', 'social', 'Media library', 'media.view', 'media_library', 100),
  m('brand', 'social', 'Brand kit', 'media.view', 'media_library', 110),
  m('templates', 'social', 'Templates', 'media.view', 'media_library', 120),
  m('hashtags', 'social', 'Hashtags', 'media.view', 'media_library', 130),
  m('inbox', 'social', 'Comments', 'inbox.view', 'social_inbox', 140),
  m('analytics', 'social', 'Results', 'analytics.view', 'analytics', 150),
  m('clients', 'social', 'Clients', 'org.view', 'core', 160, { whenLocked: 'hide' }),

  m('seo', 'seo', 'Website SEO', 'seo.view', 'seo_tools', 10),
  m('feeds', 'seo', 'Blog & news feeds', 'feeds.manage', 'rss_feeds', 20),
  m('bio', 'seo', 'Link in bio', 'bio.manage', 'link_in_bio', 30),
  m('utm', 'seo', 'Link tracker', 'links.manage', 'link_tracker', 40),
  m('aso', 'seo', 'App store listing', 'appstore.manage', 'app_store', 50),

  m('crm-pipeline', 'outreach', 'Leads & CRM', 'leads.view', 'crm', 10),
  m('sellbird', 'outreach', 'Email & Outreach', 'outreach.view', 'email_outreach', 20),
  m('leads-broadcast', 'outreach', 'WhatsApp Outreach', 'broadcasts.view', 'whatsapp_broadcasts', 25),
  m('email', 'outreach', 'Email campaigns', 'email.campaigns.manage', 'email_campaigns', 30, { hidden: true }),
  m('adcopy', 'outreach', 'Ads & press releases', 'ads.create', 'ad_copy', 40),

  m('leads-inbox', 'inbound', 'Chat', 'chats.view', 'whatsapp_chats', 10),
  m('leads-bot', 'inbound', 'Auto-replies', 'bot.view', 'whatsapp_bot', 20),
  m('ai-knowledge-base', 'inbound', 'AI Knowledge Base', 'kb.manage', 'ai_knowledge_base', 30, { badge: 'ai' }),
  m('contact-sync', 'inbound', 'Contact Sync', 'contactsync.manage', 'contact_sync', 40),
  m('meta-reports', 'inbound', 'Meta Reports', 'reports.meta.view', 'meta_reports', 50),
  m('leads-templates', 'inbound', 'Templates', 'templates.manage', 'whatsapp_templates', 60),
  m('lead-ads', 'inbound', 'Contacts', 'contacts.view', 'whatsapp_chats', 70),
  m('leads-settings', 'inbound', 'Setup', 'integrations.manage', 'whatsapp_chats', 80),

  m('settings', 'settings', 'Settings', 'account.profile.manage', 'core', 10, { whenLocked: 'hide' }),
  m('whats-new', 'settings', 'What’s new', 'account.profile.manage', 'core', 20, { whenLocked: 'hide' }),
  m('admin', 'settings', 'Users & access', 'org.members.manage', 'core', 30, { editions: ['desktop'], whenLocked: 'hide' }),
  m('files', 'settings', 'Files on this PC', 'content.view', 'core', 40, { editions: ['desktop'], whenLocked: 'hide' }),
];

// Every item, children included, flattened (an id may appear as a parent and its first child: 'leads-inbox')
function flat(items = MENU, out = []) {
  for (const it of items) { out.push(it); if (it.children) flat(it.children, out); }
  return out;
}

module.exports = { GROUPS, MENU, flat };
