// Checks that the installed app files are exactly what Radixile shipped.
//
// The manifest (config/integrity.json) is written and signed after packaging by
// scripts/release/after-sign.js. In a release build the licence module (compiled
// bytecode with the build key inside) loads this file's bytecode by its exact path
// and calls configure() with the key, so nothing here trusts a file a user could
// swap. Release rules: missing/unsigned manifest, a changed file or an extra file
// all count as "modified".
//
// A modified installation still starts (nobody loses access to their data), but
// licensing treats it as not genuine, so publishing/automation stay off.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'config', 'integrity.json');

let config = { release: false, buildKey: null };
let result = null;   // { state: 'dev' | 'ok' | 'unsigned' | 'modified' | 'checking', detail }
let running = null;

function configure({ release = false, buildKey = null } = {}) {
  config = { release, buildKey };
  result = null; running = null;
}

// Reads the manifest and checks its signature. Returns { files } or a final result.
function readManifest() {
  if (!fs.existsSync(MANIFEST)) {
    return config.release
      ? { result: { state: 'modified', detail: 'The integrity manifest is missing' } }
      : { result: { state: 'dev', detail: 'Development build (no integrity manifest)' } };
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const payload = Buffer.from(manifest.payload, 'base64');
  if (!manifest.sig || !config.buildKey) {
    // Release builds must be signed; unsigned manifests are only for internal test builds
    if (config.release) return { result: { state: 'modified', detail: 'The integrity manifest is not signed' } };
    return { files: JSON.parse(payload.toString('utf8')).files, unsigned: true };
  }
  if (!crypto.verify(null, payload, crypto.createPublicKey(config.buildKey), Buffer.from(manifest.sig, 'base64'))) {
    return { result: { state: 'modified', detail: 'The integrity manifest signature is not valid' } };
  }
  return { files: JSON.parse(payload.toString('utf8')).files };
}

function locate(rel) {
  // The bundled node.exe lives next to the app folder: check the runtime we run on
  return rel === 'runtime:node.exe' ? process.execPath : path.join(ROOT, rel);
}

async function hashFile(p) {
  return crypto.createHash('sha256').update(await fs.promises.readFile(p)).digest('hex');
}

// First file under the app folder that isn't in the manifest (or null)
async function findExtraFile(dir, files) {
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findExtraFile(p, files);
      if (found) return found;
    } else {
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (rel !== 'config/integrity.json' && !(rel in files)) return rel;
    }
  }
  return null;
}

// Full check, in the background (hashing a few thousand files takes a moment)
async function run() {
  try {
    const m = readManifest();
    if (m.result) return (result = m.result);
    for (const [rel, hash] of Object.entries(m.files)) {
      let actual;
      try { actual = await hashFile(locate(rel)); } catch { return (result = { state: 'modified', detail: `Missing file: ${rel}` }); }
      if (actual !== hash) return (result = { state: 'modified', detail: `Changed file: ${rel}` });
    }
    // Release: an added file (e.g. a module placed to shadow a real one) is tampering too.
    // The app never writes into its install folder (data lives in %APPDATA%).
    if (config.release) {
      const extra = await findExtraFile(ROOT, m.files);
      if (extra) return (result = { state: 'modified', detail: `Unexpected file: ${extra}` });
    }
    return (result = m.unsigned
      ? { state: 'unsigned', detail: 'Internal build: integrity not signed' }
      : { state: 'ok', detail: 'Genuine Radixile build' });
  } catch (err) {
    return (result = { state: 'modified', detail: `Integrity check failed: ${err.message}` });
  }
}

// Starts the check once; resolves with the result.
function start() {
  if (!running) running = run();
  return running;
}

// Synchronous view for status(): "checking" until the background check finishes.
function check() {
  if (result) return result;
  if (!config.release && !fs.existsSync(MANIFEST)) return (result = { state: 'dev', detail: 'Development build (no integrity manifest)' });
  start();
  return { state: 'checking', detail: 'Checking the installation' };
}

module.exports = { check, start, configure };
