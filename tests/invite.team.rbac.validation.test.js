const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const { can, MATRIX, ROLES, ACTIONS } = require('../services/rbac');
const { makeWithWorkspace, requirePermission } = require('../middleware/tenancy');

describe('Full Validation: Invitations, Team Formation, and RBAC', () => {
  let knex;
  let membershipsRepo;
  let invitationsRepo;
  let withWorkspace;
  let app;

  let orgId;
  let workspaceId;
  let managerUser;
  let creatorUser;
  let targetUser;
  let superAdminUser;
  let outsiderUser;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();

    membershipsRepo = require('../repos/membershipsRepo')(knex);
    invitationsRepo = require('../repos/invitationsRepo')(knex);
    withWorkspace = makeWithWorkspace(membershipsRepo);

    // Seed Users
    const mRows = await knex('users').insert({
      email: 'manager@radixile.test',
      name: 'Manager User',
      password_hash: 'hash1',
      role: 'user',
    }).returning('id');
    const mId = mRows[0]?.id ?? mRows[0];
    managerUser = { id: mId, email: 'manager@radixile.test', role: 'user' };

    const cRows = await knex('users').insert({
      email: 'creator@radixile.test',
      name: 'Creator User',
      password_hash: 'hash2',
      role: 'user',
    }).returning('id');
    const cId = cRows[0]?.id ?? cRows[0];
    creatorUser = { id: cId, email: 'creator@radixile.test', role: 'user' };

    const tRows = await knex('users').insert({
      email: 'invited@radixile.test',
      name: 'Invited Target User',
      password_hash: 'hash3',
      role: 'user',
    }).returning('id');
    const tId = tRows[0]?.id ?? tRows[0];
    targetUser = { id: tId, email: 'invited@radixile.test', role: 'user' };

    const sRows = await knex('users').insert({
      email: 'share2abhishek@gmail.com',
      name: 'Abhishek SuperAdmin',
      password_hash: 'hash4',
      role: 'superadmin',
    }).returning('id');
    const sId = sRows[0]?.id ?? sRows[0];
    superAdminUser = { id: sId, email: 'share2abhishek@gmail.com', role: 'superadmin' };

    const oRows = await knex('users').insert({
      email: 'outsider@other.test',
      name: 'Outsider User',
      password_hash: 'hash5',
      role: 'user',
    }).returning('id');
    const oId = oRows[0]?.id ?? oRows[0];
    outsiderUser = { id: oId, email: 'outsider@other.test', role: 'user' };

    // Seed Org & Workspace
    const orgRows = await knex('organizations').insert({
      name: 'Acme Corp',
      owner_user_id: managerUser.id,
    }).returning('id');
    orgId = orgRows[0]?.id ?? orgRows[0];

    const wsRows = await knex('workspaces').insert({
      org_id: orgId,
      name: 'Acme Marketing',
      slug: 'acme-marketing',
    }).returning('id');
    workspaceId = wsRows[0]?.id ?? wsRows[0];

    // Seed Memberships: manager has 'manager', creator has 'creator'
    await membershipsRepo.add({ userId: managerUser.id, workspaceId, role: 'manager' });
    await membershipsRepo.add({ userId: creatorUser.id, workspaceId, role: 'creator' });

    // Setup Test Express App with real tenancy, invitations, and members routers
    app = express();
    app.use(express.json());

    // Middleware to simulate session from headers
    app.use((req, res, next) => {
      const uId = Number(req.headers['x-test-user-id']);
      const uEmail = req.headers['x-test-user-email'];
      const uRole = req.headers['x-test-user-role'];
      const ws = Number(req.headers['x-workspace-id']) || undefined;
      if (uId) {
        req.session = {
          userId: uId,
          userEmail: uEmail,
          userRole: uRole,
          activeWorkspaceId: ws,
        };
      }
      next();
    });

    app.use('/invitations', require('../routes/invitations')(knex, withWorkspace, requirePermission));
    app.use('/workspaces/:workspaceId/members', require('../routes/members')(knex, withWorkspace, requirePermission));

    // Active workspace session route
    app.post('/session/active-workspace', async (req, res) => {
      if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
      const wsId = Number(req.body.workspaceId);
      const user = await knex('users').where({ id: req.session.userId }).first();
      const isSuperAdmin = user?.role === 'superadmin' || String(user?.email || '').toLowerCase().trim() === 'share2abhishek@gmail.com';

      let role = wsId ? await membershipsRepo.roleFor(req.session.userId, wsId) : null;
      if (!role && isSuperAdmin && wsId) {
        const wsObj = await knex('workspaces').where({ id: wsId }).first();
        if (wsObj) role = 'manager';
      }
      if (!role) return res.status(403).json({ error: 'You are not a member of that workspace.' });
      req.session.activeWorkspaceId = wsId;
      res.json({ ok: true, role });
    });

    // Workspaces listing route
    app.get('/me/workspaces', async (req, res) => {
      if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
      const user = await knex('users').where({ id: req.session.userId }).first();
      const isSuperAdmin = user?.role === 'superadmin' || String(user?.email || '').toLowerCase().trim() === 'share2abhishek@gmail.com';
      if (isSuperAdmin) {
        const all = await knex('workspaces')
          .leftJoin('organizations', 'workspaces.org_id', 'organizations.id')
          .select('workspaces.id as workspace_id', 'workspaces.name', 'workspaces.slug', 'workspaces.org_id');
        return res.json(all.map(w => ({ ...w, role: 'manager', status: 'active' })));
      }
      res.json(await membershipsRepo.listForUser(req.session.userId));
    });
  });

  afterAll(async () => {
    await knex.destroy();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. RBAC Matrix Verification
  // ───────────────────────────────────────────────────────────────────────────
  describe('RBAC Matrix & Logic', () => {
    test('all 5 defined roles exist in ROLES', () => {
      expect(ROLES).toEqual(['manager', 'creator', 'reviewer', 'client', 'analyst']);
    });

    test('manager has full privileges including members.manage and content.publish', () => {
      const managerPerms = MATRIX.manager;
      expect(managerPerms).toContain('members.manage');
      expect(managerPerms).toContain('social.manage');
      expect(managerPerms).toContain('content.create');
      expect(managerPerms).toContain('content.publish');
      expect(managerPerms).toContain('content.approve');
      expect(can('manager', 'members.manage')).toBe(true);
      expect(can('manager', 'content.publish')).toBe(true);
    });

    test('creator can create, edit, submit, view but CANNOT publish, approve, or manage members', () => {
      expect(can('creator', 'content.create')).toBe(true);
      expect(can('creator', 'content.edit')).toBe(true);
      expect(can('creator', 'content.submit')).toBe(true);
      expect(can('creator', 'content.view')).toBe(true);
      expect(can('creator', 'analytics.view')).toBe(true);
      expect(can('creator', 'content.publish')).toBe(false);
      expect(can('creator', 'content.approve')).toBe(false);
      expect(can('creator', 'members.manage')).toBe(false);
      expect(can('creator', 'social.manage')).toBe(false);
    });

    test('reviewer and client can approve and comment but CANNOT edit, publish, or manage members', () => {
      for (const role of ['reviewer', 'client']) {
        expect(can(role, 'content.approve')).toBe(true);
        expect(can(role, 'content.comment')).toBe(true);
        expect(can(role, 'content.view')).toBe(true);
        expect(can(role, 'analytics.view')).toBe(true);
        expect(can(role, 'content.create')).toBe(false);
        expect(can(role, 'content.edit')).toBe(false);
        expect(can(role, 'content.publish')).toBe(false);
        expect(can(role, 'members.manage')).toBe(false);
      }
    });

    test('analyst is strictly read-only (view content & analytics)', () => {
      expect(can('analyst', 'content.view')).toBe(true);
      expect(can('analyst', 'analytics.view')).toBe(true);
      expect(can('analyst', 'content.create')).toBe(false);
      expect(can('analyst', 'content.edit')).toBe(false);
      expect(can('analyst', 'content.submit')).toBe(false);
      expect(can('analyst', 'content.approve')).toBe(false);
      expect(can('analyst', 'content.publish')).toBe(false);
      expect(can('analyst', 'members.manage')).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Invitation Flow & Security Controls
  // ───────────────────────────────────────────────────────────────────────────
  describe('Invitation Workflow', () => {
    let createdToken;

    test('non-manager (creator) cannot create invitations (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/invitations')
        .set('x-test-user-id', String(creatorUser.id))
        .set('x-test-user-email', creatorUser.email)
        .set('x-test-user-role', creatorUser.role)
        .set('x-workspace-id', String(workspaceId))
        .send({ email: 'newperson@example.com', role: 'reviewer' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
      expect(res.body.requiredPermission).toBe('members.manage');
    });

    test('manager can successfully create invitation with workspaceId in body or header', async () => {
      const res = await request(app)
        .post('/invitations')
        .set('x-test-user-id', String(managerUser.id))
        .set('x-test-user-email', managerUser.email)
        .set('x-test-user-role', managerUser.role)
        .send({ workspaceId, email: targetUser.email, role: 'reviewer' });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeTruthy();
      expect(res.body.token.length).toBe(48); // 24 bytes hex = 48 chars
      expect(res.body.email).toBe(targetUser.email);
      expect(res.body.role).toBe('reviewer');
      expect(res.body.invite_url).toContain(`/invite.html?token=${res.body.token}`);
      createdToken = res.body.token;
    });

    test('superadmin (share2abhishek@gmail.com) can create invitation without explicit membership', async () => {
      // superAdminUser has no row in memberships for workspaceId
      const explicitRole = await membershipsRepo.roleFor(superAdminUser.id, workspaceId);
      expect(explicitRole).toBeNull();

      const res = await request(app)
        .post('/invitations')
        .set('x-test-user-id', String(superAdminUser.id))
        .set('x-test-user-email', superAdminUser.email)
        .set('x-test-user-role', superAdminUser.role)
        .send({ workspaceId, email: 'external@client.com', role: 'client' });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeTruthy();
      expect(res.body.role).toBe('client');
    });

    test('wrong user cannot accept someone else\'s invitation', async () => {
      // outsiderUser tries to accept targetUser's invite token
      const res = await request(app)
        .post(`/invitations/${createdToken}/accept`)
        .set('x-test-user-id', String(outsiderUser.id))
        .set('x-test-user-email', outsiderUser.email)
        .set('x-test-user-role', outsiderUser.role)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('This invitation was sent to');
    });

    test('intended user can accept their invitation', async () => {
      const res = await request(app)
        .post(`/invitations/${createdToken}/accept`)
        .set('x-test-user-id', String(targetUser.id))
        .set('x-test-user-email', targetUser.email)
        .set('x-test-user-role', targetUser.role)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.role).toBe('reviewer');
      expect(res.body.workspace_name).toBe('Acme Marketing');

      // Verify DB membership was formed
      const roleInDb = await membershipsRepo.roleFor(targetUser.id, workspaceId);
      expect(roleInDb).toBe('reviewer');
    });

    test('re-accepting the same token fails (single-use token enforcement)', async () => {
      const res = await request(app)
        .post(`/invitations/${createdToken}/accept`)
        .set('x-test-user-id', String(targetUser.id))
        .set('x-test-user-email', targetUser.email)
        .set('x-test-user-role', targetUser.role)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/already been used or has expired/i);
    });

    test('expired invitation cannot be accepted', async () => {
      const expInv = await invitationsRepo.create({
        orgId,
        workspaceId,
        email: outsiderUser.email,
        role: 'analyst',
        invitedBy: managerUser.id,
        expiresInHours: -2, // expired in the past
      });

      const res = await request(app)
        .post(`/invitations/${expInv.token}/accept`)
        .set('x-test-user-id', String(outsiderUser.id))
        .set('x-test-user-email', outsiderUser.email)
        .set('x-test-user-role', outsiderUser.role)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/already been used or has expired/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Team Formation & Member Management
  // ───────────────────────────────────────────────────────────────────────────
  describe('Team Formation & Member Management', () => {
    test('manager can list workspace members', async () => {
      const res = await request(app)
        .get(`/workspaces/${workspaceId}/members`)
        .set('x-test-user-id', String(managerUser.id))
        .set('x-test-user-email', managerUser.email)
        .set('x-test-user-role', managerUser.role)
        .send();

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const memberEmails = res.body.map(m => m.email);
      expect(memberEmails).toContain(managerUser.email);
      expect(memberEmails).toContain(creatorUser.email);
      expect(memberEmails).toContain(targetUser.email);
    });

    test('manager can directly add or update a team member role', async () => {
      // Add outsiderUser directly as analyst
      const addRes = await request(app)
        .post(`/workspaces/${workspaceId}/members`)
        .set('x-test-user-id', String(managerUser.id))
        .set('x-test-user-email', managerUser.email)
        .set('x-test-user-role', managerUser.role)
        .send({ userId: outsiderUser.id, role: 'analyst' });

      expect(addRes.status).toBe(201);
      expect(addRes.body.ok).toBe(true);

      expect(await membershipsRepo.roleFor(outsiderUser.id, workspaceId)).toBe('analyst');

      // Update role to creator
      const updateRes = await request(app)
        .post(`/workspaces/${workspaceId}/members`)
        .set('x-test-user-id', String(managerUser.id))
        .set('x-test-user-email', managerUser.email)
        .set('x-test-user-role', managerUser.role)
        .send({ userId: outsiderUser.id, role: 'creator' });

      expect(updateRes.status).toBe(201);
      expect(await membershipsRepo.roleFor(outsiderUser.id, workspaceId)).toBe('creator');
    });

    test('manager can remove a member from the workspace team', async () => {
      const delRes = await request(app)
        .delete(`/workspaces/${workspaceId}/members/${outsiderUser.id}`)
        .set('x-test-user-id', String(managerUser.id))
        .set('x-test-user-email', managerUser.email)
        .set('x-test-user-role', managerUser.role)
        .send();

      expect(delRes.status).toBe(200);
      expect(delRes.body.ok).toBe(true);

      const roleAfter = await membershipsRepo.roleFor(outsiderUser.id, workspaceId);
      expect(roleAfter).toBeNull();
    });

    test('removed member gets 403 when attempting workspace operations', async () => {
      const res = await request(app)
        .get(`/workspaces/${workspaceId}/members`)
        .set('x-test-user-id', String(outsiderUser.id))
        .set('x-test-user-email', outsiderUser.email)
        .set('x-test-user-role', outsiderUser.role)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Not a member of this workspace');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Superadmin Workspace Switching & Full Access
  // ───────────────────────────────────────────────────────────────────────────
  describe('Superadmin Global Access and Workspace Switching', () => {
    test('superadmin can switch active workspace to any workspace on platform', async () => {
      const res = await request(app)
        .post('/session/active-workspace')
        .set('x-test-user-id', String(superAdminUser.id))
        .set('x-test-user-email', superAdminUser.email)
        .set('x-test-user-role', superAdminUser.role)
        .send({ workspaceId });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.role).toBe('manager');
    });

    test('non-superadmin cannot switch to a workspace they are not member of', async () => {
      const res = await request(app)
        .post('/session/active-workspace')
        .set('x-test-user-id', String(outsiderUser.id))
        .set('x-test-user-email', outsiderUser.email)
        .set('x-test-user-role', outsiderUser.role)
        .send({ workspaceId });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('You are not a member of that workspace');
    });

    test('superadmin gets all workspaces across organizations in /me/workspaces', async () => {
      const res = await request(app)
        .get('/me/workspaces')
        .set('x-test-user-id', String(superAdminUser.id))
        .set('x-test-user-email', superAdminUser.email)
        .set('x-test-user-role', superAdminUser.role)
        .send();

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(w => w.workspace_id === workspaceId);
      expect(found).toBeDefined();
      expect(found.role).toBe('manager');
    });
  });
});
