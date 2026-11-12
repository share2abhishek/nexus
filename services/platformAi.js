// Platform-default AI keys (server edition). Radixile's own keys, set by a Super
// Admin in the Admin dashboard. A customer business that hasn't added its own key
// and whose owner hasn't shared a team key falls back to these, so AI works on a
// trial from minute one — on Radixile's own key and rate limit, never a customer's.
//
// Stored encrypted in platform_config (sealed with services/secrets). platform_config
// is not auto-decrypted by knex, so this module seals on write and opens on read.
const knex = require('./knex');
const { seal, open } = require('./secrets');

// platform_config key -> name on the request object (same names injectUserKeys uses)
const AI_KEYS = {
  platform_google_ai_key: 'googleKey',
  platform_groq_key:      'groqKey',
  platform_openrouter_key: 'openrouterKey',
  platform_mistral_key:   'mistralKey',
  platform_anthropic_key: 'anthropicKey',
};

const isMasked = (v) => typeof v === 'string' && v.includes('••••');

// Brief cache, cleared on save
let cache = null;
let cacheAt = 0;
const TTL = 30000;

async function getRaw() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  const out = {};
  try {
    const rows = await knex('platform_config').whereIn('key', Object.keys(AI_KEYS));
    for (const r of rows) {
      const v = open(r.value);
      if (v != null && v !== '') out[r.key] = v;
    }
  } catch { /* table missing on a fresh/desktop install */ }
  cache = out; cacheAt = Date.now();
  return out;
}

// { googleKey, groqKey, … } — the keys that are set, ready to merge into req
async function keys() {
  const raw = await getRaw();
  const out = {};
  for (const [k, name] of Object.entries(AI_KEYS)) if (raw[k]) out[name] = raw[k];
  return out;
}

// Fill any missing AI keys on an options/req-shaped object from the platform defaults
async function fill(target = {}) {
  const k = await keys();
  for (const [name, v] of Object.entries(k)) if (!target[name] && v) target[name] = v;
  return target;
}

// values: { platform_google_ai_key: '...', … }. Empty / masked values are left as-is;
// clear: [keys] removes a saved key.
async function save(values = {}, { clear = [] } = {}) {
  for (const [key, raw] of Object.entries(values)) {
    if (!AI_KEYS[key] || raw == null || isMasked(raw)) continue;
    const v = String(raw).trim();
    if (!v) continue;
    if (/[\r\n]/.test(v)) throw Object.assign(new Error('A key contains a line break. Check what you pasted and try again.'), { status: 400 });
    const sealed = seal(v);
    const existing = await knex('platform_config').where({ key }).first();
    if (existing) await knex('platform_config').where({ key }).update({ value: sealed });
    else await knex('platform_config').insert({ key, value: sealed });
  }
  const toClear = (clear || []).filter((k) => AI_KEYS[k]);
  if (toClear.length) await knex('platform_config').whereIn('key', toClear).del();
  cache = null;
}

// For the Admin screen: which keys are set, never the secrets themselves
async function publicView() {
  const raw = await getRaw();
  const out = {};
  for (const k of Object.keys(AI_KEYS)) out[k] = !!raw[k];
  return out;
}

function forget() { cache = null; }

module.exports = { keys, fill, save, publicView, forget, AI_KEYS };
