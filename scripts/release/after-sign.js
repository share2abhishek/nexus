// electron-builder "afterSign" hook: writes config/integrity.json over the files
// exactly as they will be installed (after electron-builder has rewritten
// package.json, pruned node_modules and signed the exe), then signs it with
// BUILD_SIGNING_KEY. Runs before the installer is made.
//
// Only runs for protected builds (build/build-win.ps1 sets SN_PROTECTED=1 after
// scripts/release/protect.js); plain `npm run dist` builds stay "dev".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function writeManifest(appDir, nodeExe) {
  const out = path.join(appDir, 'config', 'integrity.json');
  fs.rmSync(out, { force: true });
  const files = {};
  for (const f of walk(appDir)) files[path.relative(appDir, f).split(path.sep).join('/')] = sha256(f);
  if (nodeExe && fs.existsSync(nodeExe)) files['runtime:node.exe'] = sha256(nodeExe);

  const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
  const payload = Buffer.from(JSON.stringify({ v: 1, version, created_at: new Date().toISOString(), files }));
  const manifest = { v: 1, payload: payload.toString('base64'), sig: null };
  let keyPem = process.env.BUILD_SIGNING_KEY || '';
  if (keyPem && !keyPem.includes('BEGIN')) keyPem = Buffer.from(keyPem, 'base64').toString('utf8');
  if (keyPem) manifest.sig = crypto.sign(null, payload, crypto.createPrivateKey(keyPem)).toString('base64');
  else console.warn('[integrity] BUILD_SIGNING_KEY not set: manifest UNSIGNED, so this build reports itself as modified (internal testing only)');
  fs.writeFileSync(out, JSON.stringify(manifest));
  console.log(`[integrity] manifest: ${Object.keys(files).length} files${manifest.sig ? ', signed' : ''}`);
}

exports.default = async function afterSign(context) {
  if (process.env.SN_PROTECTED !== '1') return;
  if (context.electronPlatformName !== 'win32') return; // Windows only for now
  const res = path.join(context.appOutDir, 'resources');
  writeManifest(path.join(res, 'app'), path.join(res, 'node', 'node.exe'));
};
exports.writeManifest = writeManifest;
