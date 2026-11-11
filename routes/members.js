const express = require('express');
const { ROLES } = require('../services/rbac');

module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router({ mergeParams: true });
  const members = require('../repos/membershipsRepo')(knex);

  router.get('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    try {
      res.json(await members.listMembers(req.workspaceId));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.post('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    try {
      const { userId, role } = req.body;
      if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
      await members.add({ userId, workspaceId: req.workspaceId, role });
      res.status(201).json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.delete('/:userId', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    try {
      await members.remove(Number(req.params.userId), req.workspaceId);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  return router;
};
