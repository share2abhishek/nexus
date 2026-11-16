// Client approval links on the hosted edition: this app is the relay.
//
// On a desktop the app can't be reached from the internet, so Radixile's relay holds the
// shared post. A hosted install IS on the internet, so it keeps the post itself, with the
// same rules the relay had:
//   - the post arrives already encrypted; the key is only in the link after "#";
//   - links expire (default 14 days, at most 30);
//   - one answer per link, which the app picks up and applies to the post.
// No licence server is involved: who may share is decided by the app's own workspace roles
// and plan before this is reached.
const crypto = require('crypto');

const DAY = 86400;
const MAX_CIPHERTEXT = 11 * 1024 * 1024;
const MAX_STORED_BYTES = 300 * 1024 * 1024; // open links of one workspace, all together
const MAX_PER_DAY = 300;                    // links one workspace can make per day

const now = () => Math.floor(Date.now() / 1000);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = (n) => crypto.randomBytes(n).toString('base64url');
const BASE64URL = /^[A-Za-z0-9+/=_-]+$/;

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

// Store an encrypted post. Returns what the app needs to build and later manage the link.
async function create(db, { workspaceId, ciphertext, days, publicBase }) {
  if (typeof ciphertext !== 'string' || !BASE64URL.test(ciphertext) || ciphertext.length > MAX_CIPHERTEXT) {
    throw fail(400, 'Nothing to share (or too large: keep pictures under 8 MB in total).');
  }
  const t = now();
  const todayStart = t - (t % DAY);
  const [{ c }] = await db('relay_approvals').where({ workspace_id: workspaceId }).where('created_at', '>=', todayStart).count('id as c');
  if (Number(c) >= MAX_PER_DAY) throw fail(429, 'Too many approval links today. Try again tomorrow.', 'RATE_LIMITED');
  const used = await db('relay_approvals').where({ workspace_id: workspaceId }).where('expires_at', '>', t)
    .sum({ bytes: db.raw('length(ciphertext)') }).first();
  if (Number(used?.bytes || 0) + ciphertext.length > MAX_STORED_BYTES) {
    throw fail(413, 'Too many open approval links with pictures. Withdraw old links, or wait for them to expire.', 'STORAGE_FULL');
  }
  const id = token(15);
  const owner = token(24);
  const life = Math.min(Math.max(Number(days) || 14, 1), 30) * DAY;
  await db('relay_approvals').insert({ id, workspace_id: workspaceId, owner_hash: sha(owner), ciphertext, created_at: t, expires_at: t + life });
  return { id, owner, url: `${String(publicBase).replace(/\/$/, '')}/a/${id}`, expires_at: t + life };
}

// What the client's page reads (still encrypted); null when expired or withdrawn
async function read(db, id) {
  const a = await db('relay_approvals').where({ id: String(id) }).where('expires_at', '>', now()).first();
  return a ? { ciphertext: a.ciphertext, responded: !!a.response, expires_at: Number(a.expires_at) } : null;
}

// The client's (encrypted) answer. One per link. False when already answered or expired.
async function respond(db, id, response) {
  if (typeof response !== 'string' || !BASE64URL.test(response) || response.length > 40000) throw fail(400, 'Answer not readable.');
  const n = await db('relay_approvals').where({ id: String(id) }).whereNull('response').where('expires_at', '>', now())
    .update({ response, responded_at: now() });
  return n > 0;
}

// Answers for many links at once: items = [{ id, owner }]
// → { <id>: { response, responded_at } | { gone: true } } (only answered or gone ones)
async function collect(db, items) {
  const list = (Array.isArray(items) ? items : []).slice(0, 100);
  const rows = list.length ? await db('relay_approvals').whereIn('id', list.map((i) => String(i.id))) : [];
  const answers = {};
  const t = now();
  for (const it of list) {
    const a = rows.find((r) => r.id === String(it.id));
    if (!a || a.owner_hash !== sha(it.owner || '') || Number(a.expires_at) <= t) { answers[it.id] = { gone: true }; continue; }
    if (a.response) answers[it.id] = { response: a.response, responded_at: Number(a.responded_at) };
  }
  return answers;
}

// The person who made the link withdraws it
async function remove(db, id, owner) {
  const a = await db('relay_approvals').where({ id: String(id) }).first();
  if (!a || a.owner_hash !== sha(owner || '')) return false;
  await db('relay_approvals').where({ id: a.id }).del();
  return true;
}

// Expired links are removed every hour
function startPurge(db) {
  const purge = () => db('relay_approvals').where('expires_at', '<=', now()).del().catch(() => {});
  const timer = setInterval(purge, 3600 * 1000);
  timer.unref?.();
  return purge;
}

module.exports = { create, read, respond, collect, remove, startPurge };
