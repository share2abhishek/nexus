// Licensing on the desktop: holds the signed licence file, verifies it offline,
// refreshes it with license.radixile.com and answers "what is this install
// allowed to do?".
//
// States
//   unlicensed  no licence yet               → limited mode, "Activate" banner
//   checking    start-up checks still running → limited mode for a few seconds
//   active      valid licence                → everything the edition allows
//   offline     lease ran out, needs internet → limited mode until it checks in
//   expired     subscription/coupon ended    → limited mode, "Renew/Buy"
//   invalid     revoked / other PC / tampered → limited mode, message says why
//
// Limited mode never locks anyone out of their data: viewing, drafting, AI
// writing and export keep working; publishing and automation stop.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getFingerprint, sameDevice, isComplete } = require('./fingerprint');

// ── release build constants ──────────────────────────────────────────────────
// scripts/release/protect.js replaces these two lines (licence public keys, build
// key, and the SHA-256 of the compiled integrity check), then compiles this file
// to bytecode. Nothing here is read from a file or env var a user could change.
const RELEASE_CONSTANTS = null;
const PINNED_HASHES = null;
const RELEASE = RELEASE_CONSTANTS !== null;

// Release: load the integrity check's bytecode by exact path (not through its
// editable text loader) and make sure it is the one built with this file.
const INTEGRITY_JSC = path.join(__dirname, '..', 'integrity.jsc');
const pinnedOk = (() => {
  if (!RELEASE) return true;
  try {
    return !!PINNED_HASHES && crypto.createHash('sha256').update(fs.readFileSync(INTEGRITY_JSC)).digest('hex') === PINNED_HASHES['integrity.jsc'];
  } catch { return false; }
})();
let integrityModule = null;
function integrity() {
  if (integrityModule) return integrityModule;
  if (RELEASE) {
    require('bytenode');
    integrityModule = require(INTEGRITY_JSC);
    integrityModule.configure({ release: true, buildKey: RELEASE_CONSTANTS.BUILD_PUBLIC_KEY });
  } else {
    integrityModule = require('../integrity');
  }
  return integrityModule;
}
// A broken or swapped integrity check counts as a modified installation
function integrityState() {
  if (!pinnedOk) return 'modified';
  try { return integrity().check().state; } catch { return 'modified'; }
}

const DAY = 86400;
const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);
const DEFAULT_SERVER = 'https://license.radixile.com';
// Development may point at a test server; release builds talk only to Radixile
const SERVER = () => (RELEASE ? DEFAULT_SERVER : (process.env.LICENSE_SERVER_URL || DEFAULT_SERVER)).replace(/\/$/, '');
const APP_VERSION = (() => { try { return require('../../package.json').version; } catch { return '0'; } })();

// What an install without a licence may do (drafting yes, publishing no)
const LIMITED = { seats: 1, workspaces: 1, users: 1, autopilot_rules: 0, seo_sites: 0, publish: false, team_mode: false };

function dataDir() {
  return process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}
function storeFile() {
  return path.join(dataDir(), 'license', 'license.json');
}

// ── public keys (the private key exists only on the licence server) ──────────
// Release: only the keys baked in at build time. Development: config/license-keys/
// <kid>.pem plus LICENSE_PUBLIC_KEY_PATH for a local test server.
let publicKeys = null;
function getPublicKeys() {
  if (publicKeys) return publicKeys;
  publicKeys = {};
  if (RELEASE) {
    if (pinnedOk) {
      for (const [kid, pem] of Object.entries(RELEASE_CONSTANTS.LICENSE_KEYS || {})) {
        try { publicKeys[kid] = crypto.createPublicKey(pem); } catch {}
      }
    }
    return publicKeys;
  }
  const load = (kid, file) => { try { publicKeys[kid] = crypto.createPublicKey(fs.readFileSync(file, 'utf8')); } catch {} };
  if (process.env.LICENSE_PUBLIC_KEY_PATH) load(process.env.LICENSE_KEY_ID || 'k1', process.env.LICENSE_PUBLIC_KEY_PATH);
  const dir = path.join(__dirname, '..', '..', 'config', 'license-keys');
  try {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.pem') && !publicKeys[f.slice(0, -4)]) load(f.slice(0, -4), path.join(dir, f));
  } catch {}
  return publicKeys;
}
const getPublicKey = () => Object.keys(getPublicKeys()).length > 0;

// Licence file v2: { v: 2, kid, payload: base64(JSON), sig }. The signature covers
// the exact payload bytes. Returns the decoded payload, or null if not genuine.
// doc: other signed files (e.g. festival updates, payload.doc = 'festivals') can
// never pass as a licence, and a licence never passes as one of them.
function verifySignature(file, doc = null) {
  if (!file || file.v !== 2 || typeof file.payload !== 'string' || typeof file.sig !== 'string') return null;
  const key = getPublicKeys()[file.kid];
  if (!key) return null;
  try {
    const bytes = Buffer.from(file.payload, 'base64');
    if (!crypto.verify(null, bytes, key, Buffer.from(file.sig, 'base64'))) return null;
    const payload = JSON.parse(bytes.toString('utf8'));
    return (payload?.doc || null) === doc ? payload : null;
  } catch {
    return null;
  }
}

// ── local store ──────────────────────────────────────────────────────────────
// { device_id, file, last_time, last_error, revoked } — the signed file can't be
// edited without breaking its signature; last_time guards against clock rollback.
function readStore() {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { return {}; }
}
function writeStore(data) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  const tmp = `${storeFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  // Windows: antivirus can hold the file for a moment, so retry briefly
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, storeFile()); return; } catch (err) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      const until = Date.now() + 50 * (i + 1); while (Date.now() < until) { /* short wait */ }
    }
  }
}
// For writes that are nice-to-have (timestamps): never fail the caller
function writeStoreQuietly(data) {
  try { writeStore(data); } catch (err) { console.warn('[Licence] could not save licence state:', err.message); }
}
function deviceId(store) {
  if (store.device_id) return store.device_id;
  store.device_id = crypto.randomUUID();
  writeStore(store);
  return store.device_id;
}

// Only one change to the licence at a time (activate / refresh / deactivate / import)
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ── fingerprint ──────────────────────────────────────────────────────────────

let fingerprint = null;     // filled at startup (takes a few seconds on Windows)
let fingerprintPromise = null;
function ensureFingerprint() {
  if (!fingerprintPromise) {
    fingerprintPromise = getFingerprint().then(fp => { fingerprint = fp; return fp; });
    // An incomplete read (PowerShell slow or blocked) is retried next time
    fingerprintPromise.then(fp => { if (!isComplete(fp)) fingerprintPromise = null; }, () => { fingerprintPromise = null; });
  }
  return fingerprintPromise;
}

// ── status ───────────────────────────────────────────────────────────────────

function status() {
  const store = readStore();
  const t = now();
  const base = { server: SERVER(), app_version: APP_VERSION, limits: LIMITED, licensed: false, can_publish: false };
  const modified = { ...base, state: 'invalid', integrity: 'modified', message: 'This copy of Social-Nexus has been modified, so it cannot be licensed. Please reinstall it from radixile.com — your data is safe.' };

  // A modified installation keeps working for viewing/export, but isn't licensed
  const integrityNow = integrityState();
  if (integrityNow === 'modified') return modified;
  if (RELEASE && integrityNow === 'checking') return { ...base, state: 'checking', message: 'Checking your licence…' };

  if (!getPublicKey()) {
    return { ...base, state: 'unlicensed', message: 'Licensing is not configured in this build. Publishing is disabled.' };
  }
  if (!store.file) {
    return { ...base, state: 'unlicensed', message: 'Activate Social-Nexus with a licence key or coupon code to start publishing.' };
  }
  const f = verifySignature(store.file);
  if (!f) {
    return { ...base, state: 'invalid', message: 'The licence file is damaged or was changed. Please activate again.' };
  }

  const info = {
    lic: f.lic, type: f.type, edition: f.edition, edition_name: f.edition_name, licensee: f.licensee,
    expires_at: f.expires_at, updates_until: f.updates_until, lease_until: f.lease_until,
  };
  const limited = (state, message) => ({ ...base, ...info, state, message, last_error: store.last_error || null });

  // Start-up checks (hardware ID, file integrity) take a few seconds
  // A half-read hardware ID (PowerShell slow at boot) would look like another PC:
  // keep checking instead of calling the licence invalid
  const partial = fingerprint && !isComplete(fingerprint) && Object.keys(f.fp || {}).length > Object.keys(fingerprint).length;
  if (!fingerprint || partial || (RELEASE && integrityNow === 'checking')) {
    ensureFingerprint();
    return limited('checking', 'Checking your licence…');
  }

  if (f.device !== store.device_id) return limited('invalid', 'This licence belongs to another installation. Please activate again on this computer.');
  if (f.fp && !sameDevice(f.fp, fingerprint)) {
    return limited('invalid', 'This licence was activated on a different computer. Activate it here (and deactivate the old PC if needed).');
  }
  if (store.revoked && store.revoked_lic === f.lic) return limited('invalid', store.revoked);

  // Clock set back: earlier than the licence server's own time when it signed the
  // file, or more than a day before the latest time this install has seen
  const seen = Math.max(store.last_time || 0, f.server_time || f.issued_at || 0);
  if (t < seen - DAY) {
    return limited('offline', 'Your computer\'s date looks wrong (it is earlier than before). Fix the date and connect to the internet once.');
  }
  if (f.expires_at && t > f.expires_at + (f.type === 'subscription' ? 7 * DAY : 0)) {
    return limited('expired', f.type === 'coupon'
      ? 'Your coupon period has ended. Buy a licence to keep publishing — all your data is still here.'
      : 'Your subscription has ended. Renew to keep publishing — all your data is still here.');
  }
  if (t > f.lease_until) {
    return limited('offline', 'Social-Nexus needs to connect to the internet briefly to confirm your licence.');
  }

  // Remember the latest time we've seen (never moves backwards); saved at most hourly
  if (!store.last_time || t > store.last_time + HOUR) { store.last_time = t; writeStoreQuietly(store); }

  const daysLeft = f.expires_at ? Math.max(0, Math.ceil((f.expires_at - t) / DAY)) : null;
  const leaseDays = Math.max(0, Math.floor((f.lease_until - t) / DAY));
  let message = null;
  if (daysLeft !== null && daysLeft <= 14) message = `${f.type === 'coupon' ? 'Coupon' : 'Subscription'} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`;
  else if (leaseDays <= 3) message = `Connect to the internet within ${leaseDays === 0 ? 'a day' : `${leaseDays} day${leaseDays === 1 ? '' : 's'}`} so Social-Nexus can confirm your licence.`;
  return {
    ...base, ...info, state: 'active', licensed: true, can_publish: f.limits?.publish !== false,
    limits: { ...LIMITED, ...f.limits }, days_left: daysLeft, message,
    needs_refresh: t >= (f.refresh_after || 0),
  };
}

// ── server calls ─────────────────────────────────────────────────────────────

async function call(endpoint, body) {
  try {
    const { data } = await axios.post(`${SERVER()}${endpoint}`, body, { timeout: 20000 });
    return data;
  } catch (err) {
    if (err.response?.data?.code) {
      const e = new Error(err.response.data.error || 'Licence server error');
      e.code = err.response.data.code;
      e.extra = err.response.data;
      throw e;
    }
    const st = err.response?.status;
    const e = new Error(st === 429 ? 'Too many attempts. Please wait a few minutes and try again.'
      : st >= 500 ? 'The licence server is having a problem. Please try again later — Social-Nexus keeps working meanwhile.'
      : st ? `The licence server answered with an error (${st}). Please try again later.`
      : 'Could not reach the licence server. Check your internet connection and try again.');
    e.code = st ? 'SERVER' : 'NETWORK';
    throw e;
  }
}

function acceptFile(store, file) {
  const payload = verifySignature(file);
  if (!payload) throw Object.assign(new Error('The licence file could not be verified (it may be for a different app or damaged).'), { code: 'BAD_SIGNATURE' });
  if (payload.device !== store.device_id) {
    // Same PC, new data folder (reinstall, reset, another Windows account): the
    // server recognised the hardware and kept the seat's original device id.
    if (fingerprint && payload.fp && sameDevice(payload.fp, fingerprint)) store.device_id = payload.device;
    else throw Object.assign(new Error('This licence file was made for a different installation.'), { code: 'DEVICE_MISMATCH' });
  }
  store.file = file;
  store.last_time = Math.max(now(), payload.server_time || 0);
  delete store.revoked;
  delete store.revoked_lic;
  delete store.last_error;
  writeStore(store);
}

function activate({ key, coupon, email, name, deviceName }) {
  return serial(async () => {
    const fp = await ensureFingerprint();
    const store = readStore();
    const body = {
      key: key ? String(key).trim() : undefined,
      coupon: coupon ? String(coupon).trim() : undefined,
      email: email || undefined, name: name || undefined,
      device_id: deviceId(store), components: fp,
      device_name: String(deviceName || 'My computer').slice(0, 60), app_version: APP_VERSION,
    };
    const data = await call('/v1/activate', body);
    acceptFile(readStore(), data.file);
    return status();
  });
}

// Called on a timer and from "Check now"; quietly does nothing when offline.
function refresh({ force = false } = {}) {
  return serial(async () => {
    const before = readStore();
    if (!before.file) return status();
    const s = status();
    if (s.integrity === 'modified') return s;
    // Due for a refresh, or blocked for a reason the server may have fixed
    // (renewed subscription, lifted suspension, lease ran out)
    const due = force || s.needs_refresh || ['offline', 'expired', 'invalid', 'checking'].includes(s.state);
    if (!due) return s;
    const current = verifySignature(before.file);
    if (!current) return s;
    const fp = await ensureFingerprint();
    // Don't let a half-read hardware ID cost the user their seat: wait for a full read
    if (!isComplete(fp) && Object.keys(current.fp || {}).length > Object.keys(fp).length) return status();
    try {
      const data = await call('/v1/refresh', { lic: current.lic, device_id: before.device_id, components: fp, app_version: APP_VERSION });
      const store = readStore();
      if (!store.file) return status(); // deactivated meanwhile
      acceptFile(store, data.file);
    } catch (err) {
      const store = readStore();
      if (!store.file) return status();
      if (['REVOKED', 'SUSPENDED', 'DEVICE_MISMATCH'].includes(err.code)) {
        store.revoked = err.message;
        store.revoked_lic = current.lic;
      } else {
        store.last_error = err.message; // expired / network etc. — keep working within the lease
      }
      writeStoreQuietly(store);
    }
    return status();
  });
}

function deactivate() {
  return serial(async () => {
    const store = readStore();
    if (!store.file) return status();
    const fp = await ensureFingerprint();
    const current = verifySignature(store.file);
    // Tell the server first, so the seat is really freed. Offline → keep the
    // licence here, otherwise the seat would stay taken with no way to free it.
    try {
      if (current) await call('/v1/deactivate', { lic: current.lic, device_id: store.device_id, components: fp });
    } catch (err) {
      if (err.code === 'TRANSFER_LIMIT') throw err; // keep the licence; support must move it
      if (err.code === 'NETWORK' || err.code === 'SERVER') {
        throw Object.assign(new Error(`${err.message} Deactivating needs the internet so your seat is freed for another PC.`), { code: err.code });
      }
      // Any other answer (licence already removed/revoked on the server): fine to remove here
    }
    const fresh = readStore();
    delete fresh.file;
    delete fresh.revoked;
    delete fresh.revoked_lic;
    writeStore(fresh);
    return status();
  });
}

// Offline activation: a request file the user takes to any internet device
async function offlineRequest({ key, deviceName }) {
  const fp = await ensureFingerprint();
  const store = readStore();
  return {
    kind: 'social-nexus-activation-request', v: 1, key: String(key || '').trim(),
    device_id: deviceId(store), components: fp, device_name: String(deviceName || 'My computer').slice(0, 60),
    app_version: APP_VERSION, created_at: now(), upload_at: `${SERVER()}/offline`,
  };
}

function importLicense(content) {
  let parsed = content;
  if (typeof content === 'string') { try { parsed = JSON.parse(content); } catch { parsed = null; } }
  const file = parsed?.kind === 'social-nexus-license' ? parsed.file : parsed;
  if (!file?.payload || !file?.sig) return Promise.reject(Object.assign(new Error('That is not a Social-Nexus licence file.'), { code: 'BAD_FILE' }));
  return serial(async () => {
    await ensureFingerprint(); // needed to recognise this PC after a reinstall
    const store = readStore();
    deviceId(store);
    acceptFile(store, file);
    return status();
  });
}

// Start-up: integrity + fingerprint, refresh when due, then check every 6 hours
let timer = null;
function start() {
  // A swapped/broken integrity module counts as modified; never let it stop start-up
  if (pinnedOk) { try { integrity().start(); } catch {} }
  // Read the hardware ID; if the first read is incomplete, try again a few times
  const delays = [30, 120, 300];
  const attempt = (i) => ensureFingerprint().then((fp) => {
    if (!isComplete(fp) && i < delays.length) setTimeout(() => attempt(i + 1), delays[i] * 1000).unref?.();
    return refresh();
  }).catch(() => {});
  attempt(0);
  if (!timer) {
    timer = setInterval(() => refresh().catch(() => {}), 6 * HOUR * 1000);
    timer.unref?.();
  }
}

module.exports = {
  status, activate, refresh, deactivate, offlineRequest, importLicense, start, ensureFingerprint,
  LIMITED, RELEASE, _verifySignature: verifySignature, serverUrl: () => SERVER(),
  // The signed licence file, sent to Radixile services (approval links, one-click
  // connect) to show this is a licensed copy. null when not licensed.
  licenseProof: () => { const st = readStore(); return st.file && status().licensed ? Buffer.from(JSON.stringify(st.file)).toString('base64') : null; },
};
