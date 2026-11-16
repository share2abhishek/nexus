// The secret that signs login cookies.
//   - Hosted (server edition): SESSION_SECRET must be set, long, and not a well-known
//     placeholder; otherwise the server refuses to start.
//   - Desktop / development (also the packaged app, which runs with NODE_ENV=production):
//     a missing or placeholder value is replaced by a random secret made once and kept
//     next to the data (so logins survive a restart, and nothing guessable ever signs a cookie).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Includes the value that used to ship in .env.example: it is public, so it protects nothing
const PLACEHOLDERS = new Set(['nexus-dev-secret', 'nexus-super-secret-change-this-in-production', 'changeme', 'change-me', 'secret', 'your-secret-here', 'replace-me']);

function weak(s) {
  const v = String(s || '').trim().toLowerCase();
  return v.length < 24 || PLACEHOLDERS.has(v) || /^(your|change|replace|example|nexus-super-secret|nexus-dev)/.test(v);
}

function resolve({ dataDir, env = process.env, exit = (m) => { console.error(m); process.exit(1); } } = {}) {
  const hosted = require('../services/edition').isServer();
  const given = env.SESSION_SECRET;
  if (given && !weak(given)) return given;
  if (hosted) {
    exit('[Startup] SESSION_SECRET must be set to a long random value (at least 24 characters, not a placeholder). '
      + 'Make one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    return null;
  }
  if (given) console.warn('[Startup] SESSION_SECRET is a placeholder or too short; using a generated one instead.');
  const file = path.join(dataDir, '.session-secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  } catch (err) { console.warn('[Startup] Could not save the session secret (logins will end on restart):', err.message); }
  return secret;
}

module.exports = { resolve, weak };
