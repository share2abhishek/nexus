const { can } = require('../services/rbac');

// Factory takes a memberships repo so it's testable without a DB.
function makeWithWorkspace(membershipsRepo) {
  return async function withWorkspace(req, res, next) {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    let workspaceId = req.session?.activeWorkspaceId
      ?? (Number(req.headers['x-workspace-id']) || Number(req.params.workspaceId));

    if (!workspaceId) {
      // Resolve to the caller's first workspace, ensuring one exists first
      const workspaceHelper = require('../services/workspaceHelper');
      await workspaceHelper.ensureDefaultWorkspace(userId);
      const workspaces = await membershipsRepo.listForUser(userId);
      if (workspaces.length > 0) {
        workspaceId = workspaces[0].workspace_id;
        if (req.session) {
          req.session.activeWorkspaceId = workspaceId;
        }
      }
    }

    if (!workspaceId) return res.status(400).json({ error: 'No active workspace' });
    const role = await membershipsRepo.roleFor(userId, workspaceId);
    if (!role) return res.status(403).json({ error: 'Not a member of this workspace' });
    req.workspaceId = workspaceId;
    req.role = role;
    next();
  };
}

function requirePermission(action) {
  return function (req, res, next) {
    if (!can(req.role, action)) {
      return res.status(403).json({ error: 'Forbidden', requiredPermission: action });
    }
    next();
  };
}

module.exports = { makeWithWorkspace, requirePermission };
