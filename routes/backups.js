// Backups: list, back up now, export one file, restore (admin only).
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const backup = require('../services/backup');

module.exports = (knex) => {
  const router = express.Router();

  router.use(async (req, res, next) => {
    const user = await knex('users').where({ id: req.session?.userId }).first();
    if (user?.role !== 'admin') return res.status(403).json({ error: 'Only the admin of this installation can manage backups.', code: 'ADMIN_ONLY' });
    next();
  });

  router.get('/', (req, res) => {
    res.json({
      backups: backup.listBackups(), folder: backup.backupsDir(), restore_pending: backup.hasPendingRestore(),
      can_restart: process.env.ELECTRON === 'true',
    });
  });

  router.post('/', async (req, res) => {
    try { res.json({ name: await backup.createBackup(knex, { reason: 'manual' }) }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // The file is encrypted with the passphrase sent here (not in the address)
  router.post('/export', express.json({ limit: '4kb' }), async (req, res) => {
    const tmp = path.join(os.tmpdir(), `social-nexus-${Date.now()}.snbackup`);
    try {
      await backup.exportTo(knex, tmp, { passphrase: req.body?.passphrase });
      const day = new Date().toISOString().slice(0, 10);
      res.download(tmp, `Social-Nexus-backup-${day}.snbackup`, () => fs.unlink(tmp, () => {}));
    } catch (err) {
      fs.unlink(tmp, () => {});
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Upload a .snbackup (streamed to a temporary file); swapped in at the next start
  router.post('/restore', async (req, res) => {
    const tmp = path.join(os.tmpdir(), `social-nexus-restore-${Date.now()}.snbackup`);
    try {
      await pipeline(req, fs.createWriteStream(tmp));
      if (!fs.statSync(tmp).size) return res.status(400).json({ error: 'No file was sent.' });
      let passphrase = req.get('X-Backup-Passphrase') || '';
      try { passphrase = decodeURIComponent(passphrase); } catch {}
      const info = await backup.stageFromExportFile(tmp, { passphrase });
      res.json({ success: true, ...info, message: 'Backup checked. Restart Social-Nexus to finish restoring.' });
    } catch (err) {
      res.status(400).json({ error: err.message, code: err.code });
    } finally {
      fs.unlink(tmp, () => {});
    }
  });

  router.post('/:name/restore', (req, res) => {
    try {
      backup.stageFromBackup(req.params.name);
      res.json({ success: true, message: 'Restart Social-Nexus to finish restoring.' });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/restore', (req, res) => { backup.cancelPendingRestore(); res.json({ success: true }); });

  // Desktop app: restart now to finish a restore (Electron relaunches on code 75)
  router.post('/restart', (req, res) => {
    if (process.env.ELECTRON !== 'true') return res.status(400).json({ error: 'Close Social-Nexus and start it again.' });
    res.json({ success: true });
    setTimeout(() => process.exit(75), 300);
  });

  return router;
};
