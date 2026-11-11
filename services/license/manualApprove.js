// services/license/manualApprove.js
// Provides manual / emergency approval and signing of licenses directly on the host.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getFingerprint } = require('./fingerprint');
const licenseService = require('./index');

function dataDir() {
  return process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}

function storeFile() {
  return path.join(dataDir(), 'license', 'license.json');
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(data) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function getSigningKey() {
  // 1. Check process.env.LICENSE_PRIVATE_KEY
  if (process.env.LICENSE_PRIVATE_KEY) {
    let pem = process.env.LICENSE_PRIVATE_KEY;
    if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
    return { kid: process.env.LICENSE_KEY_ID || 'dev', privateKey: crypto.createPrivateKey(pem) };
  }

  // 2. Check local license-server private key if available
  const devServerPriv = 'D:/Social/license-server/keys/license-private.pem';
  if (fs.existsSync(devServerPriv)) {
    const pem = fs.readFileSync(devServerPriv, 'utf8');
    const pub = 'D:/Social/license-server/keys/license-public.pem';
    if (fs.existsSync(pub)) {
      // Ensure it is in config/license-keys/dev.pem
      const dest = path.join(__dirname, '..', '..', 'config', 'license-keys', 'dev.pem');
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) fs.copyFileSync(pub, dest);
      } catch {}
    }
    return { kid: 'dev', privateKey: crypto.createPrivateKey(pem) };
  }

  // 3. Fallback: dedicated manual signing key
  const manualDir = path.join(dataDir(), 'license');
  const manualPriv = path.join(manualDir, 'manual-private.pem');
  const manualPub = path.join(__dirname, '..', '..', 'config', 'license-keys', 'manual.pem');

  if (fs.existsSync(manualPriv) && fs.existsSync(manualPub)) {
    return { kid: 'manual', privateKey: crypto.createPrivateKey(fs.readFileSync(manualPriv, 'utf8')) };
  }

  // Generate pair
  fs.mkdirSync(manualDir, { recursive: true });
  fs.mkdirSync(path.dirname(manualPub), { recursive: true });
  const pair = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(manualPriv, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(manualPub, pair.publicKey.export({ type: 'spki', format: 'pem' }));

  return { kid: 'manual', privateKey: pair.privateKey };
}

async function manualApprove(options = {}) {
  const fp = await getFingerprint();
  const store = readStore();
  if (!store.device_id) {
    store.device_id = crypto.randomUUID();
  }

  const { kid, privateKey } = getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const validYears = Number(options.validYears) || 5;

  const edition = options.edition === 'individual' ? 'individual' : 'agency';
  const editionName = edition === 'individual' ? 'Individual' : 'Agency (All Features)';
  const licensee = String(options.licensee || '').trim();

  const seats = edition === 'individual' ? 1 : (Number(options.seats) || 5);
  const workspaces = edition === 'individual' ? 1 : (Number(options.workspaces) || 25);
  const users = edition === 'individual' ? 2 : (Number(options.users) || 10);

  const payload = {
    v: 2,
    lic: options.licId || `L-MANUAL-${Date.now().toString(36).toUpperCase()}`,
    type: 'perpetual',
    edition,
    edition_name: editionName,
    licensee,
    device: store.device_id,
    fp,
    issued_at: now,
    server_time: now,
    lease_until: now + validYears * 365 * 86400,
    refresh_after: now + Math.floor(validYears * 180 * 86400),
    expires_at: null,
    updates_until: now + validYears * 365 * 86400,
    limits: {
      seats,
      workspaces,
      users,
      autopilot_rules: -1,
      seo_sites: 10,
      publish: true,
      team_mode: edition !== 'individual',
    },
  };

  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, bytes, privateKey).toString('base64');

  store.file = {
    v: 2,
    kid,
    payload: bytes.toString('base64'),
    sig,
  };
  store.last_time = now;
  delete store.revoked;
  delete store.revoked_lic;
  delete store.last_error;

  writeStore(store);

  // Trigger internal status update
  await licenseService.ensureFingerprint();
  return licenseService.status();
}

module.exports = { manualApprove, getSigningKey };
