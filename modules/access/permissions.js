// Permission catalogue and role grants (data only).
// Keys: docs/billing/ACCESS-REQUIREMENTS.md 5.3 (format area.action). Fields: docs/platform/ACCESS-AND-ENTITLEMENTS.md 6.2.
//
// Entry fields:
//   key, scope ('workspace' | 'org' | 'billing' | 'account' | 'platform'), module,
//   category (read|create|edit|delete|publish|send|automate|ai|upload|export|billing|admin|account|settings),
//   feature (feature key, or { anyOf: [...] }, or null), limit (limit key or null), meter (channel or null),
//   risk ('low' | 'high'), requiresVerifiedEmail, editions, scoped (a data scope applies to the grant).
//
// WORKSPACE_ROLES holds TODAY's grants (services/rbac.js MATRIX before A0, kept equal by
// tests/access/characterization.test.js). The larger role list of ACCESS-REQUIREMENTS 5.2 arrives in R1.
// Keys with no role are granted to nobody yet (only the legacy staff bypass passes them).

const BOTH = ['server', 'desktop'];

const p = (key, category, feature, extra = {}) => ({
  key, scope: 'workspace', module: key.split('.')[0], category, feature: feature || null,
  limit: null, meter: null, risk: 'low', requiresVerifiedEmail: false, editions: BOTH, scoped: false, ...extra,
});
const any = (...keys) => ({ anyOf: keys });

const PERMISSIONS = [
  // content
  p('content.view', 'read', 'social_publishing', { scoped: true }),
  p('content.create', 'create', 'social_publishing'),
  p('content.edit', 'edit', 'social_publishing', { scoped: true }),
  p('content.delete', 'delete', 'social_publishing', { scoped: true, risk: 'high' }),
  p('content.submit', 'edit', 'social_publishing'),
  p('content.approve', 'edit', 'approvals'),
  p('content.comment', 'create', 'social_publishing'),
  p('content.schedule', 'publish', 'social_publishing'),
  p('content.publish', 'publish', 'social_publishing', { risk: 'high' }),
  p('content.templates.manage', 'edit', 'media_library'),
  p('content.series.manage', 'edit', 'social_publishing'),
  // social
  p('social.manage', 'settings', 'social_publishing', { risk: 'high' }),
  // analytics
  p('analytics.view', 'read', 'analytics'),
  p('analytics.export', 'export', 'analytics_advanced'),
  p('reports.meta.view', 'read', 'meta_reports'),
  // media
  p('media.view', 'read', 'media_library'),
  p('media.upload', 'upload', 'media_library', { limit: 'storage' }),
  p('media.delete', 'delete', 'media_library', { scoped: true }),
  // AI
  p('ai.text', 'ai', 'ai_writer', { meter: 'AI_CREDIT', requiresVerifiedEmail: true }),
  p('ai.image', 'ai', 'ai_images', { meter: 'AI_CREDIT', requiresVerifiedEmail: true }),
  p('ai.video', 'ai', 'ai_video', { meter: 'AI_CREDIT', requiresVerifiedEmail: true }),
  p('ai.assist', 'ai', 'ai_assistant', { meter: 'AI_CREDIT', requiresVerifiedEmail: true }),
  // social inbox (comments)
  p('inbox.view', 'read', 'social_inbox'),
  p('inbox.reply', 'send', 'social_inbox'),
  // chats (WhatsApp and website chat)
  p('chats.view', 'read', any('whatsapp_chats', 'web_chat'), { scoped: true }),
  p('chats.reply', 'send', any('whatsapp_chats', 'web_chat'), { scoped: true }),
  p('chats.assign', 'edit', any('whatsapp_chats', 'web_chat')),
  p('chats.takeover', 'edit', any('whatsapp_chats', 'web_chat')),
  p('chats.export', 'export', any('whatsapp_chats', 'web_chat'), { risk: 'high' }),
  // leads and contacts
  p('leads.view', 'read', 'crm', { scoped: true }),
  p('leads.edit', 'edit', 'crm', { scoped: true }),
  p('leads.stage', 'edit', 'crm', { scoped: true }),
  p('contacts.view', 'read', any('crm', 'whatsapp_chats'), { scoped: true }),
  p('contacts.import', 'create', any('crm', 'whatsapp_chats'), { limit: 'contacts' }),
  p('contacts.export', 'export', any('crm', 'whatsapp_chats'), { risk: 'high' }),
  p('contacts.delete', 'delete', any('crm', 'whatsapp_chats'), { risk: 'high' }),
  p('contactsync.manage', 'settings', 'contact_sync'),
  // broadcasts and templates
  p('broadcasts.view', 'read', 'whatsapp_broadcasts'),
  p('broadcasts.send', 'send', 'whatsapp_broadcasts', { meter: 'WHATSAPP', risk: 'high' }),
  p('templates.manage', 'edit', 'whatsapp_templates'),
  // bot and AI
  p('bot.view', 'read', any('whatsapp_bot', 'web_chat')),
  p('bot.configure', 'settings', any('whatsapp_bot', 'web_chat')),
  p('bot.ai.configure', 'settings', any('whatsapp_bot_ai', 'web_chat_ai')),
  p('kb.manage', 'edit', 'ai_knowledge_base'),
  p('webchat.configure', 'settings', 'web_chat'),
  p('agents.manage', 'settings', 'ai_agents', { limit: 'ai_agents' }),
  // voice assistant (PoC: no role grants yet, so only Radixile staff pass)
  p('voice.assistants.manage', 'settings', 'voice_assistant', { editions: ['server'], limit: 'voice_assistants' }),
  p('voice.calls.view', 'read', 'voice_assistant', { editions: ['server'] }),
  p('voice.calls.start', 'send', 'voice_outbound', { editions: ['server'], meter: 'VOICE_MINUTE', risk: 'high' }),
  p('voice.recordings.listen', 'read', 'voice_assistant', { editions: ['server'], risk: 'high' }),
  p('voice.numbers.view', 'read', 'voice_assistant', { editions: ['server'], risk: 'high' }),
  // outreach
  p('outreach.view', 'read', 'email_outreach', { scoped: true }),
  p('outreach.manage', 'edit', 'email_outreach'),
  p('outreach.send', 'send', any('email_outreach', 'sms_channel'), { meter: 'EMAIL', risk: 'high' }),
  p('email.campaigns.manage', 'edit', 'email_campaigns'),
  // channel accounts
  p('mailboxes.manage', 'settings', 'email_mailboxes', { limit: 'mailboxes', risk: 'high' }),
  p('mailboxes.own', 'settings', 'email_mailboxes'),
  p('sms.manage', 'settings', 'sms_channel', { limit: 'sms_numbers', risk: 'high' }),
  // SEO and web
  p('seo.view', 'read', 'seo_tools'),
  p('seo.manage', 'edit', 'seo_tools', { limit: 'seo_sites' }),
  p('seo.autopilot.manage', 'automate', 'seo_autopilot'),
  p('links.manage', 'edit', 'link_tracker'),
  p('feeds.manage', 'automate', 'rss_feeds'),
  p('bio.manage', 'edit', 'link_in_bio'),
  p('appstore.manage', 'edit', 'app_store'),
  p('tools.use', 'read', 'ai_tools'),
  // ads
  p('ads.create', 'create', 'ad_copy'),
  p('ads.reports.view', 'read', 'meta_reports'),
  p('leadads.manage', 'settings', 'meta_lead_ads'),
  // workspace
  p('members.view', 'read', 'core'),
  p('members.manage', 'admin', 'core', { risk: 'high' }),
  p('settings.manage', 'settings', 'core'),
  p('integrations.manage', 'settings', 'core', { risk: 'high' }),
  // org
  ...[
    ['org.view', 'read', 'core'], ['org.settings.manage', 'settings', 'core'],
    ['org.workspace.create', 'create', 'core', { limit: 'workspaces' }], ['org.workspace.delete', 'delete', 'core', { risk: 'high' }],
    ['org.members.invite', 'admin', 'core', { limit: 'users' }], ['org.members.manage', 'admin', 'core', { risk: 'high' }],
    ['org.roles.manage', 'admin', 'custom_roles', { risk: 'high' }], ['org.teams.manage', 'admin', 'teams_routing'],
    ['org.usage.view', 'read', 'core'], ['org.audit.view', 'read', 'audit_log'], ['org.data.export', 'export', 'core', { risk: 'high' }],
    ['org.support_access.manage', 'settings', 'core', { risk: 'high' }], ['org.ownership.transfer', 'admin', 'core', { risk: 'high' }],
  ].map(([key, cat, feat, extra]) => p(key, cat, feat, { scope: 'org', module: 'org', ...extra })),
  // billing
  ...['billing.view', 'billing.pay', 'billing.plan.change', 'billing.wallet.view']
    .map((key) => p(key, 'billing', 'core', { scope: 'billing', module: 'billing', editions: ['server'], risk: key === 'billing.view' || key === 'billing.wallet.view' ? 'low' : 'high' })),
  // account (self)
  ...['account.profile.manage', 'account.keys.manage', 'account.delete']
    .map((key) => p(key, 'account', null, { scope: 'account', module: 'account', risk: key === 'account.delete' ? 'high' : 'low' })),
  // platform (staff; docs/platform/ACCESS-AND-ENTITLEMENTS.md 6.2)
  ...['platform.orgs.view', 'platform.orgs.suspend', 'platform.orgs.delete', 'platform.users.view', 'platform.users.suspend',
    'platform.staff.manage', 'platform.plans.manage', 'platform.features.manage', 'platform.flags.manage', 'platform.menu.manage',
    'platform.support.read', 'platform.support.write', 'platform.audit.view', 'platform.ai.keys.manage', 'platform.usage.view',
    'platform.billing.manage']
    .map((key) => p(key, key.endsWith('.view') || key.endsWith('.read') ? 'read' : 'admin', null,
      { scope: 'platform', module: 'platform', editions: ['server'], risk: 'high' })),
];

// Today's workspace roles and what each may do (was services/rbac.js MATRIX). Role keys are the values stored in
// memberships.role. ACCESS-REQUIREMENTS 5.2 renames reviewer to Approver in R1; the stored key stays.
const WORKSPACE_ROLES = {
  manager: ['social.manage', 'members.manage', 'content.create', 'content.edit', 'content.submit',
    'content.approve', 'content.comment', 'content.publish', 'content.schedule', 'content.view', 'analytics.view'],
  creator: ['content.create', 'content.edit', 'content.submit', 'content.view', 'analytics.view'],
  reviewer: ['content.approve', 'content.comment', 'content.view', 'analytics.view'],
  client: ['content.approve', 'content.comment', 'content.view', 'analytics.view'],
  analyst: ['content.view', 'analytics.view'],
};

// Today's org roles (org_members.role). They grant nothing through the engine yet: routes/workspaces.js checks them
// inline. R1 adds billing and member and moves those checks here.
const ORG_ROLES = ['owner', 'admin'];

const BY_KEY = Object.freeze(Object.fromEntries(PERMISSIONS.map((x) => [x.key, Object.freeze(x)])));
const GRANTS = Object.freeze(Object.fromEntries(Object.entries(WORKSPACE_ROLES).map(([r, keys]) => [r, Object.freeze(new Set(keys))])));

// Does this workspace role grant this permission? (Role only: no staff bypass, plan or status.)
function roleGrants(role, key) {
  const set = Object.prototype.hasOwnProperty.call(GRANTS, role) ? GRANTS[role] : null;
  return !!set && set.has(key);
}

module.exports = {
  PERMISSIONS: Object.freeze(PERMISSIONS.map((x) => BY_KEY[x.key])),
  BY_KEY,
  WORKSPACE_ROLES: Object.freeze(Object.fromEntries(Object.entries(WORKSPACE_ROLES).map(([r, k]) => [r, Object.freeze([...k])]))),
  WORKSPACE_ROLE_KEYS: Object.freeze(Object.keys(WORKSPACE_ROLES)),
  ORG_ROLES: Object.freeze(ORG_ROLES),
  get: (key) => BY_KEY[key] || null,
  roleGrants,
};
