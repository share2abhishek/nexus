// Saved logins (platform tokens) and personal API keys are stored encrypted in the
// database, so a copied nexus.db alone reveals nothing.
//
// The key: in the desktop app, Electron keeps it in datakey.bin protected by
// Windows (DPAPI, via safeStorage) and hands it to the server as NEXUS_DATA_KEY.
// Without Electron (development, server editions) a key file next to the data is
// used instead (protects copies of the database, not the whole folder).
//
// Encrypted values look like "enc:v1:<base64 iv|tag|ciphertext>" (AES-256-GCM).
// Reading is automatic (services/knex.js decrypts query results); writing goes
// through seal(), and sweep() encrypts anything still stored in plain text.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PREFIX = 'enc:v1:';
let key = null;

function dataDir() { return process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', 'data'); }

function loadKey() {
  if (key) return key;
  if (process.env.NEXUS_DATA_KEY) {
    const k = Buffer.from(process.env.NEXUS_DATA_KEY, 'base64');
    if (k.length === 32) return (key = k);
  }
  const file = path.join(dataDir(), '.data-key');
  try {
    const k = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (k.length === 32) return (key = k);
  } catch {}
  const k = crypto.randomBytes(32);
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(file, k.toString('base64'), { mode: 0o600 });
  } catch {}
  return (key = k);
}

const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX);

function seal(value) {
  if (value == null || value === '' || isSealed(value)) return value;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const body = Buffer.concat([c.update(String(value), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

function open(value) {
  if (!isSealed(value)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', loadKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    // Wrong key (e.g. the database was moved to another PC without its key)
    return null;
  }
}

// Decrypts sealed values in a query result. Only columns that hold secrets are
// looked at (by name), so ordinary text that happens to start with "enc:v1:" is
// never touched.
function openDeep(result) {
  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i++) result[i] = openDeep(result[i]);
    return result;
  }
  if (result && typeof result === 'object' && !Buffer.isBuffer(result) && !(result instanceof Date)) {
    for (const k of Object.keys(result)) {
      const v = result[k];
      if (typeof v === 'string' && SECRET_NAMES.has(k) && isSealed(v)) result[k] = open(v);
    }
  }
  return result;
}

// Columns that hold secrets
const SEALED_COLUMNS = {
  social_accounts: { key: 'id', cols: ['access_token', 'refresh_token', 'page_token'] },
  approval_links: { key: 'id', cols: ['owner_token', 'link_key', 'url'] },
  companion_pairs: { key: 'id', cols: ['owner_token', 'link_key', 'url'] },
  cloud_jobs: { key: 'id', cols: ['owner_token'] },
  business_settings: { key: 'id', cols: ['secret_value'] },
  user_settings: { key: 'user_id', cols: ['google_ai_key', 'anthropic_key', 'stability_key', 'openai_key', 'luma_key', 'runway_key', 'groq_key', 'openrouter_key', 'mistral_key'] },
};

// Encrypts anything still stored in plain text (older rows, or a write that
// didn't go through seal()). Runs at start-up and every few minutes.
async function sweep(db) {
  let changed = 0;
  for (const [table, { key: pk, cols }] of Object.entries(SEALED_COLUMNS)) {
    if (!(await db.schema.hasTable(table))) continue;
    for (const col of cols) {
      if (!(await db.schema.hasColumn(table, col))) continue;
      const rows = await db(table).select(pk, col).whereNotNull(col).whereNot(col, '').whereNot(col, 'like', `${PREFIX}%`);
      for (const r of rows) {
        await db(table).where(pk, r[pk]).where(col, r[col]).update({ [col]: seal(r[col]) });
        changed++;
      }
    }
  }
  return changed;
}

const SECRET_NAMES = new Set(Object.values(SEALED_COLUMNS).flatMap(t => t.cols));

let timer = null;
function start(db) {
  const run = () => sweep(db).catch(err => console.error('[Secrets] Could not encrypt saved logins:', err.message));
  run();
  timer = setInterval(run, 5 * 60 * 1000);
  timer.unref?.();
}

module.exports = { seal, open, openDeep, isSealed, sweep, start, SEALED_COLUMNS, PREFIX, _reset: () => { key = null; } };
