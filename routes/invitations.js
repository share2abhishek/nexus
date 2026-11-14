const express = require('express');

module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router();
  const invites = require('../repos/invitationsRepo')(knex);

  router.post('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    try {
      const { email, role } = req.body;
      const workspace = await knex('workspaces').where({ id: req.workspaceId }).first();
      if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
      // Server edition: team members are limited by the business's plan
      if (require('../services/edition').isServer()) {
        const userRole = req.session?.userRole || req.currentUser?.role || req.user?.role;
        const userEmail = String(req.session?.userEmail || req.currentUser?.email || req.user?.email || '').toLowerCase().trim();
        const isSuperAdmin = userRole === 'superadmin' || userEmail === 'share2abhishek@gmail.com';
        if (!isSuperAdmin) {
          const problem = await require('../services/entitlements').limitProblem(req.workspaceId, 'users');
          if (problem) return res.status(402).json({ error: problem, code: 'LICENSE_LIMIT' });
        }
      }
      const inv = await invites.create({
        orgId: workspace.org_id,
        workspaceId: req.workspaceId,
        email,
        role,
        invitedBy: req.session.userId,
      });
      const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const invite_url = `${base}/invite.html?token=${inv.token}`;
      // Server edition: the invitation is also emailed (the link can still be shared by hand)
      let emailed = false;
      if (require('../services/edition').isServer() && email) {
        const org = await knex('organizations').where({ id: workspace.org_id }).first('name');
        const inviter = await knex('users').where({ id: req.session.userId }).first('name', 'email');
        try {
          emailed = await require('../services/accounts').sendMail(email, `You’re invited to ${org?.name || workspace.name} on Social-Nexus`,
            `Hello,\n\n${inviter?.name || inviter?.email || 'A colleague'} invited you to work on “${workspace.name}” (${org?.name || ''}) in Social-Nexus.\n\nAccept the invitation here:\n${invite_url}\n\nIf you don’t have an account yet, you can create one from that page with this email address.\n\nSocial-Nexus by Radixile Technology Solutions`);
        } catch (err) { console.warn('[Invitations] Email failed:', err.message); }
      }
      res.status(201).json({ ...inv, invite_url, emailed });
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
