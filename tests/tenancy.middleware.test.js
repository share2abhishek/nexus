const { makeWithWorkspace, requirePermission } = require('../middleware/tenancy');

function mockRes() {
  return { code: null, body: null, status(c){ this.code=c; return this; }, json(b){ this.body=b; return this; } };
}

describe('tenancy middleware', () => {
  const memberships = { roleFor: async (u, w) => (u === 1 && w === 5 ? 'creator' : null) };
  const withWorkspace = makeWithWorkspace(memberships);

  test('attaches role for a member', async () => {
    const req = { session: { userId: 1, activeWorkspaceId: 5 } }; const res = mockRes();
    let called = false;
    await withWorkspace(req, res, () => { called = true; });
    expect(called).toBe(true);
    expect(req.workspaceId).toBe(5);
    expect(req.role).toBe('creator');
  });

  test('403 for non-member', async () => {
    const req = { session: { userId: 2, activeWorkspaceId: 5 } }; const res = mockRes();
    await withWorkspace(req, res, () => { throw new Error('should not call next'); });
    expect(res.code).toBe(403);
  });

  test('requirePermission gates by role', () => {
    const guard = requirePermission('content.publish');
    const res1 = mockRes();
    guard({ role: 'creator' }, res1, () => { throw new Error('no'); });
    expect(res1.code).toBe(403);
    let ok = false;
    guard({ role: 'manager' }, mockRes(), () => { ok = true; });
    expect(ok).toBe(true);
  });
});
