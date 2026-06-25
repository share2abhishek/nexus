/**
 * Downloads better-sqlite3 v11.3.0 prebuilt binary for Node.js v20 (ABI 115)
 * and places it as better_sqlite3.node for dev server use.
 */
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const tar   = require('../node_modules/tar');

const RELEASE_DIR = path.resolve(__dirname, '../node_modules/better-sqlite3/build/Release');
const URL = 'https://github.com/WiseLibs/better-sqlite3/releases/download/v11.3.0/better-sqlite3-v11.3.0-node-v115-win32-x64.tar.gz';
const DEST = path.join(RELEASE_DIR, 'better_sqlite3.node');
const TMP  = path.join(RELEASE_DIR, '__tmp_node.tar.gz');

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 15) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'nexus-build/1.0' } }, (res) => {
      const loc = res.headers.location;
      if ([301,302,307,308].includes(res.statusCode) && loc) {
        return get(loc, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('📦 Downloading better-sqlite3 v11.3.0 for Node.js v20 (ABI 115)...');
  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  const buf = await get(URL);
  console.log(`✅ Downloaded ${(buf.length/1024/1024).toFixed(1)} MB`);
  fs.writeFileSync(TMP, buf);

  // Remove existing dev binary
  if (fs.existsSync(DEST)) fs.unlinkSync(DEST);

  // Extract — tarball has "build/Release/better_sqlite3.node" (strip: 2)
  await tar.x({ file: TMP, cwd: RELEASE_DIR, strip: 2 });
  fs.unlinkSync(TMP);

  const files = fs.readdirSync(RELEASE_DIR);
  console.log('Files in Release dir:', files);

  if (fs.existsSync(DEST)) {
    console.log('✅ better_sqlite3.node (Node.js v20) is ready!');
  } else {
    console.log('❌ better_sqlite3.node not found after extraction!');
    console.log('Contents:', files);
  }
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
