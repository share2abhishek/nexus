const express = require('express');
const { checkPlatforms } = require('../services/platforms/available');
const { cleanOptions } = require('../services/postOptions');
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

  // Bulk scheduling from a CSV or Excel file (raw upload, file name in X-File-Name).
  // ?dry_run=1 only checks the rows and shows what would happen.
  router.post('/bulk', requirePermission('content.create'), express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No file was sent.' });
      let name = String(req.get('X-File-Name') || '');
      try { name = decodeURIComponent(name); } catch {}
      const ws = await knex('workspaces').where({ id: req.workspaceId }).first();
      const timezone = ws?.timezone && ws.timezone !== 'UTC' ? ws.timezone : 'Asia/Kolkata';
      const assets = await knex('media_assets').where({ workspace_id: req.workspaceId }).select('id', 'original_name');
      const mediaByName = Object.fromEntries(assets.filter(a => a.original_name).map(a => [a.original_name.toLowerCase(), `media:${a.id}`]));
      const { parseSheet } = require('../services/bulkImport');
      const parsed = parseSheet(req.body, { name, timezone, mediaByName });

      // Scheduling straight away needs the right to schedule and approve; otherwise drafts
      const schedule = can(req.role, 'content.schedule') && can(req.role, 'content.approve');
      if (req.query.dry_run === '1') return res.json({ ...parsed, will: schedule ? 'schedule' : 'draft', timezone });
      if (!parsed.counts.ok) return res.status(400).json({ error: 'No rows could be imported. Fix the rows shown and try again.', ...parsed });
      if (schedule && await licenceBlock(req, res)) return;

      const now = Math.floor(Date.now() / 1000);
      const ok = parsed.rows.filter(r => r.ok);
      await knex.transaction(async (trx) => {
        for (const r of ok) {
          await trx('content_items').insert({
            workspace_id: req.workspaceId, body: r.post.body, platforms: JSON.stringify(r.post.platforms),
            image_url: r.post.image_url, options: r.post.options ? JSON.stringify(r.post.options) : null,
            social_account_ids: '[]', status: schedule ? 'scheduled' : 'draft', scheduled_at: r.post.scheduled_at,
            submitted_by: req.session.userId, approved_by: schedule ? req.session.userId : null, created_at: now, updated_at: now,
          });
        }
      });
      res.json({ imported: ok.length, skipped: parsed.counts.failed, status: schedule ? 'scheduled' : 'draft', rows: parsed.rows.filter(r => !r.ok) });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  // Bulk scheduling with custom interval and loop / repeat queue options
  router.post('/bulk-schedule', requirePermission('content.create'), async (req, res) => {
    try {
      const { posts, start_at, interval_hours = 24, platforms = ['facebook'], loop_count = 1, status = 'scheduled', auto_restart = false } = req.body || {};

      if (!Array.isArray(posts) || !posts.length) {
        return res.status(400).json({ error: 'Please provide at least one message to schedule.' });
      }

      const now = Math.floor(Date.now() / 1000);
      const startAtNum = Number(start_at);
      if (!Number.isFinite(startAtNum) || startAtNum < now - 300) {
        return res.status(400).json({ error: 'Start date/time must be in the future.' });
      }

      const loops = Math.min(Math.max(1, parseInt(loop_count, 10) || 1), 20);
      const intervalSec = Math.max(0.5, parseFloat(interval_hours) || 24) * 3600;
      const targetPlatforms = Array.isArray(platforms) && platforms.length ? platforms : ['facebook'];

      const canSchedule = can(req.role, 'content.schedule') && can(req.role, 'content.approve');
      const shouldSchedule = (status === 'scheduled') && canSchedule;

      if (shouldSchedule && await licenceBlock(req, res)) return;

      // Find social accounts for the workspace
      const targetAccountIds = [];
      for (const p of targetPlatforms) {
        const acc = await knex('social_accounts')
          .where({ workspace_id: req.workspaceId, platform: p })
          .orderByRaw('(CASE WHEN access_token IS NOT NULL AND auth_error IS NULL THEN 0 ELSE 1 END)')
          .orderBy('id', 'desc')
          .first();
        if (acc) targetAccountIds.push(acc.id);
      }

      const seriesId = require('crypto').randomUUID();
      const totalOccurrences = posts.length * loops;
      if (totalOccurrences > 1000) {
        return res.status(400).json({ error: `Cannot schedule more than 1000 posts at once (requested: ${totalOccurrences}). Please reduce loop count.` });
      }

      const rows = [];
      for (let i = 0; i < totalOccurrences; i++) {
        const itemIdx = i % posts.length;
        const cycle = Math.floor(i / posts.length) + 1;
        const p = posts[itemIdx];
        const postTime = startAtNum + Math.floor(i * intervalSec);

        let itemTitle = p.title || `Post #${itemIdx + 1}`;
        if (loops > 1) {
          itemTitle = `${itemTitle} (Cycle ${cycle}/${loops})`;
        }

        const opts = {
          ...(typeof p.options === 'object' && p.options !== null ? p.options : {}),
          cycle,
          total_cycles: loops,
          loop_restart: auto_restart,
        };

        rows.push({
          workspace_id: req.workspaceId,
          title: itemTitle,
          body: String(p.body || p.content || '').trim(),
          platforms: JSON.stringify(targetPlatforms),
          image_url: p.image_url || null,
          social_account_ids: JSON.stringify(targetAccountIds),
          options: JSON.stringify(opts),
          status: shouldSchedule ? 'scheduled' : 'draft',
          scheduled_at: postTime,
          submitted_by: req.session.userId,
          approved_by: shouldSchedule ? req.session.userId : null,
          series_id: seriesId,
          series_index: i + 1,
          series_total: totalOccurrences,
          series_every: loops > 1 ? `loop-${interval_hours}h` : 'bulk',
          created_at: now,
          updated_at: now,
        });
      }

      await knex.transaction(async (trx) => {
        for (let b = 0; b < rows.length; b += 50) {
          await trx('content_items').insert(rows.slice(b, b + 50));
        }
      });

      res.json({
        success: true,
        total_scheduled: rows.length,
        posts_count: posts.length,
        cycles: loops,
        status: shouldSchedule ? 'scheduled' : 'draft',
        first_at: new Date(rows[0].scheduled_at * 1000).toISOString(),
        last_at: new Date(rows[rows.length - 1].scheduled_at * 1000).toISOString(),
        series_id: seriesId,
      });
    } catch (err) {
      console.error('[BulkSchedule] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', requirePermission('content.create'), async (req, res) => {
    const { title, body, platforms, social_account_ids } = req.body;
    let image_url = req.body.image_url;
    let options;
    try { options = cleanOptions(req.body.options); } catch (err) { return res.status(400).json({ error: err.message }); }
    if (options?.media?.length) image_url = options.media[0]; // first picture, for older views
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    const unavailable = checkPlatforms(platforms);
    if (unavailable) return res.status(400).json({ error: unavailable });
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
      const id = await contentRepo.create(req.workspaceId, req.session.userId, { title, body, platforms, image_url, social_account_ids, scheduled_at, options });
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
      const first_comments = await require('../services/firstComment').forItem(knex, req.workspaceId, item.id);
      res.json({ ...item, comments, first_comments });
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
      const unavailable = checkPlatforms(req.body.platforms);
      if (unavailable) return res.status(400).json({ error: unavailable });
      // Opened for editing at version X, but someone saved it since: don't overwrite their change
      const expected = req.body.expected_updated_at;
      if (expected !== undefined && Number(expected) !== Number(item.updated_at)) {
        return res.status(409).json({ error: 'Someone changed this post since you opened it. Open it again from the Calendar to see the latest version.', code: 'STALE' });
      }
      const changes = { ...req.body };
      delete changes.expected_updated_at;
      if (changes.options !== undefined) {
        try { changes.options = cleanOptions(changes.options); } catch (err) { return res.status(400).json({ error: err.message }); }
        if (changes.options?.media?.length) changes.image_url = changes.options.media[0];
      }
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
      // Shared with a client by link? They would approve the old version: close the link
      const changedWhat = (changes.body !== undefined && changes.body !== item.body)
        || (changes.image_url !== undefined && (changes.image_url || null) !== (item.image_url || null))
        || (changes.options !== undefined && JSON.stringify(changes.options || null) !== JSON.stringify(item.options || null))
        || (Array.isArray(changes.platforms) && JSON.stringify(changes.platforms) !== JSON.stringify(item.platforms));
      if (changedWhat) await require('../services/approvals').postChanged(knex, req.workspaceId, item.id).catch(() => {});
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
        if (await require('../services/entitlements').blockPublishing(req, res, 'Scheduling')) return;
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
  // Desktop: the licence; server edition: this business's trial or plan
  function licenceBlock(req, res) {
    return require('../services/entitlements').blockPublishing(req, res, 'Publishing and scheduling', 'Your post is saved as a draft.');
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
      if (await licenceBlock(req, res)) return;
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
      if (await licenceBlock(req, res)) return;

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
          options: item.options ? JSON.stringify(item.options) : null,
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

  // Client approval by link (or WhatsApp): needs the right to send for review
  router.post('/:id/approval-link', requirePermission('content.submit'), async (req, res) => {
    try {
      const r = await require('../services/approvals').share(knex, { workspaceId: req.workspaceId, userId: req.session.userId, itemId: Number(req.params.id) });
      const text = `Please review this post before it goes out: ${r.url}`;
      res.json({ ...r, whatsapp_url: `https://wa.me/?text=${encodeURIComponent(text)}` });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // One link for several posts (e.g. the month's plan): the client answers each
  router.post('/approval-set', requirePermission('content.submit'), async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.item_ids) ? req.body.item_ids : [];
      const r = await require('../services/approvals').share(knex, { workspaceId: req.workspaceId, userId: req.session.userId, itemIds: ids });
      const text = `Please review these ${r.count} posts before they go out: ${r.url}`;
      res.json({ ...r, whatsapp_url: `https://wa.me/?text=${encodeURIComponent(text)}` });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.get('/:id/approval-links', requirePermission('content.view'), async (req, res) => {
    try {
      const rows = await knex('approval_links').where({ workspace_id: req.workspaceId, content_item_id: Number(req.params.id) }).orderBy('id', 'desc').limit(10);
      res.json(rows.map(l => ({ id: l.id, status: l.status, url: l.status === 'open' ? l.url : null, created_at: l.created_at, expires_at: l.expires_at, response_name: l.response_name, response_comment: l.response_comment, responded_at: l.responded_at, set_size: l.set_size })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/approval-links/:linkId', requirePermission('content.submit'), async (req, res) => {
    try {
      const link = await knex('approval_links').where({ id: Number(req.params.linkId), workspace_id: req.workspaceId }).first();
      if (!link) return res.status(404).json({ error: 'Not found' });
      await require('../services/approvals').withdraw(knex, link);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
