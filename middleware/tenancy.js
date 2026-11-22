const platformAdmin = require('../services/platformAdmin');

// Factory takes a memberships repo so it's testable without a DB.
// options.loadUser: look the user up on every request (the server does), so a
// suspended or demoted account loses access at once instead of keeping a 7-day
// session. Without it (unit tests) the session's own fields are used.
// options.loadOrg: the workspace's organisation and platform status (services/accessHost.js workspaceOrg), read by
// access.check step 4. Without it the organisation is unknown and counts as active.
// This is where the access context is resolved (identity, workspace, role, org); modules/access decides from it.
function makeWithWorkspace(membershipsRepo, { loadUser, loadOrg } = {}) {
  return async function withWorkspace(req, res, next) {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    let isPlatform = req.session?.userRole === 'superadmin';
    if (loadUser) {
      const user = await loadUser(userId).catch(() => null);
      if (!user) { req.session?.destroy?.(() => {}); return res.status(401).json({ error: 'Not authenticated' }); }
      if (user.status === 'suspended') { req.session?.destroy?.(() => {}); return res.status(403).json({ error: 'Your account has been suspended. Contact the admin.' }); }
      req.currentUser = user;
      isPlatform = platformAdmin.isPlatformAdmin(user);
    }
    req.isPlatformAdmin = isPlatform;

    // The workspace comes from the header, the route or the session, never from the request body (S0):
    // a body is data, and choosing a workspace there made it easy to act on one by mistake.
    let workspaceId = Number(req.headers?.['x-workspace-id'])
      || Number(req.params?.workspaceId)
      || req.session?.activeWorkspaceId;

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
    let role = await membershipsRepo.roleFor(userId, workspaceId);
    if (!role) {
      // Radixile platform admins may step into any business, as a manager
      if (isPlatform) role = 'manager';
      else return res.status(403).json({ error: 'Not a member of this workspace' });
    }
    req.workspaceId = workspaceId;
    req.role = role;
    if (loadOrg) {
      const org = await loadOrg(workspaceId); // an error fails closed (500), like the membership lookup
      req.orgId = org?.orgId ?? null;
      req.orgStatus = org?.status || 'active';
    }
    next();
  };
}

// The permission guard is access.middleware (modules/access, A0). This name stays so existing callers and tests read
// the same; it is the same function, not a second implementation.
const requirePermission = (action) => require('../modules/access').middleware(action);

module.exports = { makeWithWorkspace, requirePermission };
