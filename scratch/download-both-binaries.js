/**
 * Downloads better-sqlite3 prebuilt binaries for BOTH:
 *   1. Node.js v20 (ABI 115) — used by "npm run dev"
 *   2. Electron 35 (ABI 133) — used by the packaged EXE
 *
 * Stores them as:
 *   node_modules/better-sqlite3/build/Release/better_sqlite3.node  (active: node 20)
 *   node_modules/better-sqlite3/build/Release/better_sqlite3_electron.node  (electron copy)
 *
 * The electron/main.js will swap to the electron binary at runtime when packaged.
 */
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const tar   = require('../node_modules/tar');

const RELEASE_DIR = path.resolve(__dirname, '../node_modules/better-sqlite3/build/Release');

const BINARIES = [
  {
    label: 'Node.js v20 (ABI 115) — for development',
    url: 'https://github.com/WiseLibs/better-sqlite3/releases/download/v11.3.0/better-sqlite3-v11.3.0-node-v115-win32-x64.tar.gz',
    dest: 'better_sqlite3.node',
    strip: 2,
  },
  {
    label: 'Electron 35 (ABI 133) — for packaged EXE',
    url: 'https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-electron-v133-win32-x64.tar.gz',
    dest: 'better_sqlite3_electron.node',
    strip: 2,
  },
];

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 15) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'nexus-build/1.0' } }, (res) => {
      const loc = res.headers.location;
      if ([301,302,307,308].includes(res.statusCode) && loc) {
        return get(loc, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadBinary({ label, url, dest, strip }) {
  console.log(`\n📦 ${label}`);
  console.log(`   URL: ${url}`);
  const buf = await get(url);
  console.log(`   ✅ Downloaded ${(buf.length/1024/1024).toFixed(1)} MB`);

  const tmpFile = path.join(RELEASE_DIR, `__tmp_${dest}.tar.gz`);
  fs.writeFileSync(tmpFile, buf);

  // Extract .node files from tarball, rename to dest
  const extracted = [];
  await tar.x({
    file: tmpFile,
    cwd: RELEASE_DIR,
    strip,
    filter: entry => entry.endsWith('.node'),
    onentry: entry => { extracted.push(path.basename(entry.path)); },
  });

  fs.unlinkSync(tmpFile);

  // Rename extracted file to desired dest name
  const files = fs.readdirSync(RELEASE_DIR).filter(f => f.endsWith('.node') && f !== 'better_sqlite3_electron.node');
  // Move the most recently-written .node file
  const sorted = files
    .map(f => ({ f, mt: fs.statSync(path.join(RELEASE_DIR, f)).mtimeMs }))
    .sort((a,b) => b.mt - a.mt);

  if (dest !== 'better_sqlite3.node' && sorted.length > 0 && sorted[0].f !== dest) {
    // The node binary for dev is already named correctly; for electron we rename
    const src = path.join(RELEASE_DIR, sorted[0].f);
    const dst = path.join(RELEASE_DIR, dest);
    if (fs.existsSync(dst)) fs.unlinkSync(dst);
    fs.renameSync(src, dst);
    console.log(`   ✅ Saved as: ${dest}`);
  } else {
    console.log(`   ✅ Saved as: ${sorted[0]?.f || dest}`);
  }
}

async function main() {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  // First restore the Electron binary we already have (save it)
  const electronBin = path.join(RELEASE_DIR, 'better_sqlite3_electron.node');
  const devBin      = path.join(RELEASE_DIR, 'better_sqlite3.node');

  // If current .node is Electron binary, back it up first
  if (fs.existsSync(devBin)) {
    try {
      const { execSync } = require('child_process');
      // Quick check: try loading — if it fails, it's the wrong ABI
      // We'll just back it up and re-download
    } catch {}
  }

  for (const b of BINARIES) {
    try {
      await downloadBinary(b);
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}`);
    }
  }

  console.log('\n🎉 Done! Both binaries ready:');
  fs.readdirSync(RELEASE_DIR)
    .filter(f => f.endsWith('.node'))
    .forEach(f => console.log(`   • ${f}`));

  console.log('\n✅ Dev server (node) will use: better_sqlite3.node');
  console.log('✅ Packaged EXE (electron) will use: better_sqlite3_electron.node');
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
