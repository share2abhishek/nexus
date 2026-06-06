const express = require('express');

module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router();
  const invites = require('../repos/invitationsRepo')(knex);

  router.post('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    try {
      const { email, role } = req.body;
      const workspace = await knex('workspaces').where({ id: req.workspaceId }).first();
      if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
      const inv = await invites.create({
        orgId: workspace.org_id,
        workspaceId: req.workspaceId,
        email,
        role,
        invitedBy: req.session.userId,
      });
      const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const invite_url = `${base}/invite.html?token=${inv.token}`;
      res.status(201).json({ ...inv, invite_url });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:token/accept', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Log in to accept' });
    try {
      const inv = await knex('invitations').where({ token: req.params.token }).first();
      const ok = await invites.accept(req.params.token, req.session.userId);
      if (!ok) return res.status(400).json({ ok: false, error: 'Invalid or expired invitation' });
      const workspace = inv ? await knex('workspaces').where({ id: inv.workspace_id }).first() : null;
      res.json({ ok: true, workspace_name: workspace?.name || null, role: inv?.role || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  return router;
};
