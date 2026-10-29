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
  'failed->scheduled': 'content.schedule', // Retry
  // Skip review: only for someone who could approve it anyway
  'draft->scheduled': ['content.approve', 'content.schedule'],
};

module.exports = (knex, requirePermission) => {
  const router = express.Router();
  const contentRepo = contentRepoFactory(knex);

  router.post('/', requirePermission('content.create'), async (req, res) => {
    const { title, body, platforms, image_url, social_account_ids } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    // Optional suggested time (e.g. sent for review from Create Post). It is only a
    // suggestion: nothing is published until someone schedules the post.
    let scheduled_at = null;
    if (req.body.scheduled_at != null && req.body.scheduled_at !== '') {
      scheduled_at = Number(req.body.scheduled_at);
      if (!Number.isFinite(scheduled_at) || scheduled_at <= Math.floor(Date.now() / 1000)) {
        return res.status(400).json({ error: 'The suggested time must be in the future.' });
      }
    }
    try {
      const id = await contentRepo.create(req.workspaceId, req.session.userId, { title, body, platforms, image_url, social_account_ids, scheduled_at });
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
      // Opened for editing at version X, but someone saved it since: don't overwrite their change
      const expected = req.body.expected_updated_at;
      if (expected !== undefined && Number(expected) !== Number(item.updated_at)) {
        return res.status(409).json({ error: 'Someone changed this post since you opened it. Open it again from the Calendar to see the latest version.', code: 'STALE' });
      }
      const changes = { ...req.body };
      delete changes.expected_updated_at;
      // Platforms changed but no accounts given: drop chosen accounts on platforms
      // that were removed, so the post can't still go out there
      if (Array.isArray(changes.platforms) && changes.social_account_ids === undefined
          && Array.isArray(item.social_account_ids) && item.social_account_ids.length) {
        const kept = await knex('social_accounts')
          .where({ workspace_id: req.workspaceId })
          .whereIn('id', item.social_account_ids)
          .whereIn('platform', changes.platforms)
          .pluck('id');
        if (kept.length !== item.social_account_ids.length) changes.social_account_ids = kept;
      }
      let updated = await contentRepo.update(req.workspaceId, item.id, changes);
      // An edited post in a repeating series becomes a post of its own
      if (item.series_id) {
        await knex('content_items').where({ id: item.id, workspace_id: req.workspaceId })
          .update({ series_id: null, series_index: null, series_total: null, series_every: null });
        updated = await contentRepo.getById(req.workspaceId, item.id);
      }
      // Tell the reviewer the text changed after it was sent for review
      if (item.status === 'in_review' && changes.body !== undefined && changes.body !== item.body) {
        await knex('content_item_comments').insert({
          content_item_id: item.id, workspace_id: req.workspaceId, user_id: req.session.userId,
          body: '✏️ Edited the post after sending it for review.',
        });
      }
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
      const needed = [].concat(requiredPermission);
      if (!needed.every(p => can(req.role, p))) {
        return res.status(403).json({ error: "You don't have permission to do that in this workspace.", requiredPermission });
      }

      // Scheduling/publishing needs an active licence (drafting and review don't)
      if (['scheduled', 'published'].includes(toStatus)) {
        const lic = require('../services/license').status();
        if (!lic.can_publish) {
          return res.status(402).json({ error: 'Scheduling needs an active licence. Go to Settings → Licence to activate.', code: 'LICENSE_REQUIRED', license_state: lic.state });
        }
      }

      const fields = {};
      if (toStatus === 'scheduled') {
        const now = Math.floor(Date.now() / 1000);
        const scheduledAtNum = Number(scheduled_at);
        if (!scheduled_at || !Number.isFinite(scheduledAtNum) || scheduledAtNum <= now) {
          return res.status(400).json({ error: 'scheduled_at must be a future epoch timestamp' });
        }
        fields.scheduled_at = scheduledAtNum;
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

  // ── Create Post, step 2: what to do with a saved post ─────────────────────
  // Publishing and scheduling need an active licence; review and drafts don't.
  function licenceBlock(res) {
    const lic = require('../services/license').status();
    if (lic.can_publish) return false;
    res.status(402).json({ error: 'Publishing and scheduling need an active licence. Go to Settings → Licence to activate. Your post is saved as a draft.', code: 'LICENSE_REQUIRED', license_state: lic.state });
    return true;
  }
  // Publishing or scheduling a draft skips review, so only someone who could approve it may
  const mayDecide = (role, item) => item.status === 'approved' || can(role, 'content.approve');

  // Publish now
  router.post('/:id/publish', requirePermission('content.publish'), async (req, res) => {
    try {
      const item = await contentRepo.getById(req.workspaceId, req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      if (!['draft', 'approved', 'failed'].includes(item.status)) {
        return res.status(400).json({ error: `This post is ${item.status.replace('_', ' ')}, so it can't be published from here.` });
      }
      if (!mayDecide(req.role, item)) return res.status(403).json({ error: 'This post needs approval first. Send it for review.' });
      if (licenceBlock(res)) return;
      // Claim it so a double click (or the scheduler) can't post it twice
      const claimed = await knex('content_items')
        .where({ id: item.id, workspace_id: req.workspaceId }).whereIn('status', ['draft', 'approved', 'failed'])
        .update({ status: 'publishing', approved_by: req.session.userId, error_message: null, updated_at: Math.floor(Date.now() / 1000) });
      if (!claimed) return res.status(409).json({ error: 'This post is already being published.' });
      const { publishItem } = require('../services/scheduler');
      const { results, published } = await publishItem(knex, contentRepo, { ...item, status: 'publishing' });
      res.json({ published, results, item: await contentRepo.getById(req.workspaceId, item.id) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Schedule (once, or repeating every day/week/month)
  router.post('/:id/schedule', requirePermission('content.schedule'), async (req, res) => {
    try {
      const item = await contentRepo.getById(req.workspaceId, req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      if (!['draft', 'approved', 'failed'].includes(item.status)) {
        return res.status(400).json({ error: `This post is ${item.status.replace('_', ' ')}, so it can't be scheduled from here.` });
      }
      if (!mayDecide(req.role, item)) return res.status(403).json({ error: 'This post needs approval first. Send it for review.' });
      const at = Number(req.body?.scheduled_at);
      if (!Number.isFinite(at) || at <= Math.floor(Date.now() / 1000)) return res.status(400).json({ error: 'Pick a time in the future.' });
      if (licenceBlock(res)) return;

      const now = Math.floor(Date.now() / 1000);
      const repeat = req.body?.repeat;
      if (!repeat || !repeat.every || repeat.every === 'none') {
        await knex('content_items').where({ id: item.id, workspace_id: req.workspaceId })
          .update({ status: 'scheduled', scheduled_at: at, approved_by: req.session.userId, error_message: null, updated_at: now });
        return res.json({ count: 1, item: await contentRepo.getById(req.workspaceId, item.id) });
      }

      const { occurrences } = require('../services/recurrence');
      const r = occurrences(new Date(at * 1000), { every: repeat.every, count: repeat.until ? undefined : repeat.count, until: repeat.until });
      if (r.error) return res.status(400).json({ error: r.error });
      const seriesId = require('crypto').randomUUID();
      const series = { series_id: seriesId, series_total: r.dates.length, series_every: repeat.every };
      await knex.transaction(async (trx) => {
        // This post becomes the first of the series; the rest are copies
        await trx('content_items').where({ id: item.id, workspace_id: req.workspaceId }).update({
          status: 'scheduled', scheduled_at: Math.floor(r.dates[0].getTime() / 1000), approved_by: req.session.userId,
          error_message: null, updated_at: now, ...series, series_index: 1,
        });
        const copies = r.dates.slice(1).map((d, i) => ({
          workspace_id: req.workspaceId, title: item.title || null, body: item.body,
          platforms: JSON.stringify(item.platforms || []), image_url: item.image_url || null,
          social_account_ids: JSON.stringify(item.social_account_ids || []),
          status: 'scheduled', scheduled_at: Math.floor(d.getTime() / 1000),
          submitted_by: item.submitted_by, approved_by: req.session.userId, ...series, series_index: i + 2,
        }));
        for (let i = 0; i < copies.length; i += 100) await trx('content_items').insert(copies.slice(i, i + 100));
      });
      res.json({
        count: r.dates.length, series_id: seriesId, every: repeat.every,
        first_at: r.dates[0].toISOString(), last_at: r.dates[r.dates.length - 1].toISOString(),
      });
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
