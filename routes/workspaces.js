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
      res.json(await members.listForUser(req.session.userId));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/', async (req, res) => {
    try {
      const { orgId, name, slug } = req.body;
      if (!(await isOrgOwnerOrAdmin(req.session.userId, orgId))) {
        return res.status(403).json({ error: 'Forbidden' });
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

  return router;
};
