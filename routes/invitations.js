const express = require('express');

module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router();
  const invites = require('../repos/invitationsRepo')(knex);

  router.post('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    const { email, role } = req.body;
    const inv = await invites.create({
      orgId: req.body.orgId, workspaceId: req.workspaceId, email, role, invitedBy: req.session.userId,
    });
    res.status(201).json(inv); // caller emails the link /invite/<token>
  });

  router.post('/:token/accept', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Log in to accept' });
    const ok = await invites.accept(req.params.token, req.session.userId);
    res.status(ok ? 200 : 400).json({ ok });
  });
  return router;
};
