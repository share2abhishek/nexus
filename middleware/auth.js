const knexInstance = require('../services/knex');
const settingsRepo = require('../repos/settingsRepo')(knexInstance);

// Logged in, and still allowed to be: the account is looked up (cached for a few
// seconds) so a suspended or deleted user is cut off at once, not when the 7-day
// login cookie runs out.
function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated', redirect: '/login' });
  }
  req.userId = req.session.userId;
  require('../services/platformAdmin').loadUser(req.userId).then((user) => {
    if (!user) { req.session.destroy?.(() => {}); return res.status(401).json({ error: 'Not authenticated', redirect: '/login' }); }
    if (user.status === 'suspended') { req.session.destroy?.(() => {}); return res.status(403).json({ error: 'Your account has been suspended. Contact the admin.' }); }
    req.currentUser = user;
    next();
  }).catch(next);
}

// Inject user AI keys into request for this handler chain
const platformAdmin = require('../services/platformAdmin');

async function injectUserKeys(req, res, next) {
  try {
    if (req.session?.userId) {
      const edition = require('../services/edition');
      const hosted = edition.isServer();
      const s = await settingsRepo.get(req.session.userId);
      if (s?.google_ai_key)     req.googleKey     = s.google_ai_key;
      if (s?.anthropic_key)     req.anthropicKey  = s.anthropic_key;
      if (s?.groq_key)          req.groqKey       = s.groq_key;
      if (s?.openrouter_key)    req.openrouterKey = s.openrouter_key;
      if (s?.mistral_key)       req.mistralKey    = s.mistral_key;
      // Local AI (Ollama) lives on a person's own PC. On the hosted edition a customer
      // must not point the server at an address of their choosing (SSRF), so these are
      // ignored there.
      if (!hosted) {
        if (s?.ollama_enabled)  req.ollamaEnabled = !!s.ollama_enabled;
        if (s?.ollama_model)    req.ollamaModel   = s.ollama_model;
        if (s?.ollama_url)      req.ollamaUrl     = s.ollama_url;
      }
      if (s?.stability_key)     req.stabilityKey  = s.stability_key;
      if (s?.openai_key)        req.openaiKey     = s.openai_key;
      if (s?.luma_key)          req.lumaKey       = s.luma_key;
      if (s?.runway_key)        req.runwayKey     = s.runway_key;
      if (s?.default_text_model) req.defaultTextModel = s.default_text_model;

      const user = await platformAdmin.loadUser(req.session.userId);
      // Radixile's own AI keys are only for accounts that proved their email address:
      // sign-up logs people in unverified, so otherwise anyone could spend them.
      const mayUsePlatformAi = hosted && !!user?.email_verified_at;
      const platformAi = require('../services/platformAi');

      // Server edition: then the keys the business shares with its team
      // (Settings → AI), so nobody needs their own.
      if (hosted && req.workspaceId) {
        const shared = await require('../services/businessSettings').aiKeysForWorkspace(req.workspaceId);
        // "Use Radixile AI" was chosen: Radixile's keys win over any saved ones
        if (shared.aiSource === 'platform' && mayUsePlatformAi) {
          const platform = await platformAi.keys();
          for (const [k, v] of Object.entries(platform)) req[k] = v;
          if (Object.keys(platform).length) req.platformAiUsed = true;
        }
        for (const [k, v] of Object.entries(shared)) if (k !== 'aiSource' && !req[k]) req[k] = v;
        req.aiSource = shared.aiSource;
      }

      // Server edition: finally Radixile's platform-default keys (a Super Admin sets
      // these in Admin → Platform AI). They fill any gap so a business can use AI on a
      // trial before adding its own key, on Radixile's key and within a daily limit.
      // A business that chose "my own keys only" never falls back to them.
      if (mayUsePlatformAi && req.aiSource !== 'own') {
        await platformAi.fill(req);
      }
      // Every AI call on Radixile's keys is counted (see services/aiQuota.js)
      if (req.platformAiUsed) {
        const quota = require('../services/aiQuota');
        const workspaceId = req.workspaceId;
        req.aiGuard = () => quota.consumePlatform(workspaceId);
      }

      // Shared keys in .env belong to whoever set up this install (the admin).
      // Only admins fall back to them; other users bring their own keys. On the
      // server that's only Radixile's platform admins, never a customer.
      if (user?.role === 'admin') {
        const env = process.env;
        req.googleKey     = req.googleKey     || env.GOOGLE_AI_KEY;
        req.anthropicKey  = req.anthropicKey  || env.ANTHROPIC_API_KEY;
        req.groqKey       = req.groqKey       || env.GROQ_API_KEY;
        req.openrouterKey = req.openrouterKey || env.OPENROUTER_API_KEY;
        req.mistralKey    = req.mistralKey    || env.MISTRAL_API_KEY;
        req.stabilityKey  = req.stabilityKey  || env.STABILITY_API_KEY;
        req.openaiKey     = req.openaiKey     || env.OPENAI_API_KEY;
        req.lumaKey       = req.lumaKey       || env.LUMA_API_KEY;
        req.runwayKey     = req.runwayKey     || env.RUNWAY_API_KEY;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, injectUserKeys };
