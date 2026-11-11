// Licence checks for routes. Messages are written for the person using the app.
const license = require('../services/license');

const ACTIVATE_HINT = 'Go to Settings → Licence to activate, or buy a licence at license.radixile.com.';

function messageFor(s) {
  if (s.state === 'unlicensed') return `Publishing needs an active licence. ${ACTIVATE_HINT}`;
  if (s.state === 'checking') return 'Social-Nexus is still checking your licence (a few seconds after start-up). Please try again.';
  if (s.state === 'offline') return s.message;
  return `${s.message} ${ACTIVATE_HINT}`;
}

// Blocks publishing / scheduling / sending when the licence doesn't allow it
async function requirePublishLicense(req, res, next) {
  // Server edition: the business's trial or plan (services/entitlements)
  if (require('../services/edition').isServer()) {
    if (await require('../services/entitlements').blockPublishing(req, res)) return;
    return next();
  }
  const s = license.status();
  if (s.can_publish) return next();
  return res.status(402).json({ error: messageFor(s), license_state: s.state, code: 'LICENSE_REQUIRED' });
}

// Numeric edition limits; -1 means unlimited
function withinLimit(name, current) {
  const limit = license.status().limits?.[name];
  if (limit === undefined || limit === -1) return true;
  return current < limit;
}

function limitMessage(name) {
  const s = license.status();
  const n = s.limits?.[name];
  const what = { workspaces: 'brand/client workspaces', users: 'user accounts', autopilot_rules: 'autopilot rules', seo_sites: 'SEO sites' }[name] || name;
  return s.licensed
    ? `Your ${s.edition_name || 'current'} licence allows ${n} ${what}. Upgrade at license.radixile.com to add more.`
    : `Without a licence you can use ${n} ${what}. ${ACTIVATE_HINT}`;
}

module.exports = { requirePublishLicense, withinLimit, limitMessage };
