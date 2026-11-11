// Desktop licence client against a real (in-process) licence server.
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snx-client-'));
process.env.LICENSE_DB = 'memory';
process.env.PAYMENTS_MODE = 'mock';
process.env.ADMIN_EMAIL = 'owner@radixile.test';
process.env.ADMIN_PASSWORD = 'owner-password-123';
process.env.LICENSE_KEYS_DIR = path.join(tmp, 'keys');
process.env.NEXUS_DATA_DIR = path.join(tmp, 'data');
process.env.LICENSE_PUBLIC_KEY_PATH = path.join(tmp, 'keys', 'license-public.pem');

// Pretend to be a specific PC
const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
global.__pc = 1; // which simulated PC we are
jest.mock('../services/license/fingerprint', () => {
  const real = jest.requireActual('../services/license/fingerprint');
  const hh = (s) => require('crypto').createHash('sha256').update(s).digest('hex');
  const fp = (n) => ({ machine: hh(`m${n}`), board: hh(`b${n}`), disk: hh(`d${n}`), cpu: hh(`c${n}`) });
  // global.__partial: simulate a slow/blocked hardware read (only one part comes back)
  return { ...real, getFingerprint: async () => (global.__partial ? { machine: fp(global.__pc).machine } : fp(global.__pc)) };
});

const request = require('supertest');
// The licence server is its own repository. These end-to-end tests need a copy of
// it: next to this repo (../license-server) or wherever LICENSE_SERVER_DIR points.
// Without one they are skipped, so the app's tests run on their own.
const SERVER_DIR = path.resolve(process.env.LICENSE_SERVER_DIR || path.join(__dirname, '..', '..', 'license-server'));
const HAVE_SERVER = fs.existsSync(path.join(SERVER_DIR, 'src', 'server.js'));
if (!HAVE_SERVER) console.warn(`[license.client] Skipped: licence server not found at ${SERVER_DIR} (set LICENSE_SERVER_DIR to run these tests).`);

(HAVE_SERVER ? describe : describe.skip)('licence client against the licence server', () => {
  let server, knex, admin, license;
  const storeFile = () => path.join(process.env.NEXUS_DATA_DIR, 'license', 'license.json');

  beforeAll(async () => {
    const { createApp } = require(path.join(SERVER_DIR, 'src', 'server'));
    const created = await createApp();
    knex = created.knex;
    server = created.app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    process.env.LICENSE_SERVER_URL = `http://127.0.0.1:${server.address().port}`;
    admin = request.agent(created.app);
    await admin.post('/admin/api/login').send({ email: 'owner@radixile.test', password: 'owner-password-123' });
    license = require('../services/license');
    await license.ensureFingerprint();
  }, 30000);

  afterAll(async () => {
    server?.close();
    await knex?.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const adminPost = (url, body) => admin.post(url).set('X-Requested-With', 'social-nexus-admin').send(body);

  test('starts unlicensed: no publishing, small limits', () => {
    const s = license.status();
    expect(s.state).toBe('unlicensed');
    expect(s.can_publish).toBe(false);
    expect(s.limits.workspaces).toBe(1);
  });

  test('activating a key unlocks the edition', async () => {
    const { body } = await adminPost('/admin/api/licenses', { type: 'perpetual', edition: 'agency', email: 'a@example.test', name: 'Asha Agency' });
    const s = await license.activate({ key: body.key, deviceName: 'Office PC' });
    expect(s.state).toBe('active');
    expect(s.can_publish).toBe(true);
    expect(s.licensee).toBe('Asha Agency');
    expect(s.limits.workspaces).toBe(25);
    expect(s.limits.seats).toBe(5);
  });

  test('an edited licence file is rejected', () => {
    const saved = fs.readFileSync(storeFile(), 'utf8');
    const store = JSON.parse(saved);
    const payload = JSON.parse(Buffer.from(store.file.payload, 'base64').toString());
    payload.limits.workspaces = 9999;
    store.file.payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    fs.writeFileSync(storeFile(), JSON.stringify(store));
    expect(license.status().state).toBe('invalid');
    fs.writeFileSync(storeFile(), saved);
    expect(license.status().state).toBe('active');
  });

  test('a copied data folder does not work on another computer', async () => {
    jest.resetModules(); // fresh licence module = fresh fingerprint cache
    global.__pc = 2;
    const other = require('../services/license');
    await other.ensureFingerprint();
    expect(other.status().state).toBe('invalid');
    global.__pc = 1;
  });

  test('setting the clock back is detected', () => {
    const store = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    store.last_time = Math.floor(Date.now() / 1000) + 5 * 86400; // "we saw a later date before"
    fs.writeFileSync(storeFile(), JSON.stringify(store));
    expect(license.status().state).toBe('offline');
    store.last_time = Math.floor(Date.now() / 1000);
    fs.writeFileSync(storeFile(), JSON.stringify(store));
    expect(license.status().state).toBe('active');
  });

  test('refresh renews the lease; revocation is picked up', async () => {
    const s1 = await license.refresh({ force: true });
    expect(s1.state).toBe('active');
    const lic = await knex('licenses').where({ licensee: 'Asha Agency' }).first();
    await adminPost(`/admin/api/licenses/${lic.id}/status`, { status: 'revoked' });
    const s2 = await license.refresh({ force: true });
    expect(s2.state).toBe('invalid');
    expect(s2.can_publish).toBe(false);
  });

  test('a 6-month coupon unlocks the Full edition, with days left', async () => {
    const { body } = await adminPost('/admin/api/coupons', { name: 'Six months', duration_days: 180, count: 1 });
    fs.rmSync(storeFile(), { force: true });
    global.__pc = 3;
    jest.resetModules();
    license = require('../services/license');
    const s = await license.activate({ coupon: body.codes[0], email: 'promo@example.test' });
    expect(s.state).toBe('active');
    expect(s.type).toBe('coupon');
    expect(s.edition).toBe('full');
    expect(s.days_left).toBeGreaterThanOrEqual(179);
  });

  test('offline activation: request file → server → licence file import', async () => {
    const { body } = await adminPost('/admin/api/licenses', { type: 'subscription', edition: 'individual', email: 'off@example.test', days: 365 });
    fs.rmSync(storeFile(), { force: true });
    global.__pc = 4;
    jest.resetModules();
    license = require('../services/license');
    const req = await license.offlineRequest({ key: body.key, deviceName: 'Air-gapped PC' });
    expect(req.kind).toBe('social-nexus-activation-request');
    expect(JSON.stringify(req)).not.toMatch(/serial/i);
    const signed = await request(`http://127.0.0.1:${server.address().port}`).post('/offline/activate').send({ request: req });
    expect(signed.status).toBe(200);
    const s = await license.importLicense({ kind: 'social-nexus-license', file: signed.body.file });
    expect(s.state).toBe('active');
    expect(s.type).toBe('subscription');
  });

  test('deactivate removes the local licence and frees the seat', async () => {
    const s = await license.deactivate();
    expect(s.state).toBe('unlicensed');
    const active = await knex('devices').where({ status: 'active', name: 'Air-gapped PC' });
    expect(active).toHaveLength(0);
  });

  // ── fixes from the step-3 reviews ────────────────────────────────────────────

  test('same PC with a fresh data folder can activate again (reinstall / reset)', async () => {
    const { body } = await adminPost('/admin/api/licenses', { type: 'perpetual', edition: 'individual', email: 're@example.test' });
    global.__pc = 5;
    fs.rmSync(storeFile(), { force: true });
    jest.resetModules();
    license = require('../services/license');
    expect((await license.activate({ key: body.key })).state).toBe('active');
    fs.rmSync(storeFile(), { force: true }); // data folder wiped, new device id
    jest.resetModules();
    license = require('../services/license');
    const s = await license.activate({ key: body.key });
    expect(s.state).toBe('active');
  });

  test('a clock set before the licence was issued is detected even without saved state', () => {
    const store = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    delete store.last_time; // deleting the saved time doesn't help
    fs.writeFileSync(storeFile(), JSON.stringify(store));
    const realNow = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(realNow - 3 * 86400 * 1000);
    try { expect(license.status().state).toBe('offline'); } finally { spy.mockRestore(); }
    expect(license.status().state).toBe('active');
  });

  test('deactivating while offline keeps the licence (so the seat is not lost)', async () => {
    const url = process.env.LICENSE_SERVER_URL;
    process.env.LICENSE_SERVER_URL = 'http://127.0.0.1:9'; // nothing listens here
    try {
      await expect(license.deactivate()).rejects.toMatchObject({ code: 'NETWORK' });
      expect(license.status().state).toBe('active');
    } finally { process.env.LICENSE_SERVER_URL = url; }
    expect((await license.deactivate()).state).toBe('unlicensed');
  });

  test('a half-read hardware ID shows "checking", not "another computer"', async () => {
    const { body } = await adminPost('/admin/api/licenses', { type: 'perpetual', edition: 'individual', email: 'slow@example.test' });
    global.__pc = 6;
    fs.rmSync(storeFile(), { force: true });
    jest.resetModules();
    license = require('../services/license');
    expect((await license.activate({ key: body.key })).state).toBe('active');
    global.__partial = true;
    jest.resetModules();
    license = require('../services/license');
    await license.ensureFingerprint();
    try {
      const s = license.status();
      expect(s.state).toBe('checking');
      expect(s.can_publish).toBe(false);
      // refresh must not send the partial ID (that could cost the seat)
      expect((await license.refresh({ force: true })).state).toBe('checking');
    } finally { global.__partial = false; }
    // next read is complete again → active
    await license.ensureFingerprint();
    expect(license.status().state).toBe('active');
  });
});
