// Signed requests between Nexus and the voice gateway (docs/platform/VOICE-AGENTS.md 5).
// Header X-Voice-Signature: t=<epoch seconds>,v1=<hex HMAC-SHA256 of "<t>.<sha256 hex of body>">.
// A 300 s window stops replays of old requests; the compare is constant-time.
const crypto = require('crypto');

const WINDOW_SEC = 300;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function sign(body, secret, t = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${sha(raw)}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function verify(rawBody, header, secret, now = Math.floor(Date.now() / 1000)) {
  if (!secret || !header || typeof header !== 'string') return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(now - t) > WINDOW_SEC || !/^[0-9a-f]{64}$/.test(parts.v1 || '')) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
  const want = crypto.createHmac('sha256', secret).update(`${t}.${sha(raw)}`).digest();
  const got = Buffer.from(parts.v1, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { sign, verify, WINDOW_SEC };
