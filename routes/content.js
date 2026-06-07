const express = require('express');
const contentRepoFactory = require('../repos/contentRepo');
const { can } = require('../services/rbac');

const STATUSES = ['draft', 'in_review', 'approved', 'scheduled', 'published', 'failed'];
const EDITABLE_STATUSES = ['draft', 'in_review', 'failed'];
const DELETABLE_STATUSES = ['draft', 'failed'];

const TRANSITION_PERMISSIONS = {
  'draft->in_review': 'content.submit',
  'in_review->draft': 'content.approve',
  'in_review->approved': 'content.approve',
  'approved->draft': 'content.approve',
  'approved->scheduled': 'content.schedule',
  'scheduled->approved': 'content.schedule',
};

module.exports = (knex, requirePermission) => {
  const router = express.Router();
  const contentRepo = contentRepoFactory(knex);

  router.post('/', requirePermission('content.create'), async (req, res) => {
    const { title, body, platforms, image_url, social_account_ids } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    try {
      const id = await contentRepo.create(req.workspaceId, req.session.userId, { title, body, platforms, image_url, social_account_ids });
      const item = await contentRepo.getById(req.workspaceId, id);
      res.status(201).json(item);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/', requirePermission('content.view'), async (req, res) => {
    const { status, limit, offset } = req.query;
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    try {
      const items = await contentRepo.list(req.workspaceId, {
        status,
        limit: limit != null ? Number(limit) : undefined,
        offset: offset != null ? Number(offset) : undefined,
      });
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/calendar', requirePermission('content.view'), async (req, res) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query params (epoch seconds) are required' });
    }
    try {
      const items = await contentRepo.list(req.workspaceId, { from, to });
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:id', requirePermission('content.view'), async (req, res) => {
    try {
      const item = await contentRepo.getById(req.workspaceId, req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      const comments = await knex('content_item_comments')
        .where({ content_item_id: item.id, workspace_id: req.workspaceId })
        .orderBy('created_at', 'asc');
      res.json({ ...item, comments });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/:id', requirePermission('content.edit'), async (req, res) => {
    try {
      const item = await contentRepo.getById(req.workspaceId, req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      if (!EDITABLE_STATUSES.includes(item.status)) {
        return res.status(409).json({ error: 'Cannot edit content in its current status', status: item.status });
      }
      if (req.body.body !== undefined && !req.body.body.trim()) {
        return res.status(400).json({ error: 'body cannot be empty' });
      }
      const updated = await contentRepo.update(req.workspaceId, item.id, req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', requirePermission('content.edit'), async (req, res) => {
    try {
      const item = await contentRepo.getById(req.workspaceId, req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      if (!DELETABLE_STATUSES.includes(item.status)) {
        return res.status(409).json({ error: 'Cannot delete content in its current status', status: item.status });
      }
      await contentRepo.remove(req.workspaceId, item.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/:id/status', async (req, res) => {
    const { toStatus, scheduled_at } = req.body;
    if (!STATUSES.includes(toStatus)) {
      return res.status(400).json({ error: `toStatus must be one of: ${STATUSES.join(', ')}` });
    }
    try {
      const item = await contentRepo.getById(req.workspaceId, req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });

      const requiredPermission = TRANSITION_PERMISSIONS[`${item.status}->${toStatus}`];
      if (!requiredPermission) {
        return res.status(400).json({ error: 'Invalid transition', from: item.status, to: toStatus });
      }
      if (!can(req.role, requiredPermission)) {
        return res.status(403).json({ error: 'Forbidden', requiredPermission });
      }

      const fields = {};
      if (toStatus === 'scheduled') {
        const now = Math.floor(Date.now() / 1000);
        if (!scheduled_at || scheduled_at <= now) {
          return res.status(400).json({ error: 'scheduled_at must be a future epoch timestamp' });
        }
        fields.scheduled_at = scheduled_at;
      }

      const result = await contentRepo.transition(req.workspaceId, item.id, { toStatus, userId: req.session.userId, fields });
      if (!result.ok) {
        return res.status(400).json({ error: 'Invalid transition' });
      }
      res.json(result.item);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/comments', requirePermission('content.comment'), async (req, res) => {
    try {
      const item = await contentRepo.getById(req.workspaceId, req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });

      const body = (req.body.body || '').trim();
      if (!body) return res.status(400).json({ error: 'body is required' });

      const rows = await knex('content_item_comments').insert({
        content_item_id: item.id,
        workspace_id: req.workspaceId,
        user_id: req.session.userId,
        body,
      }).returning('id');
      const id = rows[0]?.id ?? rows[0];
      const comment = await knex('content_item_comments').where({ id }).first();
      res.status(201).json(comment);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
