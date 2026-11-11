// Backups of everything Social-Nexus keeps on this PC.
//
//  - Daily automatic backup (the newest 7 are kept; ones you make yourself, the
//    newest 10): a safe copy of the database plus settings, in
//    <data folder>/backups/<date-time>/. The media library isn't copied every day
//    (it only grows; files are kept until deleted). Saved logins stay encrypted
//    with this PC's key.
//  - Export: one ".snbackup" file with the database, settings and media library,
//    to keep on a USB stick or move to another PC. The whole file is encrypted
//    with a passphrase the person chooses (inside it, logins are readable so the
//    new PC can use them). Without the passphrase the file is useless.
//  - Restore: the chosen backup is unpacked next to the data and swapped in at the
//    next start, before the database is opened. The data being replaced is kept
//    in backups/before-restore-<time>/ first (the newest 2 are kept).
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const dataDir = () => process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const backupsDir = () => path.join(dataDir(), 'backups');
const pendingDir = () => path.join(dataDir(), 'restore-pending');
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');
const KEEP = { daily: 7, manual: 10, 'before-restore': 2 };
// The licence isn't included: it belongs to this PC (activate again on a new PC)
const SETTINGS_FILES = ['.env', 'desktop-settings.json'];
const MAGIC = 'SNBACKUP1\n';          // the plain layout (inside an encrypted file; older exports)
const MAGIC_LOCKED = 'SNBACKUP2\n';   // passphrase-encrypted: salt(16) iv(12) data… tag(16)
const crypto = require('crypto');
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const passKey = (pass, salt) => crypto.scryptSync(String(pass), salt, 32, SCRYPT);

function checkPassphrase(p) {
  if (typeof p !== 'string' || p.length < 8) throw Object.assign(new Error('Choose a passphrase of at least 8 characters for the backup file.'), { status: 400 });
}

// Encrypts a plain backup file into the locked format
async function lockFile(plainFile, outFile, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', passKey(passphrase, salt), iv);
  const out = fs.createWriteStream(outFile);
  out.write(Buffer.concat([Buffer.from(MAGIC_LOCKED), salt, iv]));
  await pipeline(fs.createReadStream(plainFile), cipher, out, { end: false });
  await new Promise((res, rej) => out.end(cipher.getAuthTag(), err => (err ? rej(err) : res())));
}

// Decrypts a locked backup to a plain file; a wrong passphrase is reported plainly
async function unlockFile(lockedFile, plainOut, passphrase) {
  const size = fs.statSync(lockedFile).size;
  const head = MAGIC_LOCKED.length;
  if (size < head + 16 + 12 + 16) throw new Error('The backup file is damaged.');
  const fd = fs.openSync(lockedFile, 'r');
  let salt, iv, tag;
  try {
    salt = readAt(fd, head, 16); iv = readAt(fd, head + 16, 12); tag = readAt(fd, size - 16, 16);
  } finally { fs.closeSync(fd); }
  const decipher = crypto.createDecipheriv('aes-256-gcm', passKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(fs.createReadStream(lockedFile, { start: head + 28, end: size - 17 }), decipher, fs.createWriteStream(plainOut));
  } catch {
    try { fs.unlinkSync(plainOut); } catch {}
    throw Object.assign(new Error('Wrong passphrase, or the backup file is damaged.'), { status: 400, code: 'BAD_PASSPHRASE' });
  }
}

const isLocked = (file) => {
  const fd = fs.openSync(file, 'r');
  try { return readAt(fd, 0, MAGIC_LOCKED.length).toString() === MAGIC_LOCKED; } finally { fs.closeSync(fd); }
};

const stamp = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');

// A consistent copy of the open database (SQLite's own online copy)
async function copyDatabase(knex, dest) {
  if (knex.client.config.client !== 'sqlite3') throw new Error('Backups here are for the desktop (SQLite) edition.');
  try { fs.unlinkSync(dest); } catch {}
  await knex.raw('VACUUM INTO ?', [dest]);
}

function prune() {
  const all = listBackups();
  for (const [reason, keep] of Object.entries(KEEP)) {
    for (const b of all.filter(x => x.reason === reason).slice(keep)) {
      fs.rmSync(path.join(backupsDir(), b.name), { recursive: true, force: true });
    }
  }
}

async function createBackup(knex, { reason = 'daily' } = {}) {
  const name = `${stamp()}${reason === 'manual' ? '-manual' : ''}`;
  const dir = path.join(backupsDir(), name);
  fs.mkdirSync(dir, { recursive: true });
  await copyDatabase(knex, path.join(dir, 'nexus.db'));
  for (const f of SETTINGS_FILES) {
    const src = path.join(dataDir(), f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
  fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify({
    created_at: Math.floor(Date.now() / 1000), reason, app_version: require('../../package.json').version,
  }, null, 2));
  prune();
  return name;
}

function listBackups() {
  if (!fs.existsSync(backupsDir())) return [];
  return fs.readdirSync(backupsDir(), { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(backupsDir(), d.name, 'nexus.db')))
    .map(d => {
      const dir = path.join(backupsDir(), d.name);
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'backup.json'), 'utf8')); } catch {}
      return {
        name: d.name,
        created_at: meta.created_at || Math.floor(fs.statSync(dir).mtimeMs / 1000),
        reason: meta.reason || (d.name.startsWith('before-restore') ? 'before-restore' : 'daily'),
        size: fs.statSync(path.join(dir, 'nexus.db')).size,
      };
    })
    .sort((a, b) => b.created_at - a.created_at);
}

// ── Export file (.snbackup) ──────────────────────────────────────────────────
// Format: "SNBACKUP1\n", one JSON line { files: [{ name, size }], ... }, then the
// files' bytes one after another. Simple, streamable, and needs no zip library.

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

// In the exported copy, saved logins are stored decrypted (see the top note)
function unsealCopy(file) {
  const { SEALED_COLUMNS, open, isSealed } = require('../secrets');
  const Database = require('better-sqlite3');
  const db = new Database(file);
  try {
    for (const [table, { key, cols }] of Object.entries(SEALED_COLUMNS)) {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;
      const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
      for (const col of cols.filter(c => have.has(c))) {
        const rows = db.prepare(`SELECT ${key} AS k, ${col} AS v FROM ${table} WHERE ${col} LIKE 'enc:v1:%'`).all();
        const upd = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${key} = ?`);
        for (const r of rows) if (isSealed(r.v)) upd.run(open(r.v), r.k);
      }
    }
  } finally { db.close(); }
}

async function exportTo(knex, outFile, { passphrase } = {}) {
  checkPassphrase(passphrase);
  const plain = `${outFile}.plain`;
  try {
    const r = await exportPlain(knex, plain);
    await lockFile(plain, outFile, passphrase);
    return r;
  } finally { try { fs.unlinkSync(plain); } catch {} }
}

async function exportPlain(knex, outFile) {
  const tmpDb = path.join(dataDir(), `export-${process.pid}-${Date.now()}.db`);
  await copyDatabase(knex, tmpDb);
  try {
    unsealCopy(tmpDb);
    const entries = [{ name: 'nexus.db', src: tmpDb }];
    for (const f of SETTINGS_FILES) {
      const src = path.join(dataDir(), f);
      if (fs.existsSync(src)) entries.push({ name: f, src });
    }
    for (const rel of walk(path.join(dataDir(), 'media'))) entries.push({ name: `media/${rel}`, src: path.join(dataDir(), 'media', rel) });
    for (const e of entries) e.size = fs.statSync(e.src).size;

    const header = JSON.stringify({
      created_at: Math.floor(Date.now() / 1000), app_version: require('../../package.json').version,
      migrations: knownMigrations(), files: entries.map(({ name, size }) => ({ name, size })),
    });
    const out = fs.createWriteStream(outFile);
    out.write(MAGIC + header + '\n');
    for (const e of entries) await pipeline(fs.createReadStream(e.src), out, { end: false });
    await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
    return { files: entries.length };
  } finally {
    try { fs.unlinkSync(tmpDb); } catch {}
  }
}

// Safe target path inside dest (refuses ../ and absolute names)
function safeJoin(dest, name) {
  const target = path.resolve(dest, name);
  if (!target.startsWith(path.resolve(dest) + path.sep)) throw new Error(`Unsafe file name in backup: ${name}`);
  return target;
}

const ALLOWED = (name) => name === 'nexus.db' || SETTINGS_FILES.includes(name) || /^media\/\d+\/[\w-]+\.(jpg|png|gif|webp|mp4|mov)$/.test(name);
const knownMigrations = () => fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.js'));

// A backup from a newer Social-Nexus has database changes this version doesn't know
function checkMigrations(dbFile) {
  const Database = require('better-sqlite3');
  let names = [];
  const db = new Database(dbFile, { readonly: true });
  try {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knex_migrations'").get();
    if (has) names = db.prepare('SELECT name FROM knex_migrations').all().map(r => r.name);
  } finally { db.close(); }
  const known = new Set(knownMigrations());
  const unknown = names.filter(n => !known.has(n));
  if (unknown.length) throw new Error('This backup was made by a newer version of Social-Nexus. Update Social-Nexus first, then restore it.');
}

const readAt = (fd, pos, len) => { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.subarray(0, n); };

// Checks a .snbackup file and unpacks it, ready to be swapped in at the next start
async function stageFromExportFile(file, { passphrase } = {}) {
  if (isLocked(file)) {
    if (!passphrase) throw Object.assign(new Error('This backup file is protected. Enter its passphrase.'), { status: 400, code: 'NEEDS_PASSPHRASE' });
    const plain = `${file}.unlocked`;
    await unlockFile(file, plain, passphrase);
    try { return await stageFromExportFile(plain); } finally { try { fs.unlinkSync(plain); } catch {} }
  }
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  let header, start;
  try {
    const head = readAt(fd, 0, Math.min(size, 4 * 1024 * 1024));
    if (head.subarray(0, MAGIC.length).toString() !== MAGIC) throw new Error('That isn’t a Social-Nexus backup file (.snbackup).');
    const nl = head.indexOf(0x0a, MAGIC.length);
    if (nl < 0) throw new Error('The backup file is damaged.');
    try { header = JSON.parse(head.subarray(MAGIC.length, nl).toString('utf8')); } catch { throw new Error('The backup file is damaged.'); }
    start = nl + 1;
  } finally { fs.closeSync(fd); }

  const files = header.files || [];
  if (!files.some(f => f.name === 'nexus.db')) throw new Error('The backup file has no database in it.');
  if (start + files.reduce((n, f) => n + f.size, 0) !== size) throw new Error('The backup file is incomplete or damaged.');
  for (const f of files) if (!ALLOWED(f.name)) throw new Error(`Unexpected file in backup: ${f.name}`);

  const dest = pendingDir();
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  try {
    let pos = start;
    for (const f of files) {
      const target = safeJoin(dest, f.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (f.size === 0) fs.writeFileSync(target, '');
      else await pipeline(fs.createReadStream(file, { start: pos, end: pos + f.size - 1 }), fs.createWriteStream(target));
      pos += f.size;
    }
    const dfd = fs.openSync(path.join(dest, 'nexus.db'), 'r');
    let dbHead;
    try { dbHead = readAt(dfd, 0, 16).toString(); } finally { fs.closeSync(dfd); }
    if (dbHead !== 'SQLite format 3\u0000') throw new Error('The database in the backup is damaged.');
    checkMigrations(path.join(dest, 'nexus.db'));
  } catch (err) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw err;
  }
  fs.writeFileSync(path.join(dest, 'READY'), JSON.stringify({ from: 'export', created_at: header.created_at }));
  return { created_at: header.created_at, files: files.length };
}

// Same, from a file already in memory (small backups, tests)
async function stageFromExport(buffer, opts = {}) {
  const tmp = path.join(dataDir(), `restore-upload-${process.pid}-${Date.now()}.snbackup`);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(tmp, buffer);
  try { return await stageFromExportFile(tmp, opts); } finally { try { fs.unlinkSync(tmp); } catch {} }
}

// Restoring one of the daily backups (keeps the current media library)
function stageFromBackup(name) {
  const src = path.join(backupsDir(), path.basename(name));
  if (!fs.existsSync(path.join(src, 'nexus.db'))) throw new Error('That backup was not found.');
  checkMigrations(path.join(src, 'nexus.db'));
  const dest = pendingDir();
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['nexus.db', ...SETTINGS_FILES]) {
    if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
  fs.writeFileSync(path.join(dest, 'READY'), JSON.stringify({ from: name }));
}

function cancelPendingRestore() { fs.rmSync(pendingDir(), { recursive: true, force: true }); }
const hasPendingRestore = () => fs.existsSync(path.join(pendingDir(), 'READY'));

// At start-up, before .env is read and before the database opens. Throws when it
// can't finish, so the app stops with the reason instead of starting empty.
function applyPendingRestore() {
  const pend = pendingDir();
  if (!fs.existsSync(path.join(pend, 'READY'))) return false;
  const data = dataDir();
  const keep = path.join(backupsDir(), `before-restore-${stamp()}`);
  fs.mkdirSync(keep, { recursive: true });

  // 1. Keep what is being replaced (with the WAL, which holds recent changes)
  for (const f of ['nexus.db', 'nexus.db-wal', 'nexus.db-shm', ...SETTINGS_FILES]) {
    if (fs.existsSync(path.join(data, f))) fs.copyFileSync(path.join(data, f), path.join(keep, f));
  }
  fs.writeFileSync(path.join(keep, 'backup.json'), JSON.stringify({ created_at: Math.floor(Date.now() / 1000), reason: 'before-restore' }));

  // 2. Copy the backup next to the live files first; swap only when that worked
  const tmp = path.join(data, 'nexus.db.restoring');
  fs.copyFileSync(path.join(pend, 'nexus.db'), tmp);
  for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(path.join(data, `nexus.db${ext}`)); } catch {} }
  fs.renameSync(tmp, path.join(data, 'nexus.db'));
  for (const f of SETTINGS_FILES) {
    if (fs.existsSync(path.join(pend, f))) fs.copyFileSync(path.join(pend, f), path.join(data, f));
  }
  if (fs.existsSync(path.join(pend, 'media'))) {
    const media = path.join(data, 'media');
    if (fs.existsSync(media)) fs.renameSync(media, path.join(keep, 'media'));
    fs.cpSync(path.join(pend, 'media'), media, { recursive: true });
  }
  // 3. Sign-ins from before belong to the old data: everyone signs in again
  for (const f of ['sessions.db', 'sessions.db-wal', 'sessions.db-shm']) { try { fs.unlinkSync(path.join(data, f)); } catch {} }

  fs.rmSync(pend, { recursive: true, force: true });
  prune();
  console.log(`[Backup] Restored a backup. The previous data is kept in ${keep}`);
  return true;
}

// Daily: a backup when the newest is older than 20 hours (checked every hour)
let timer = null;
function start(knex) {
  const run = async () => {
    try {
      const newest = listBackups().find(b => b.reason === 'daily');
      if (!newest || Date.now() / 1000 - newest.created_at > 20 * 3600) {
        const name = await createBackup(knex);
        console.log(`[Backup] Daily backup saved: ${name}`);
      }
    } catch (err) { console.error('[Backup] Daily backup failed:', err.message); }
  };
  setTimeout(run, 2 * 60 * 1000);
  timer = setInterval(run, 3600 * 1000);
  timer.unref?.();
}

module.exports = {
  createBackup, listBackups, exportTo, stageFromExport, stageFromExportFile, stageFromBackup,
  applyPendingRestore, cancelPendingRestore, hasPendingRestore, start, backupsDir, MAGIC, MAGIC_LOCKED, exportPlain,
};
