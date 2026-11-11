// Signatures, post sets and RSS feeds for Create post (per workspace).
const express = require('express');
const rss = require('../services/rss');
const { PUBLISHABLE } = require('../services/platforms/available');

const now = () => Math.floor(Date.now() / 1000);
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const json = (v, d) => { try { return JSON.parse(v); } catch { return d; } };
const cleanPlatforms = (list) => [...new Set((Array.isArray(list) ? list : []).map(String))].filter((p) => PUBLISHABLE.includes(p));

module.exports = (knex, requirePermission) => {
  const router = express.Router();
  const view = requirePermission('content.view');
  const edit = requirePermission('content.create');

  // ── Signatures ─────────────────────────────────────────────────────────────
  router.get('/signatures', view, async (req, res) => {
    res.json(await knex('post_signatures').where({ workspace_id: req.workspaceId }).orderBy('id'));
  });
  router.post('/signatures', edit, async (req, res) => {
    const name = str(req.body?.name, 80), text = str(req.body?.text, 1000);
    if (!name || !text) return res.status(400).json({ error: 'Give the signature a name and some text.' });
    const isDefault = !!req.body?.is_default;
    if (isDefault) await knex('post_signatures').where({ workspace_id: req.workspaceId }).update({ is_default: false });
    const [row] = await knex('post_signatures').insert({ workspace_id: req.workspaceId, name, text, is_default: isDefault, created_at: now() }).returning('id');
    res.json({ id: row?.id ?? row });
  });
  router.put('/signatures/:id', edit, async (req, res) => {
    const id = Number(req.params.id);
    const sig = await knex('post_signatures').where({ id, workspace_id: req.workspaceId }).first();
    if (!sig) return res.status(404).json({ error: 'Not found' });
    const patch = {};
    if (req.body?.name !== undefined) patch.name = str(req.body.name, 80) || sig.name;
    if (req.body?.text !== undefined) patch.text = str(req.body.text, 1000) || sig.text;
    if (req.body?.is_default !== undefined) {
      if (req.body.is_default) await knex('post_signatures').where({ workspace_id: req.workspaceId }).update({ is_default: false });
      patch.is_default = !!req.body.is_default;
    }
    await knex('post_signatures').where({ id }).update(patch);
    res.json({ success: true });
  });
  router.delete('/signatures/:id', edit, async (req, res) => {
    await knex('post_signatures').where({ id: Number(req.params.id), workspace_id: req.workspaceId }).del();
    res.json({ success: true });
  });

  // ── Post sets ──────────────────────────────────────────────────────────────
  router.get('/sets', view, async (req, res) => {
    const rows = await knex('post_sets').where({ workspace_id: req.workspaceId }).orderBy('id');
    res.json(rows.map((r) => ({ id: r.id, name: r.name, platforms: json(r.platforms_json, []), options: json(r.options_json, {}) })));
  });
  router.post('/sets', edit, async (req, res) => {
    const name = str(req.body?.name, 80);
    const platforms = cleanPlatforms(req.body?.platforms);
    if (!name || !platforms.length) return res.status(400).json({ error: 'Choose at least one platform and give the set a name.' });
    const options = {};
    if (['feed', 'reel', 'story'].includes(req.body?.options?.ig_format)) options.ig_format = req.body.options.ig_format;
    const [row] = await knex('post_sets').insert({ workspace_id: req.workspaceId, name, platforms_json: JSON.stringify(platforms), options_json: JSON.stringify(options), created_at: now() }).returning('id');
    res.json({ id: row?.id ?? row });
  });
  router.delete('/sets/:id', edit, async (req, res) => {
    await knex('post_sets').where({ id: Number(req.params.id), workspace_id: req.workspaceId }).del();
    res.json({ success: true });
  });

  // ── RSS feeds ──────────────────────────────────────────────────────────────
  const feedOut = (f) => ({
    id: f.id, url: f.url, name: f.name, platforms: json(f.platforms_json, []), mode: f.mode, add_signature: !!f.add_signature,
    enabled: !!f.enabled, last_checked_at: f.last_checked_at, last_error: f.last_error, posts_created: f.posts_created,
  });
  router.get('/feeds', view, async (req, res) => {
    res.json((await knex('rss_feeds').where({ workspace_id: req.workspaceId }).orderBy('id')).map(feedOut));
  });
  router.post('/feeds', edit, async (req, res) => {
    const url = str(req.body?.url, 1000);
    const platforms = cleanPlatforms(req.body?.platforms);
    if (!platforms.length) return res.status(400).json({ error: 'Choose where the posts should go.' });
    // Check it really is a feed before saving it
    let parsed;
    try { parsed = await rss.fetchFeed(url); } catch (err) {
      return res.status(400).json({ error: err.response?.status ? `The site answered with error ${err.response.status}.` : err.message });
    }
    const [row] = await knex('rss_feeds').insert({
      workspace_id: req.workspaceId, url, name: str(req.body?.name, 200) || parsed.title || null,
      platforms_json: JSON.stringify(platforms), mode: req.body?.mode === 'schedule' ? 'schedule' : 'draft',
      add_signature: req.body?.add_signature !== false, enabled: true, posts_created: 0,
      created_by: req.session?.userId || null, created_at: now(),
    }).returning('id');
    const id = row?.id ?? row;
    const feed = await knex('rss_feeds').where({ id }).first();
    await rss.checkFeed(knex, feed, { seedOnly: true }); // remember what's there now; only newer articles become posts
    res.json({ ...feedOut(await knex('rss_feeds').where({ id }).first()), latest: parsed.items.slice(0, 3).map((i) => i.title) });
  });
  router.put('/feeds/:id', edit, async (req, res) => {
    const f = await knex('rss_feeds').where({ id: Number(req.params.id), workspace_id: req.workspaceId }).first();
    if (!f) return res.status(404).json({ error: 'Not found' });
    const patch = {};
    if (req.body?.enabled !== undefined) patch.enabled = !!req.body.enabled;
    if (req.body?.mode !== undefined) patch.mode = req.body.mode === 'schedule' ? 'schedule' : 'draft';
    if (req.body?.add_signature !== undefined) patch.add_signature = !!req.body.add_signature;
    if (req.body?.platforms !== undefined) {
      const p = cleanPlatforms(req.body.platforms);
      if (!p.length) return res.status(400).json({ error: 'Choose where the posts should go.' });
      patch.platforms_json = JSON.stringify(p);
    }
    await knex('rss_feeds').where({ id: f.id }).update(patch);
    res.json(feedOut(await knex('rss_feeds').where({ id: f.id }).first()));
  });
  router.post('/feeds/:id/check', edit, async (req, res) => {
    const f = await knex('rss_feeds').where({ id: Number(req.params.id), workspace_id: req.workspaceId }).first();
    if (!f) return res.status(404).json({ error: 'Not found' });
    res.json(await rss.checkFeed(knex, f));
  });
  router.delete('/feeds/:id', edit, async (req, res) => {
    await knex('rss_feeds').where({ id: Number(req.params.id), workspace_id: req.workspaceId }).del();
    res.json({ success: true });
  });

  return router;
};
