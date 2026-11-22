const express = require('express');
const { WORKSPACE_ROLE_KEYS: ROLES } = require('../modules/access/permissions');

module.exports = (knex, withWorkspace, permit) => {
  const router = express.Router({ mergeParams: true });
  const members = require('../repos/membershipsRepo')(knex);

  router.get('/', withWorkspace, permit('members.manage'), async (req, res) => {
    try {
      res.json(await members.listMembers(req.workspaceId));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.post('/', withWorkspace, permit('members.manage'), async (req, res) => {
    try {
      const { userId, role } = req.body;
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
      await members.add({ userId, workspaceId: req.workspaceId, role });
      res.status(201).json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.delete('/:userId', withWorkspace, permit('members.manage'), async (req, res) => {
    try {
      await members.remove(Number(req.params.userId), req.workspaceId);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  return router;
};
