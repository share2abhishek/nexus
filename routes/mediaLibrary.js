// Media library: upload, list, view and delete a workspace's photos and videos.
// Uploads are the raw file in the request body (Content-Type: application/octet-stream),
// with the file name in the X-File-Name header.
const express = require('express');
const store = require('../services/mediaStore');

module.exports = (knex, requirePermission) => {
  const router = express.Router();
  const raw = express.raw({ type: () => true, limit: store.LIMITS.video });

  router.get('/', requirePermission('content.view'), async (req, res) => {
    try {
      const kind = ['image', 'video'].includes(req.query.kind) ? req.query.kind : null;
      const q = knex('media_assets').where({ workspace_id: req.workspaceId }).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(200);
      if (kind) q.where({ kind });
      const rows = await q.select('id', 'original_name', 'mime', 'kind', 'size', 'source', 'created_at', 'width', 'height');
      res.json(rows.map(r => ({ ...r, ref: `${store.MEDIA_PREFIX}${r.id}`, url: `/api/media-library/${r.id}/file` })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', requirePermission('content.create'), raw, async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No file was sent.' });
      let name = String(req.get('X-File-Name') || '');
      try { name = decodeURIComponent(name); } catch {}
      name = name.slice(0, 200) || null;
      const asset = await store.save(knex, req.workspaceId, req.session.userId, req.body, { name });
      res.status(201).json({ id: asset.id, ref: `${store.MEDIA_PREFIX}${asset.id}`, url: `/api/media-library/${asset.id}/file`, kind: asset.kind, mime: asset.mime, size: asset.size, original_name: asset.original_name, width: asset.width || null, height: asset.height || null });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Save an AI-generated picture (base64) or a picture from a web link into the library
  router.post('/import', requirePermission('content.create'), async (req, res) => {
    try {
      const { base64, url, name } = req.body || {};
      let buffer, source;
      if (base64) {
        buffer = Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64');
        source = 'ai';
      } else if (url) {
        buffer = (await store.download(url)).buffer;
        source = 'link';
      } else {
        return res.status(400).json({ error: 'Send base64 or url.' });
      }
      const asset = await store.save(knex, req.workspaceId, req.session.userId, buffer, { name, source });
      res.status(201).json({ id: asset.id, ref: `${store.MEDIA_PREFIX}${asset.id}`, url: `/api/media-library/${asset.id}/file`, kind: asset.kind });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  router.get('/:id/file', requirePermission('content.view'), async (req, res) => {
    const asset = await store.get(knex, req.workspaceId, Number(req.params.id));
    if (!asset) return res.status(404).json({ error: 'Not found' });
    res.set('Content-Type', asset.mime);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(store.filePath(asset), (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  router.delete('/:id', requirePermission('content.create'), async (req, res) => {
    try {
      const id = Number(req.params.id);
      // Still used by a post that hasn't gone out? Say so instead of breaking it.
      const ref = `${store.MEDIA_PREFIX}${id}`;
      const inUse = await knex('content_items').where({ workspace_id: req.workspaceId, image_url: ref })
        .whereNotIn('status', ['published']).count('id as c').first();
      if (await knex.schema.hasTable('scheduled_posts')) {
        const old = await knex('scheduled_posts').where({ workspace_id: req.workspaceId, image_url: ref, status: 'pending' }).count('id as c').first();
        inUse.c = Number(inUse?.c || 0) + Number(old?.c || 0);
      }
      if (Number(inUse?.c) && req.query.force !== '1') {
        return res.status(409).json({ error: `This file is used by ${inUse.c} post(s) that haven’t gone out yet.`, code: 'IN_USE', count: Number(inUse.c) });
      }
      const ok = await store.remove(knex, req.workspaceId, id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
