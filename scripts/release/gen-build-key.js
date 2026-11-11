// One-time: create the key that signs each release's integrity manifest.
//   node scripts/release/gen-build-key.js
// Writes config/build-public-key.pem (commit it — the app uses it to check that
// its own files are genuine) and prints BUILD_SIGNING_KEY for the build machine /
// CI secret store. Keep the private key secret and backed up offline; it is NOT
// the licence signing key and never goes to the licence server.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', '..', 'config', 'build-public-key.pem');
if (fs.existsSync(out) && !process.argv.includes('--force')) {
  console.error(`${out} already exists. Re-run with --force only if you really want a new build key (old builds keep their own check).`);
  process.exit(1);
}
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(out, publicKey.export({ type: 'spki', format: 'pem' }));
console.log('Public key written to', out, '(commit this file).\n');
console.log('Store this as a secret on the build machine / CI (never commit it):\n');
console.log(`BUILD_SIGNING_KEY=${Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64')}`);
