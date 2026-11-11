// Inbox: read and answer comments on published posts
const express = require('express');
const inbox = require('../services/inbox');

module.exports = (knex, requirePermission) => {
  const router = express.Router();

  router.get('/', requirePermission('content.view'), async (req, res) => {
    try {
      const q = knex('inbox_items as i').leftJoin('posts as p', 'p.id', 'i.post_id')
        .where('i.workspace_id', req.workspaceId).orderBy('i.created_at', 'desc').limit(200)
        .select('i.*', 'p.content as post_content');
      if (req.query.filter === 'unread') q.where('i.is_read', 0);
      if (req.query.filter === 'unanswered') q.whereNull('i.replied_at');
      const rows = await q;
      const unread = await knex('inbox_items').where({ workspace_id: req.workspaceId, is_read: 0 }).count('id as c').first();
      res.json({ items: rows.map(r => ({ ...r, post_content: (r.post_content || '').slice(0, 140) })), unread: Number(unread?.c || 0) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/unread-count', requirePermission('content.view'), async (req, res) => {
    try {
      const r = await knex('inbox_items').where({ workspace_id: req.workspaceId, is_read: 0 }).count('id as c').first();
      res.json({ unread: Number(r?.c || 0) });
    } catch { res.json({ unread: 0 }); }
  });

  router.post('/refresh', requirePermission('content.view'), async (req, res) => {
    try { res.json({ added: await inbox.refresh(knex, { workspaceId: req.workspaceId }) }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/read', requirePermission('content.view'), express.json(), async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
      const q = knex('inbox_items').where({ workspace_id: req.workspaceId });
      if (ids) q.whereIn('id', ids);
      await q.update({ is_read: 1 });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Replying speaks for the business in public: same right as publishing
  router.post('/:id/reply', requirePermission('content.publish'), express.json(), async (req, res) => {
    try { res.json(await inbox.reply(knex, req.workspaceId, req.session.userId, Number(req.params.id), req.body?.text)); }
    catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });

  // AI: a short, friendly reply in the brand's voice (the person edits before sending)
  router.post('/:id/suggest', requirePermission('content.view'), async (req, res) => {
    try {
      const item = await knex('inbox_items as i').leftJoin('posts as p', 'p.id', 'i.post_id')
        .where({ 'i.id': Number(req.params.id), 'i.workspace_id': req.workspaceId }).first('i.*', 'p.content as post_content');
      if (!item) return res.status(404).json({ error: 'Not found' });
      const { brandContext } = require('../services/brandContext');
      const { aiGenerate, aiArgsFromReq } = require('../services/aiHelper');
      const { apiKey, options, model } = aiArgsFromReq(req);
      const prompt = `${await brandContext(req.workspaceId)}

You answer comments for this business on ${item.platform}. Write ONE short, warm, helpful reply (1–2 sentences) to this comment.
Reply in the same language as the comment. Don't promise prices, offers or facts that aren't in the post. No hashtags.
Return only the reply text.

The post: """${String(item.post_content || '').slice(0, 800)}"""
The comment from ${item.author_name}: """${String(item.text || '').slice(0, 1000)}"""`;
      const r = await aiGenerate(prompt, apiKey, 200, model, options);
      res.json({ text: String(r.text || '').trim().replace(/^["“]|["”]$/g, ''), model: r.model });
    } catch (err) { res.status(502).json({ error: err.message }); }
  });

  return router;
};
