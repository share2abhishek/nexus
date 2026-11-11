const express = require('express');

module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router({ mergeParams: true });
  const socialAccountsRepo = require('../repos/socialAccountsRepo')(knex);

  // GET / — list all social accounts for the active workspace (secrets stripped)
  router.get('/', withWorkspace, async (req, res, next) => {
    try {
      const rows = await socialAccountsRepo.list(req.workspaceId);
      const safe = rows.map(row => {
        // Parse profile_json if not already done by repo
        let profile = row.profile || null;
        if (!profile && row.profile_json) {
          try { profile = JSON.parse(row.profile_json); } catch {}
        }
        const { access_token, refresh_token, page_token, profile_json, ...rest } = row;
        return { ...rest, profile };
      });
      res.json(safe);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /:id — remove a social account by id (requires social.manage permission)
  router.delete('/:id', withWorkspace, requirePermission('social.manage'), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const deleted = await socialAccountsRepo.remove(req.workspaceId, id);
      if (!deleted) return res.status(404).json({ error: 'Account not found' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
