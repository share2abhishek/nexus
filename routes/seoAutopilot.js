// SEO autopilot (server edition): the website to watch, "check now", and the
// to-do list. Mounted at /api/seo/autopilot.
const express = require('express');
const edition = require('../services/edition');
const autopilot = require('../services/seoAutopilot');
const { normaliseUrl } = require('../services/seoCheck');
const { aiArgsFromReq } = require('../services/aiHelper');

const json = (v, fallback) => { if (!v) return fallback; try { return JSON.parse(v); } catch { return fallback; } };
const now = () => Math.floor(Date.now() / 1000);

function siteView(s) {
  if (!s) return null;
  return {
    url: s.url, phrases: json(s.phrases_json, []), frequency: s.frequency, max_pages: s.max_pages,
    gbp_quiet_days: s.gbp_quiet_days, enabled: !!s.enabled, last_status: s.last_status, last_error: s.last_error,
    last_run_at: s.last_run_at, next_run_at: s.next_run_at, vitals: json(s.vitals_json, null),
  };
}

function taskView(t) {
  return {
    id: t.id, kind: t.kind, priority: t.priority, title: t.title, detail: t.detail, status: t.status,
    pages: json(t.pages_json, []), draft: json(t.draft_json, null), content_item_id: t.content_item_id,
    created_at: t.created_at, updated_at: t.updated_at, closed_at: t.closed_at,
  };
}

module.exports = (knex, requirePermission) => {
  const router = express.Router();

  // Which features this install has (the screens hide server-only ones)
  router.get('/features', (req, res) => res.json(edition.features()));

  // Everything else: server edition only
  router.use((req, res, next) => (edition.isServer() ? next() : res.status(403).json({ error: edition.SERVER_ONLY_MESSAGE, code: 'SERVER_ONLY' })));

  router.get('/', requirePermission('content.view'), async (req, res) => {
    const site = await knex('seo_sites').where({ workspace_id: req.workspaceId }).first();
    const tasks = await knex('seo_tasks').where({ workspace_id: req.workspaceId })
      .where((q) => q.where('status', 'open').orWhere('closed_at', '>=', now() - 14 * 86400))
      .orderBy([{ column: 'priority' }, { column: 'updated_at', order: 'desc' }]);
    const pages = site ? await knex('seo_page_checks').where({ site_id: site.id, checked_at: site.last_run_at || 0 })
      .select('url', 'http_status', 'title', 'good', 'warn', 'bad', 'error') : [];
    res.json({ site: siteView(site), tasks: tasks.map(taskView), pages });
  });

  // A short summary for the Home page
  router.get('/summary', requirePermission('content.view'), async (req, res) => {
    const site = await knex('seo_sites').where({ workspace_id: req.workspaceId }).first();
    if (!site) return res.json({ site: null, open: 0, urgent: 0, top: [] });
    const open = await knex('seo_tasks').where({ workspace_id: req.workspaceId, status: 'open' }).orderBy('priority').limit(50);
    res.json({ site: siteView(site), open: open.length, urgent: open.filter((t) => t.priority === 1).length, top: open.slice(0, 3).map(taskView) });
  });

  router.put('/site', requirePermission('content.edit'), async (req, res) => {
    const b = req.body || {};
    let url;
    try { url = normaliseUrl(b.url); new URL(url); } catch { return res.status(400).json({ error: 'Type your website’s address, e.g. yourbusiness.com' }); }
    const phrases = (Array.isArray(b.phrases) ? b.phrases : String(b.phrases || '').split(/[\n,]+/))
      .map((p) => String(p).trim()).filter(Boolean).slice(0, 20);
    const row = {
      url,
      phrases_json: JSON.stringify(phrases),
      frequency: b.frequency === 'daily' ? 'daily' : 'weekly',
      max_pages: Math.min(50, Math.max(1, Number(b.max_pages) || 20)),
      gbp_quiet_days: [0, 7, 14, 30].includes(Number(b.gbp_quiet_days)) ? Number(b.gbp_quiet_days) : 7,
      enabled: b.enabled !== false,
      updated_at: now(),
    };
    const existing = await knex('seo_sites').where({ workspace_id: req.workspaceId }).first();
    if (existing) {
      // A new address starts fresh
      if (existing.url !== url) {
        await knex('seo_page_checks').where({ site_id: existing.id }).del();
        await knex('seo_tasks').where({ workspace_id: req.workspaceId }).whereIn('kind', ['fix', 'idea']).del();
        row.next_run_at = null;
      }
      await knex('seo_sites').where({ id: existing.id }).update(row);
    } else {
      await knex('seo_sites').insert({ ...row, workspace_id: req.workspaceId, created_at: now(), next_run_at: null });
    }
    res.json({ site: siteView(await knex('seo_sites').where({ workspace_id: req.workspaceId }).first()) });
  });

  // Check now (in the background; the screen asks again for the result)
  router.post('/run', requirePermission('content.edit'), async (req, res) => {
    const site = await knex('seo_sites').where({ workspace_id: req.workspaceId }).first();
    if (!site) return res.status(400).json({ error: 'Add your website first.' });
    // Already checking (unless that run was cut off, e.g. by a restart, over 2 hours ago)
    if (site.last_status === 'running' && site.updated_at > now() - 7200) return res.json({ started: false, running: true });
    autopilot.runSite(knex, site).catch((err) => console.error('[SEO autopilot]', err.message));
    res.json({ started: true });
  });

  router.post('/tasks/:id/:action', requirePermission('content.edit'), async (req, res) => {
    const task = await knex('seo_tasks').where({ id: Number(req.params.id), workspace_id: req.workspaceId }).first();
    if (!task) return res.status(404).json({ error: 'Not found' });
    const t = now();
    const action = req.params.action;
    if (action === 'done') await knex('seo_tasks').where({ id: task.id }).update({ status: 'done', closed_at: t, updated_at: t });
    else if (action === 'dismiss') await knex('seo_tasks').where({ id: task.id }).update({ status: 'dismissed', closed_at: t, updated_at: t });
    else if (action === 'reopen') await knex('seo_tasks').where({ id: task.id }).update({ status: 'open', closed_at: null, updated_at: t });
    else if (action === 'draft') {
      try {
        const draft = await autopilot.draftFor(knex, task, aiArgsFromReq(req));
        const keep = json(task.draft_json, {});
        await knex('seo_tasks').where({ id: task.id }).update({ draft_json: JSON.stringify({ ...keep, ...draft }), updated_at: t });
      } catch (err) {
        return res.status(502).json({ error: `Couldn’t write a suggestion: ${err.message}` });
      }
    } else return res.status(400).json({ error: 'Unknown action' });
    res.json(taskView(await knex('seo_tasks').where({ id: task.id }).first()));
  });

  return router;
};
