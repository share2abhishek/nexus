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
      // The invite is for one email address: only that account may use it
      const user = await knex('users').where({ id: req.session.userId }).first();
      if (!inv) return res.status(400).json({ ok: false, error: 'Invalid or expired invitation' });
      if (!inv.email || !user || inv.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
        return res.status(403).json({ ok: false, error: `This invitation was sent to ${inv.email || 'someone else'}. Sign in with that account to accept it.` });
      }
      const result = await invites.accept(req.params.token, req.session.userId);
      if (!result) return res.status(400).json({ ok: false, error: 'This invitation has already been used or has expired.' });
      const workspace = await knex('workspaces').where({ id: inv.workspace_id }).first();
      res.json({ ok: true, workspace_name: workspace?.name || null, role: result.role });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  return router;
};
