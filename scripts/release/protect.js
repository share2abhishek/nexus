// Release-time protection, run by build/build-win.ps1 with the BUNDLED node.exe
// (V8 bytecode only runs on the exact V8 it was compiled with).
//
//   node scripts/release/protect.js            protect (before electron-builder)
//   node scripts/release/protect.js --restore  put the readable sources back
//
// 1. Compiles the integrity check to V8 bytecode.
// 2. Writes the licence public keys (config/license-keys/*.pem), the build public
//    key and the integrity bytecode's SHA-256 straight into services/license/index.js
//    (RELEASE_CONSTANTS / PINNED_HASHES), then compiles that to bytecode too. A
//    release build trusts ONLY these: env vars, .env entries and extra key files
//    are ignored, and the integrity bytecode is loaded by exact path.
// 3. config/integrity.json is written after packaging by scripts/release/after-sign.js
//    (electron-builder afterSign hook), over the files exactly as installed.
//
// Honest limit: this makes cracking expensive, not impossible. The licence server
// and signed licences remain the real protection.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const BACKUP = path.join(ROOT, '.protect-backup');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function backup(relPath) {
  const src = path.join(ROOT, relPath);
  const dst = path.join(BACKUP, relPath);
  if (!fs.existsSync(src) || fs.existsSync(dst)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function restore() {
  if (fs.existsSync(BACKUP)) {
    for (const file of walk(BACKUP)) {
      const target = path.join(ROOT, path.relative(BACKUP, file));
      fs.copyFileSync(file, target);
      const jsc = target.replace(/\.js$/, '.jsc');
      if (fs.existsSync(jsc)) fs.rmSync(jsc);
    }
    fs.rmSync(BACKUP, { recursive: true, force: true });
  }
  fs.rmSync(path.join(ROOT, 'config', 'integrity.json'), { force: true });
  console.log('[protect] readable sources restored');
}

function compile(relPath) {
  const bytenode = require('bytenode');
  const src = path.join(ROOT, relPath);
  backup(relPath);
  const jsc = src.replace(/\.js$/, '.jsc');
  bytenode.compileFile({ filename: src, output: jsc, compileAsModule: true });
  fs.writeFileSync(src, `// Compiled for release — source is not shipped.\nrequire('bytenode');\nmodule.exports = require('./${path.basename(jsc)}');\n`);
  console.log('[protect] bytecode', relPath);
  return sha256(jsc);
}

function protect() {
  if (fs.existsSync(BACKUP)) restore(); // previous run was interrupted

  // 1. release constants
  const keysDir = path.join(ROOT, 'config', 'license-keys');
  const licenseKeys = {};
  if (fs.existsSync(keysDir)) {
    for (const f of fs.readdirSync(keysDir)) if (f.endsWith('.pem')) licenseKeys[f.slice(0, -4)] = fs.readFileSync(path.join(keysDir, f), 'utf8');
  }
  if (!Object.keys(licenseKeys).length) throw new Error('No licence public key in config/license-keys/ — run `npm run keys` in the licence server repository and copy public-keys/<kid>.pem here first.');
  const buildKeyFile = path.join(ROOT, 'config', 'build-public-key.pem');
  const buildKey = fs.existsSync(buildKeyFile) ? fs.readFileSync(buildKeyFile, 'utf8') : null;
  if (!buildKey) throw new Error('config/build-public-key.pem missing — run scripts/release/gen-build-key.js first.');

  // 2. bytecode: the integrity check first, then bake its hash and the keys into the licence module
  const pinned = { 'integrity.jsc': compile('services/integrity.js') };
  compile('services/license/fingerprint.js');
  compile('middleware/license.js');
  const indexRel = 'services/license/index.js';
  backup(indexRel);
  const indexSrc = fs.readFileSync(path.join(ROOT, indexRel), 'utf8');
  for (const ph of ['const PINNED_HASHES = null;', 'const RELEASE_CONSTANTS = null;']) {
    if (!indexSrc.includes(ph)) throw new Error(`services/license/index.js is missing the placeholder: ${ph}`);
  }
  fs.writeFileSync(path.join(ROOT, indexRel), indexSrc
    .replace('const PINNED_HASHES = null;', `const PINNED_HASHES = ${JSON.stringify(pinned)};`)
    .replace('const RELEASE_CONSTANTS = null;', `const RELEASE_CONSTANTS = ${JSON.stringify({ LICENSE_KEYS: licenseKeys, BUILD_PUBLIC_KEY: buildKey })};`));
  compile(indexRel);
  // 3. The integrity manifest is written after packaging by scripts/release/after-sign.js
  //    (electron-builder rewrites package.json and prunes node_modules, so hashing here would be wrong).
}

if (process.argv.includes('--restore')) restore();
else {
  try { protect(); } catch (err) { console.error('[protect] FAILED:', err.message); restore(); process.exit(1); }
}
