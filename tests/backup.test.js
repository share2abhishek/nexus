// Daily backups, export to one file, and restore at the next start
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-backup-'));
process.env.NEXUS_DATA_DIR = DIR;
const knexLib = require('knex');
const backup = require('../services/backup');

const openDb = () => knexLib({
  client: 'sqlite3', useNullAsDefault: true, connection: { filename: path.join(DIR, 'nexus.db') },
});

let knex;
beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  knex = openDb();
  await knex.schema.createTable('notes', t => { t.increments('id'); t.string('text'); });
  await knex('notes').insert({ text: 'original' });
  fs.writeFileSync(path.join(DIR, '.env'), 'FACEBOOK_APP_ID=123\n');
  fs.mkdirSync(path.join(DIR, 'media', '1'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'media', '1', 'a1b2.png'), 'PNGDATA');
});
afterAll(async () => { console.log.mockRestore(); await knex?.destroy(); fs.rmSync(DIR, { recursive: true, force: true }); });

test('a backup copies the database and settings; the newest 7 daily ones are kept', async () => {
  const name = await backup.createBackup(knex, { reason: 'manual' });
  expect(fs.existsSync(path.join(DIR, 'backups', name, 'nexus.db'))).toBe(true);
  expect(fs.readFileSync(path.join(DIR, 'backups', name, '.env'), 'utf8')).toContain('FACEBOOK_APP_ID');
  for (let i = 0; i < 9; i++) {
    const d = path.join(DIR, 'backups', `2020-01-0${i}_000000`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'nexus.db'), '');
    fs.writeFileSync(path.join(d, 'backup.json'), JSON.stringify({ created_at: 1577836800 + i }));
  }
  await backup.createBackup(knex);
  const list = backup.listBackups();
  expect(list.filter(b => b.reason === 'daily').length).toBe(7);
  expect(list.map(b => b.name)).toContain(name); // the one made by hand is kept separately
});

test('export then restore brings back the database, settings and media', async () => {
  const file = path.join(DIR, 'out.snbackup');
  await backup.exportTo(knex, file, { passphrase: 'correct horse' });

  // Things change after the export…
  await knex('notes').update({ text: 'changed' });
  fs.writeFileSync(path.join(DIR, '.env'), 'FACEBOOK_APP_ID=999\n');
  fs.rmSync(path.join(DIR, 'media'), { recursive: true, force: true });

  await backup.stageFromExport(fs.readFileSync(file), { passphrase: 'correct horse' });
  expect(backup.hasPendingRestore()).toBe(true);

  // …the next start swaps the backup in (database closed first, like a real restart)
  await knex.destroy();
  expect(backup.applyPendingRestore()).toBe(true);
  knex = openDb();
  expect((await knex('notes').first()).text).toBe('original');
  expect(fs.readFileSync(path.join(DIR, '.env'), 'utf8')).toContain('=123');
  expect(fs.readFileSync(path.join(DIR, 'media', '1', 'a1b2.png'), 'utf8')).toBe('PNGDATA');
  expect(backup.hasPendingRestore()).toBe(false);
  // The replaced data was kept
  expect(backup.listBackups().some(b => b.name.startsWith('before-restore'))).toBe(true);
});

test('damaged or foreign files are refused', async () => {
  await expect(backup.stageFromExport(Buffer.from('PK zip file, not a backup'))).rejects.toThrow(/isn.t a Social-Nexus backup/);
  const evil = Buffer.concat([
    Buffer.from(backup.MAGIC + JSON.stringify({ files: [{ name: 'nexus.db', size: 1 }, { name: '../../evil.js', size: 1 }] }) + '\n'),
    Buffer.from('xy'),
  ]);
  await expect(backup.stageFromExport(evil)).rejects.toThrow(/Unexpected file/);
  const cut = Buffer.concat([Buffer.from(backup.MAGIC + JSON.stringify({ files: [{ name: 'nexus.db', size: 100 }] }) + '\n'), Buffer.from('short')]);
  await expect(backup.stageFromExport(cut)).rejects.toThrow(/incomplete/);
});

test('a backup from a newer version is refused', async () => {
  await knex.schema.createTable('knex_migrations', t => { t.increments('id'); t.string('name'); });
  await knex('knex_migrations').insert({ name: '20991231000001_from_the_future.js' });
  const file = path.join(DIR, 'future.snbackup');
  await backup.exportTo(knex, file, { passphrase: 'correct horse' });
  await expect(backup.stageFromExport(fs.readFileSync(file), { passphrase: 'correct horse' })).rejects.toThrow(/newer version/);
  expect(backup.hasPendingRestore()).toBe(false);
});

test('restore signs everyone out (old sign-ins belong to the old data)', async () => {
  await knex('knex_migrations').del();
  const file = path.join(DIR, 'again.snbackup');
  await backup.exportTo(knex, file, { passphrase: 'correct horse' });
  fs.writeFileSync(path.join(DIR, 'sessions.db'), 'x');
  await backup.stageFromExport(fs.readFileSync(file), { passphrase: 'correct horse' });
  await knex.destroy();
  backup.applyPendingRestore();
  knex = openDb();
  expect(fs.existsSync(path.join(DIR, 'sessions.db'))).toBe(false);
});

test('export files are locked with the passphrase', async () => {
  const file = path.join(DIR, 'locked.snbackup');
  await expect(backup.exportTo(knex, file, { passphrase: 'short' })).rejects.toThrow(/at least 8/);
  await backup.exportTo(knex, file, { passphrase: 'correct horse' });
  const bytes = fs.readFileSync(file);
  expect(bytes.slice(0, 10).toString()).toBe(backup.MAGIC_LOCKED);
  expect(bytes.includes(Buffer.from('FACEBOOK_APP_ID'))).toBe(false); // nothing readable inside
  await expect(backup.stageFromExport(bytes)).rejects.toThrow(/passphrase/);
  await expect(backup.stageFromExport(bytes, { passphrase: 'wrong horse' })).rejects.toThrow(/Wrong passphrase/);
  await backup.stageFromExport(bytes, { passphrase: 'correct horse' });
  expect(backup.hasPendingRestore()).toBe(true);
  backup.cancelPendingRestore();
});
