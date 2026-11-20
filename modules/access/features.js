// Feature catalogue (data only). Canonical list: docs/billing/ACCESS-REQUIREMENTS.md 4.1.
// A plan switches features on and off (billing B0/B1). Permissions and menu items name the feature they need,
// and tests/access/catalogue.test.js fails on any key that is not listed here.
//
// Fields: key, name, module, kind ('module' | 'capability' | 'access'), requires (all of), requiresAny (one of),
// editions, beta, description (customer wording, used in upgrade prompts).
// A0: nothing reads plans yet; every feature counts as on (PLAN N5 seeds every plan with every feature on).

const BOTH = ['server', 'desktop'];

const f = (key, name, module, extra = {}) => ({
  key, name, module, kind: 'capability', requires: [], requiresAny: [], editions: BOTH, beta: false,
  description: name, ...extra,
});

const FEATURES = [
  f('core', 'Home, settings, team, help, billing and usage', 'core', { kind: 'access' }),

  // Social publishing
  f('social_publishing', 'Create, schedule and publish posts', 'social', { kind: 'module' }),
  f('approvals', 'Approval workflow and client approvals', 'social', { requires: ['social_publishing'] }),
  f('bulk_schedule', 'Schedule from Excel', 'social', { requires: ['social_publishing'] }),
  f('content_studio', 'Content Studio', 'social', { requires: ['social_publishing'] }),
  f('social_inbox', 'Comments on your posts', 'social', { requires: ['social_publishing'] }),
  f('analytics', 'Results', 'social', { requires: ['social_publishing'] }),
  f('analytics_advanced', 'Exports, competitor and best-time reports', 'social', { requires: ['analytics'] }),
  f('media_library', 'Media library, brand kit, post templates and hashtags', 'social'),

  // AI content
  f('ai_writer', 'AI writer, captions and hashtags', 'ai', { kind: 'module' }),
  f('ai_images', 'AI images', 'ai'),
  f('ai_video', 'AI video', 'ai'),
  f('ai_tools', 'Other AI tools', 'ai'),
  f('ai_assistant', 'In-app AI assistant', 'ai'),
  f('ai_premium_models', 'Stronger AI models', 'ai'),
  f('byok', 'Use your own AI keys', 'ai', { kind: 'access' }),

  // Website and SEO
  f('seo_tools', 'Keywords, audits, meta tags and sitemap maker', 'seo', { kind: 'module' }),
  f('seo_autopilot', 'SEO autopilot', 'seo', { requires: ['seo_tools'] }),
  f('rss_feeds', 'Blog and news feeds auto-posting', 'seo', { requires: ['social_publishing'] }),
  f('link_in_bio', 'Link in bio', 'seo'),
  f('link_tracker', 'Link tracker (UTM)', 'seo'),
  f('app_store', 'App store listing', 'seo'),

  // Advertising
  f('ad_copy', 'Ads and press releases', 'ads', { kind: 'module' }),
  f('meta_lead_ads', 'Meta lead ads into Contacts', 'ads'),
  f('meta_reports', 'Meta reports', 'ads'),

  // Sales and CRM
  f('crm', 'Leads and CRM pipeline', 'sales', { kind: 'module' }),
  f('email_outreach', 'Outreach sequences', 'sales'),
  f('email_campaigns', 'E-mail campaigns and newsletters', 'sales'),
  f('email_mailboxes', 'Connect domain mailboxes; campaign replies in Nexus', 'sales', { requires: ['email_outreach'] }),
  f('email_oauth', 'Connect mailboxes with Google or Microsoft sign-in', 'sales', { requires: ['email_mailboxes'] }),
  f('reply_ai', 'AI intent and action items on replies', 'sales', { requires: ['email_mailboxes'] }),
  f('reply_auto', 'Automatic replies for safe intents', 'sales', { requires: ['reply_ai'] }),
  f('campaign_variants', 'A/B variants, strategy templates and warm-up', 'sales', { requires: ['email_outreach'] }),
  f('sms_channel', 'SMS provider, two-way SMS and SMS campaign steps', 'sales'),

  // WhatsApp
  f('whatsapp_chats', 'WhatsApp chats, contacts and setup', 'whatsapp', { kind: 'module' }),
  f('whatsapp_broadcasts', 'WhatsApp broadcasts', 'whatsapp', { requires: ['whatsapp_chats'] }),
  f('whatsapp_templates', 'WhatsApp message templates', 'whatsapp', { requires: ['whatsapp_chats'] }),
  f('whatsapp_bot', 'WhatsApp auto-replies (menu, keywords, FAQ)', 'whatsapp', { requires: ['whatsapp_chats'] }),
  f('whatsapp_bot_ai', 'AI answers on WhatsApp', 'whatsapp', { requires: ['whatsapp_bot'] }),
  f('contact_sync', 'Contact sync', 'whatsapp', { requires: ['whatsapp_chats'] }),

  // Website chat
  f('web_chat', 'Website chat widget (menu, keywords, FAQ, live replies)', 'webchat', { kind: 'module' }),
  f('web_chat_ai', 'AI answers in the website chat', 'webchat', { requires: ['web_chat'] }),
  f('white_label', 'Your own bottom line, no Radixile branding', 'webchat'),

  // AI agents
  f('ai_knowledge_base', 'AI knowledge base', 'agents', { requiresAny: ['whatsapp_bot_ai', 'web_chat_ai', 'ai_agents'] }),
  f('ai_agents', 'AI sales agents', 'agents', { requiresAny: ['whatsapp_chats', 'web_chat'] }),

  // Access and admin
  f('custom_roles', 'Custom roles', 'admin'),
  f('teams_routing', 'Teams, routing rules and agent status', 'admin', { requiresAny: ['whatsapp_chats', 'web_chat'] }),
  f('audit_log', 'Your organisation’s audit trail and export', 'admin'),
  f('priority_support', 'Faster support', 'admin', { kind: 'access' }),
  f('api_access', 'API keys', 'admin', { kind: 'access' }),
];

const BY_KEY = Object.freeze(Object.fromEntries(FEATURES.map((x) => [x.key, Object.freeze(x)])));

module.exports = { FEATURES: Object.freeze(FEATURES.map((x) => BY_KEY[x.key])), BY_KEY, get: (key) => BY_KEY[key] || null };
