// services/integrity.js: development vs release behaviour
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const manifest = path.join(ROOT, 'config', 'integrity.json');
const hadManifest = fs.existsSync(manifest);

afterAll(() => { if (!hadManifest) fs.rmSync(manifest, { force: true }); });

function fresh(cfg) {
  jest.resetModules();
  const integrity = require('../services/integrity');
  if (cfg) integrity.configure(cfg);
  return integrity;
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const buildKey = publicKey.export({ type: 'spki', format: 'pem' });
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');

function writeManifest(files, sign = true) {
  const payload = Buffer.from(JSON.stringify({ v: 1, files }));
  fs.writeFileSync(manifest, JSON.stringify({ v: 1, payload: payload.toString('base64'), sig: sign ? crypto.sign(null, payload, privateKey).toString('base64') : null }));
}

// A manifest of every file in the project (like after-sign.js does for the packaged app)
function allFiles(dir = ROOT, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    if (e.isDirectory()) allFiles(p, out); else if (rel !== 'config/integrity.json') out[rel] = 'x';
  }
  return out;
}

const maybe = hadManifest ? test.skip : test; // a build left a manifest behind: don't touch it

maybe('development without a manifest is "dev"', () => {
  expect(fresh().check().state).toBe('dev');
});

maybe('release without a manifest is "modified"', async () => {
  const integrity = fresh({ release: true, buildKey });
  expect(integrity.check().state).toBe('checking');
  expect((await integrity.start()).state).toBe('modified');
});

maybe('release: a changed file or an unsigned manifest is "modified"', async () => {
  const target = 'services/platforms/guides.js';
  try {
    writeManifest({ [target]: '0'.repeat(64) });
    expect((await fresh({ release: true, buildKey }).start()).detail).toMatch(/Changed file/);
    writeManifest({ [target]: sha(target) }, false);
    expect((await fresh({ release: true, buildKey }).start()).detail).toMatch(/not signed/);
    // signed with another key
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    writeManifest({ [target]: sha(target) });
    expect((await fresh({ release: true, buildKey: other }).start()).detail).toMatch(/signature/);
  } finally { fs.rmSync(manifest, { force: true }); }
});

maybe('release: an extra file not in the manifest is "modified"', async () => {
  const target = 'services/platforms/guides.js';
  try {
    writeManifest({ [target]: sha(target) }); // only one file listed; the project has many more
    const r = await fresh({ release: true, buildKey }).start();
    expect(r.state).toBe('modified');
    expect(r.detail).toMatch(/Unexpected file/);
  } finally { fs.rmSync(manifest, { force: true }); }
});

maybe('development build with an unsigned manifest of matching files is "unsigned"', async () => {
  const target = 'services/platforms/guides.js';
  try {
    writeManifest({ [target]: sha(target) }, false);
    expect((await fresh().start()).state).toBe('unsigned');
  } finally { fs.rmSync(manifest, { force: true }); }
});

// keeps allFiles referenced for future packaged-layout tests
test('helper lists project files', () => { expect(Object.keys(allFiles(path.join(ROOT, 'services', 'platforms'))).length).toBeGreaterThan(0); });
