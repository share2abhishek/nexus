/**
 * Downloads the prebuilt better-sqlite3 binary for Electron 35 (ABI 133)
 * and replaces the existing .node file.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BINARY_URL = 'https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-electron-v133-win32-x64.tar.gz';
const RELEASE_DIR = path.resolve(__dirname, '../node_modules/better-sqlite3/build/Release');
const TEMP_FILE = path.resolve(__dirname, '__prebuilt.tar.gz');

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'nexus-build/1.0' } }, (res) => {
      const loc = res.headers.location;
      if ([301, 302, 307, 308].includes(res.statusCode) && loc) {
        return get(loc, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('📦 Downloading prebuilt better-sqlite3 binary for Electron 35 (ABI 133)...');
  console.log('URL:', BINARY_URL);
  
  const buf = await get(BINARY_URL);
  console.log(`✅ Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  fs.writeFileSync(TEMP_FILE, buf);
  console.log('📂 Extracting to:', RELEASE_DIR);
  
  fs.mkdirSync(RELEASE_DIR, { recursive: true });

  // Extract the .node file from the tarball
  const tarModule = path.resolve(__dirname, '../node_modules/tar');
  const tar = require(tarModule);
  
  await tar.x({
    file: TEMP_FILE,
    cwd: RELEASE_DIR,
    strip: 2,   // removes "build/Release/" prefix
    filter: (entry) => entry.endsWith('.node'),
  });

  fs.unlinkSync(TEMP_FILE);
  
  // Verify
  const nodes = fs.readdirSync(RELEASE_DIR).filter(f => f.endsWith('.node'));
  console.log('✅ Extracted:', nodes);
  console.log('🎉 Done! better-sqlite3 is now compiled for Electron 35 (ABI 133)');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
