// Link-in-bio page: edit here, publish to Radixile's server (a public page with
// your links, for the "link in bio" on Instagram and others).
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const store = require('../services/mediaStore');

module.exports = (knex, requirePermission) => {
  const router = express.Router();
  const base = () => require('../services/license').serverUrl();
  const proof = () => {
    const p = require('../services/license').licenseProof();
    if (!p) throw Object.assign(new Error('Publishing the page needs an active licence (Settings → Licence).'), { status: 402 });
    return { 'X-SN-License': p };
  };
  const now = () => Math.floor(Date.now() / 1000);

  router.get('/', requirePermission('content.view'), async (req, res) => {
    try {
      const row = await knex('bio_pages').where({ workspace_id: req.workspaceId }).first();
      res.json(row ? { slug: row.slug, url: row.url, published_at: row.published_at, ...JSON.parse(row.data || '{}') } : null);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Save and publish
  router.put('/', requirePermission('content.publish'), express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const b = req.body || {};
      const slug = String(b.slug || '').trim().toLowerCase();
      const data = {
        title: String(b.title || '').slice(0, 80), bio: String(b.bio || '').slice(0, 300),
        color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#7c3aed',
        avatar_ref: /^media:\d+$/.test(b.avatar_ref || '') ? b.avatar_ref : null,
        links: (Array.isArray(b.links) ? b.links : []).slice(0, 20).map(l => ({ label: String(l?.label || '').slice(0, 80), url: String(l?.url || '').slice(0, 1000) })),
      };
      const other = await knex('bio_pages').where({ slug }).whereNot({ workspace_id: req.workspaceId }).first();
      if (other) return res.status(409).json({ error: 'Another workspace on this PC already uses that page name. Choose another.' });
      // The picture goes inside the page (no link back to this PC)
      let avatar = null;
      if (data.avatar_ref) {
        const asset = await store.get(knex, req.workspaceId, store.mediaId(data.avatar_ref));
        if (asset && asset.kind === 'image' && asset.size < 280 * 1024 && /image\/(png|jpeg|webp)/.test(asset.mime)) {
          avatar = `data:${asset.mime};base64,${fs.readFileSync(store.filePath(asset)).toString('base64')}`;
        } else if (asset) {
          return res.status(400).json({ error: 'Use a small picture for the page (JPG or PNG under 280 KB).' });
        }
      }
      const r = await axios.put(`${base()}/v1/bio/${encodeURIComponent(slug)}`, { ...data, avatar }, { headers: proof(), timeout: 20000 })
        .catch((err) => { throw Object.assign(new Error(err.response?.data?.error || 'Couldn’t reach Radixile’s service. Check the internet and try again.'), { status: err.response?.status || 502 }); });
      // A new name: remove the old page
      const old = await knex('bio_pages').where({ workspace_id: req.workspaceId }).first();
      if (old?.slug && old.slug !== slug) await axios.delete(`${base()}/v1/bio/${encodeURIComponent(old.slug)}`, { headers: proof(), timeout: 15000 }).catch(() => {});
      await knex('bio_pages').insert({ workspace_id: req.workspaceId, slug, data: JSON.stringify(data), url: r.data.url, published_at: now(), updated_at: now() })
        .onConflict('workspace_id').merge();
      res.json({ success: true, url: r.data.url });
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });

  router.delete('/', requirePermission('content.publish'), async (req, res) => {
    try {
      const row = await knex('bio_pages').where({ workspace_id: req.workspaceId }).first();
      if (row?.slug) await axios.delete(`${base()}/v1/bio/${encodeURIComponent(row.slug)}`, { headers: proof(), timeout: 15000 }).catch(() => {});
      await knex('bio_pages').where({ workspace_id: req.workspaceId }).del();
      res.json({ success: true });
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });

  router.get('/stats', requirePermission('content.view'), async (req, res) => {
    try {
      const row = await knex('bio_pages').where({ workspace_id: req.workspaceId }).first();
      if (!row?.slug) return res.json({ views: 0, clicks: {} });
      const r = await axios.get(`${base()}/v1/bio/${encodeURIComponent(row.slug)}/stats`, { headers: proof(), timeout: 15000 });
      res.json(r.data);
    } catch { res.json({ views: null, clicks: {} }); }
  });

  return router;
};
