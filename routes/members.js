const express = require('express');
const { ROLES } = require('../services/rbac');

module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router({ mergeParams: true });
  const members = require('../repos/membershipsRepo')(knex);

  router.get('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    res.json(await members.listMembers(req.workspaceId));
  });
  router.post('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    const { userId, role } = req.body;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    await members.add({ userId, workspaceId: req.workspaceId, role });
    res.status(201).json({ ok: true });
  });
  router.delete('/:userId', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    await members.remove(Number(req.params.userId), req.workspaceId);
    res.json({ ok: true });
  });
  return router;
};
