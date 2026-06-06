const express = require('express');

module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router();
  const invites = require('../repos/invitationsRepo')(knex);

  router.post('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    try {
      const { email, role } = req.body;
      const knexInst = knex; // knex is in scope from the factory closure
      const workspace = await knexInst('workspaces').where({ id: req.workspaceId }).first();
      if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
      const inv = await invites.create({
        orgId: workspace.org_id,
        workspaceId: req.workspaceId,
        email,
        role,
        invitedBy: req.session.userId,
      });
      res.status(201).json(inv);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:token/accept', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Log in to accept' });
    const ok = await invites.accept(req.params.token, req.session.userId);
    res.status(ok ? 200 : 400).json({ ok });
  });
  return router;
};
