const express = require('express');

// Factory so tests can inject a knex; production passes the singleton.
module.exports = (knex) => {
  const router = express.Router();
  const ws = require('../repos/workspacesRepo')(knex);
  const members = require('../repos/membershipsRepo')(knex);

  async function isOrgOwnerOrAdmin(userId, orgId) {
    const row = await knex('org_members').where({ org_id: orgId, user_id: userId }).first();
    return row && (row.role === 'owner' || row.role === 'admin');
  }

  router.get('/', async (req, res) => {
    try {
      const workspaceHelper = require('../services/workspaceHelper');
      await workspaceHelper.ensureDefaultWorkspace(req.session.userId);

      const workspacesList = await members.listForUser(req.session.userId);
      const detailed = [];
      for (const w of workspacesList) {
        const memberCount = await knex('memberships')
          .where({ workspace_id: w.workspace_id })
          .count('id as c')
          .first()
          .then(r => r?.c || 0);

        const socialAccounts = await knex('social_accounts')
          .where({ workspace_id: w.workspace_id, status: 'active' })
          .select('id', 'platform', 'account_label');

        detailed.push({
          ...w,
          member_count: memberCount,
          social_accounts: socialAccounts
        });
      }
      res.json(detailed);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.get('/organizations', async (req, res) => {
    try {
      const workspaceHelper = require('../services/workspaceHelper');
      await workspaceHelper.ensureDefaultWorkspace(req.session.userId);

      const orgs = await knex('organizations as o')
        .join('org_members as m', 'm.org_id', 'o.id')
        .where('m.user_id', req.session.userId)
        .select('o.id', 'o.name', 'm.role');
      res.json(orgs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { orgId, name, slug } = req.body;
      if (!(await isOrgOwnerOrAdmin(req.session.userId, orgId))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      // Edition limit on brand/client workspaces
      const { withinLimit, limitMessage } = require('../middleware/license');
      // Counted for the whole installation: one licence covers this PC
      const [{ c }] = await knex('workspaces').count('id as c');
      if (!withinLimit('workspaces', parseInt(c, 10))) {
        return res.status(402).json({ error: limitMessage('workspaces'), code: 'LICENSE_LIMIT' });
      }
      const w = await ws.create({ orgId, name, slug });
      await members.add({ userId: req.session.userId, workspaceId: w.id, role: 'manager' });
      res.status(201).json(w);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const w = await ws.get(req.params.id);
      if (!w || !(await isOrgOwnerOrAdmin(req.session.userId, w.org_id))) return res.status(403).json({ error: 'Forbidden' });
      await ws.update(req.params.id, { name: req.body.name, timezone: req.body.timezone });
      res.json(await ws.get(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const w = await ws.get(req.params.id);
      if (!w || !(await isOrgOwnerOrAdmin(req.session.userId, w.org_id))) return res.status(403).json({ error: 'Forbidden' });
      await ws.remove(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
