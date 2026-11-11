// One-click connect through Radixile's approved apps (see license-server
// src/connect.js). The app makes a random key, the person signs in in their
// browser, Radixile's helper encrypts the login with that key, and the app
// collects and decrypts it here. Accounts made this way are marked via='radixile'
// and their logins are renewed through the helper.
const crypto = require('crypto');
const axios = require('axios');
const { COMPLETE } = require('./platforms/connectAccounts');

const sessions = new Map(); // session_id -> { wsId, platform, key, created }
let cache = { at: 0, platforms: [] };

const base = () => require('./license').serverUrl();
function proof() {
  const p = require('./license').licenseProof();
  if (!p) throw Object.assign(new Error('One-click connect needs an active licence (Settings → Licence). You can still connect with your own app.'), { status: 402 });
  return { 'X-SN-License': p };
}

// Platforms Radixile currently offers (cached for 10 minutes; [] when offline)
async function platforms() {
  if (Date.now() - cache.at < 10 * 60 * 1000) return cache.platforms;
  try {
    const r = await axios.get(`${base()}/v1/connect/platforms`, { timeout: 8000 });
    cache = { at: Date.now(), platforms: Array.isArray(r.data?.platforms) ? r.data.platforms : [] };
  } catch { cache = { at: Date.now() - 9 * 60 * 1000, platforms: [] }; } // try again in a minute
  return cache.platforms;
}

async function start({ wsId, platform }) {
  const key = crypto.randomBytes(32);
  const r = await axios.post(`${base()}/v1/connect/start`, { platform, key_hex: key.toString('hex') }, { headers: proof(), timeout: 15000 })
    .catch((err) => { throw Object.assign(new Error(err.response?.data?.error || 'Couldn’t reach Radixile’s connect service. Check the internet, or connect with your own app.'), { status: err.response?.status === 402 ? 402 : 502 }); });
  sessions.set(r.data.session_id, { wsId, platform, key, created: Date.now() });
  for (const [id, s] of sessions) if (Date.now() - s.created > 15 * 60 * 1000) sessions.delete(id);
  return { session_id: r.data.session_id, auth_url: r.data.auth_url };
}

function decrypt(key, b64) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8'));
}

// Has the person finished signing in? When yes, save the account.
async function check(db, sessionId, wsId) {
  const s = sessions.get(sessionId);
  if (!s || s.wsId !== wsId) return { status: 'expired' };
  const r = await axios.get(`${base()}/v1/connect/result/${encodeURIComponent(sessionId)}`, { headers: proof(), timeout: 15000 });
  if (r.data.status === 'waiting') return { status: 'waiting' };
  sessions.delete(sessionId);
  if (r.data.status !== 'done') return { status: r.data.status, error: r.data.error || 'The sign-in has expired. Click Connect again.' };
  const got = decrypt(s.key, r.data.result);
  const done = await COMPLETE[s.platform](db, s.wsId, got.token, { instagram: !!got.instagram, via: 'radixile' });
  return { status: 'done', ...done };
}

// Renew a login made through Radixile's app (Google, LinkedIn, Pinterest)
async function refresh(platform, refreshToken) {
  const r = await axios.post(`${base()}/v1/connect/refresh`, { platform, refresh_token: refreshToken }, { headers: proof(), timeout: 20000 });
  return r.data;
}

async function facebookDebug(inputToken) {
  const r = await axios.post(`${base()}/v1/connect/facebook/debug`, { input_token: inputToken }, { headers: proof(), timeout: 15000 });
  return r.data;
}

module.exports = { platforms, start, check, refresh, facebookDebug, _sessions: sessions, _reset: () => { cache = { at: 0, platforms: [] }; sessions.clear(); } };
