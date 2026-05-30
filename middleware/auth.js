const db = require('../services/database');

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

// Inject user AI keys into process for this request
function injectUserKeys(req, res, next) {
  if (req.session?.userId) {
    const settings = db.getUserSettings(req.session.userId);
    if (settings.google_ai_key) req.googleKey = settings.google_ai_key;
    if (settings.anthropic_key) req.anthropicKey = settings.anthropic_key;
    if (settings.ollama_enabled) req.ollamaEnabled = !!settings.ollama_enabled;
    if (settings.ollama_model)  req.ollamaModel  = settings.ollama_model;
  }
  next();
}

module.exports = { requireAuth, optionalAuth, injectUserKeys };
