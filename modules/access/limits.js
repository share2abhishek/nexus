// Limit catalogue (data only). Spec: docs/platform/ACCESS-AND-ENTITLEMENTS.md 10 and 7.3.
// type: 'count' (how many exist now), 'rate' (used this period), 'size' (bytes).
// enforcedBy: where the limit is checked TODAY. 'entitlements' = services/entitlements.js limitProblem (A0 adapter).
// null = declared for the plan designer and usage screens, not enforced yet (L1, L2, P1 add the checks).
// A0 changes no limit: plans still come from services/entitlements.js DEFAULT_PLANS (and the saas_plans config).

const l = (key, name, type, unit, extra = {}) => ({
  key, name, type, unit, period: type === 'rate' ? 'month' : null, scope: 'org', enforcedBy: null,
  thresholds: [80, 100], ...extra,
});

const LIMITS = [
  l('workspaces', 'Brand and client workspaces', 'count', 'workspaces', { enforcedBy: 'entitlements' }),
  l('users', 'Team members', 'count', 'people', { enforcedBy: 'entitlements' }),
  l('seo_sites', 'Websites in the SEO autopilot', 'count', 'sites', { enforcedBy: 'entitlements' }),
  l('social_accounts', 'Social accounts per workspace', 'count', 'accounts', { scope: 'workspace' }),
  l('scheduled_posts', 'Scheduled posts', 'rate', 'posts'),
  l('storage', 'Storage', 'size', 'bytes'),
  l('file_size_image', 'Largest image', 'size', 'bytes'),
  l('file_size_video', 'Largest video', 'size', 'bytes'),
  l('ai_credits', 'AI credits', 'rate', 'credits'),
  l('contacts', 'Contacts', 'count', 'contacts'),
  l('whatsapp_messages', 'WhatsApp and broadcast messages', 'rate', 'messages'),
  l('custom_roles', 'Custom roles', 'count', 'roles'),
  l('ai_agents', 'AI sales agents', 'count', 'agents'),
  l('mailboxes', 'Connected mailboxes', 'count', 'mailboxes'),
  l('sms_numbers', 'SMS numbers', 'count', 'numbers'),
];

const BY_KEY = Object.freeze(Object.fromEntries(LIMITS.map((x) => [x.key, Object.freeze(x)])));

module.exports = { LIMITS: Object.freeze(LIMITS.map((x) => BY_KEY[x.key])), BY_KEY, get: (key) => BY_KEY[key] || null };
