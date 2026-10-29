const knexInstance = require('../services/knex');
const settingsRepo = require('../repos/settingsRepo')(knexInstance);

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated', redirect: '/login' });
  }
  req.userId = req.session.userId;
  next();
}

function optionalAuth(req, res, next) {
  req.userId = req.session?.userId || 1;
  next();
}

// Inject user AI keys into request for this handler chain
const knexForKeys = require('../services/knex');

async function injectUserKeys(req, res, next) {
  try {
    if (req.session?.userId) {
      const s = await settingsRepo.get(req.session.userId);
      if (s?.google_ai_key)     req.googleKey     = s.google_ai_key;
      if (s?.anthropic_key)     req.anthropicKey  = s.anthropic_key;
      if (s?.groq_key)          req.groqKey       = s.groq_key;
      if (s?.openrouter_key)    req.openrouterKey = s.openrouter_key;
      if (s?.mistral_key)       req.mistralKey    = s.mistral_key;
      if (s?.ollama_enabled)    req.ollamaEnabled = !!s.ollama_enabled;
      if (s?.ollama_model)      req.ollamaModel   = s.ollama_model;
      if (s?.ollama_url)        req.ollamaUrl     = s.ollama_url;
      if (s?.stability_key)     req.stabilityKey  = s.stability_key;
      if (s?.openai_key)        req.openaiKey     = s.openai_key;
      if (s?.luma_key)          req.lumaKey       = s.luma_key;
      if (s?.runway_key)        req.runwayKey     = s.runway_key;
      if (s?.default_text_model) req.defaultTextModel = s.default_text_model;

      // Shared keys in .env belong to whoever set up this install (the admin).
      // Only admins fall back to them; other users bring their own keys.
      const user = await knexForKeys('users').where({ id: req.session.userId }).first();
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

module.exports = { requireAuth, optionalAuth, injectUserKeys };
