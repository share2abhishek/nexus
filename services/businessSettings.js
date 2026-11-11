// Server edition: settings shared by everyone in a business (AI keys, email
// sending). On the desktop app these live in .env for the whole install; on the
// server each business keeps its own, so one customer never uses another's keys
// or mail server, and nobody falls back to Radixile's own keys in .env.
//
// Secrets are stored encrypted (business_settings.secret_value, see services/secrets).
const knex = require('./knex');
const { seal } = require('./secrets');

// key -> name on the request object (same names injectUserKeys uses)
const AI_KEYS = {
  google_ai_key: 'googleKey', anthropic_key: 'anthropicKey', groq_key: 'groqKey',
  openrouter_key: 'openrouterKey', mistral_key: 'mistralKey', stability_key: 'stabilityKey',
  openai_key: 'openaiKey', luma_key: 'lumaKey', runway_key: 'runwayKey',
};
const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_from_name'];
const SECRET = new Set([...Object.keys(AI_KEYS), 'smtp_pass']);
const ALLOWED = new Set([...Object.keys(AI_KEYS), 'default_text_model', ...SMTP_KEYS]);

const now = () => Math.floor(Date.now() / 1000);
const isMasked = (v) => typeof v === 'string' && v.includes('••••');

// ── Lookups (cached briefly; cleared on save) ───────────────────────────────
const cache = new Map(); // org id -> { at, value }
const TTL = 30000;

async function getAll(orgId) {
  if (!orgId) return {};
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const rows = await knex('business_settings').where({ org_id: orgId });
  const value = {};
  for (const r of rows) {
    const v = SECRET.has(r.key) ? r.secret_value : r.value;
    if (v != null && v !== '') value[r.key] = v;
  }
  cache.set(orgId, { at: Date.now(), value });
  return value;
}

async function orgForWorkspace(workspaceId) {
  if (!workspaceId) return null;
  const ws = await knex('workspaces').where({ id: workspaceId }).first('org_id');
  return ws?.org_id ?? null;
}

async function forWorkspace(workspaceId) {
  return getAll(await orgForWorkspace(workspaceId));
}

// values: { key: value }. Empty or masked ("••••") values keep what is saved, the
// way the Settings forms already work; clear: [keys] removes saved values.
async function save(orgId, values = {}, { userId = null, clear = [] } = {}) {
  const t = now();
  for (const [key, raw] of Object.entries(values)) {
    if (!ALLOWED.has(key) || raw == null || isMasked(raw)) continue;
    const v = String(raw).trim();
    if (!v) continue;
    if (/[\r\n]/.test(v)) throw Object.assign(new Error('A value contains a line break. Check what you pasted and try again.'), { status: 400 });
    const row = { org_id: orgId, key, value: SECRET.has(key) ? null : v, secret_value: SECRET.has(key) ? seal(v) : null, updated_by: userId, updated_at: t };
    await knex('business_settings').insert(row).onConflict(['org_id', 'key']).merge(['value', 'secret_value', 'updated_by', 'updated_at']);
  }
  const toClear = (clear || []).filter((k) => ALLOWED.has(k));
  if (toClear.length) await knex('business_settings').where({ org_id: orgId }).whereIn('key', toClear).del();
  cache.delete(orgId);
}

// ── What callers use ────────────────────────────────────────────────────────
// Mail server for a business, in the same shape as the .env one, or null
function smtpFrom(s) {
  if (!s.smtp_host || !s.smtp_user || !s.smtp_pass) return null;
  const port = parseInt(s.smtp_port || '587', 10) || 587;
  return {
    host: s.smtp_host,
    port,
    secure: s.smtp_secure != null ? s.smtp_secure === 'true' : port === 465,
    auth: { user: s.smtp_user, pass: s.smtp_pass },
    from: s.smtp_from || s.smtp_user,
    fromName: s.smtp_from_name || '',
  };
}

async function smtpForWorkspace(workspaceId) {
  return smtpFrom(await forWorkspace(workspaceId));
}

// { googleKey, anthropicKey, …, defaultTextModel } for a business
function aiKeysFrom(s) {
  const out = {};
  for (const [key, name] of Object.entries(AI_KEYS)) if (s[key]) out[name] = s[key];
  if (s.default_text_model) out.defaultTextModel = s.default_text_model;
  return out;
}

async function aiKeysForWorkspace(workspaceId) {
  return aiKeysFrom(await forWorkspace(workspaceId));
}

// AI options for work that runs without a person's request (background jobs) or
// to fill gaps in one: keys given win; then the business's keys on the server,
// or the install's .env keys on the desktop app. Never .env keys on the server.
const ENV_AI = {
  googleKey: 'GOOGLE_AI_KEY', anthropicKey: 'ANTHROPIC_API_KEY', groqKey: 'GROQ_API_KEY',
  openrouterKey: 'OPENROUTER_API_KEY', mistralKey: 'MISTRAL_API_KEY',
};
async function aiOptionsFor(workspaceId, given = {}) {
  const edition = require('./edition');
  const out = { ...(given || {}) };
  const fill = (k, v) => { if (!out[k] && v) out[k] = v; };
  if (edition.isServer()) {
    const b = await aiKeysForWorkspace(workspaceId);
    for (const [k, v] of Object.entries(b)) fill(k, v);
  } else {
    for (const [k, env] of Object.entries(ENV_AI)) fill(k, process.env[env]);
  }
  if (out.ollamaEnabled === undefined) out.ollamaEnabled = edition.ollamaDefault();
  fill('ollamaModel', process.env.OLLAMA_MODEL);
  fill('ollamaBaseUrl', process.env.OLLAMA_BASE_URL);
  return out;
}

// For the Settings screen: what is saved, never the secrets themselves
function publicView(s) {
  const out = { ai: {}, smtp: {} };
  for (const key of Object.keys(AI_KEYS)) out.ai[key] = !!s[key];
  out.ai.default_text_model = s.default_text_model || '';
  out.smtp = {
    SMTP_HOST: s.smtp_host || '', SMTP_PORT: s.smtp_port || '587', SMTP_USER: s.smtp_user || '',
    SMTP_FROM: s.smtp_from || '', SMTP_FROM_NAME: s.smtp_from_name || '',
    pass_set: !!s.smtp_pass, configured: !!smtpFrom(s),
  };
  return out;
}

// May this person change the business's shared settings? The owner of the
// business, a manager of one of its workspaces, or a Radixile platform admin.
async function canManage(userId, orgId) {
  if (!userId || !orgId) return false;
  const user = await knex('users').where({ id: userId }).first('role');
  if (user?.role === 'admin') return true;
  const owner = await knex('org_members').where({ org_id: orgId, user_id: userId }).whereIn('role', ['owner', 'admin']).first();
  if (owner) return true;
  const mgr = await knex('memberships as m').join('workspaces as w', 'w.id', 'm.workspace_id')
    .where({ 'm.user_id': userId, 'w.org_id': orgId, 'm.role': 'manager' }).first('m.id');
  return !!mgr;
}

function forget(orgId) { if (orgId == null) cache.clear(); else cache.delete(orgId); }

module.exports = {
  getAll, forWorkspace, orgForWorkspace, save, smtpFrom, smtpForWorkspace, aiKeysFrom, aiKeysForWorkspace, aiOptionsFor,
  publicView, canManage, forget, AI_KEYS, SMTP_KEYS,
};
