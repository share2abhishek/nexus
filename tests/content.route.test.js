const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const { requirePermission } = require('../middleware/tenancy');

// Mirrors tests/social-accounts.route.test.js's makeApp, but mounts the plain
// `apiRoutes`-style factory at /api/content (no mergeParams, no withWorkspace
// inside the router — req.workspaceId/req.role/req.session are set up-front,
// exactly like the real app.use('/api/content', requireAuth, withWorkspace, ...)).
function makeApp(knex, wsId, role, userId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId, activeWorkspaceId: wsId };
    req.workspaceId = wsId;
    req.role = role;
    req.googleKey = null;
    next();
  });
  app.use('/api/content', require('../routes/content')(knex, requirePermission));
  return app;
}

async function makeWorkspace(knex, name, slug) {
  const orgRows = await knex('organizations').insert({ name: `${name} Org`, owner_user_id: 1 }).returning('id');
  const orgId = orgRows[0]?.id ?? orgRows[0];
  const wsRows = await knex('workspaces').insert({ org_id: orgId, name, slug }).returning('id');
  return wsRows[0]?.id ?? wsRows[0];
}

describe('content routes — create, list, detail, calendar', () => {
  let knex, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    workspaceId = await makeWorkspace(knex, 'Content WS', 'content-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  describe('POST /api/content', () => {
    test('creator can create a draft, response includes the new id and status', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).post('/api/content').send({ body: 'New draft', platforms: ['linkedin'] });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('draft');
      expect(res.body.submitted_by).toBe(1);
      expect(res.body.platforms).toEqual(['linkedin']);
    });

    test('reviewer cannot create (lacks content.create)', async () => {
      const app = makeApp(knex, workspaceId, 'reviewer');
      const res = await request(app).post('/api/content').send({ body: 'Nope', platforms: [] });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.create');
    });

    test('rejects an empty body', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).post('/api/content').send({ body: '   ', platforms: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/content', () => {
    test('analyst (view-only role) can list', async () => {
      const app = makeApp(knex, workspaceId, 'analyst');
      const res = await request(app).get('/api/content');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('?status= filters the list', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Filterable', platforms: [] });
      const id = created.body.id;

      const analystApp = makeApp(knex, workspaceId, 'analyst');
      const drafts = await request(analystApp).get('/api/content?status=draft');
      expect(drafts.body.some(i => i.id === id)).toBe(true);
      const published = await request(analystApp).get('/api/content?status=published');
      expect(published.body.some(i => i.id === id)).toBe(false);
    });
  });

  describe('GET /api/content/:id', () => {
    test('returns the item with its (empty) comments thread', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Detail me', platforms: ['twitter'] });
      const id = created.body.id;

      const res = await request(creatorApp).get(`/api/content/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.comments).toEqual([]);
    });

    test('returns 404 for an item in another workspace', async () => {
      const otherWsId = await makeWorkspace(knex, 'Other Detail WS', 'other-detail-ws');
      const otherApp = makeApp(knex, otherWsId, 'creator');
      const created = await request(otherApp).post('/api/content').send({ body: 'Theirs', platforms: [] });
      const id = created.body.id;

      const myApp = makeApp(knex, workspaceId, 'creator');
      const res = await request(myApp).get(`/api/content/${id}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/content/calendar', () => {
    test('returns items whose scheduled_at or created_at falls in [from, to]', async () => {
      const now = Math.floor(Date.now() / 1000);
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'On the calendar', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).get(`/api/content/calendar?from=${now - 60}&to=${now + 60}`);
      expect(res.status).toBe(200);
      expect(res.body.some(i => i.id === id)).toBe(true);
    });

    test('requires from and to query params', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).get('/api/content/calendar');
      expect(res.status).toBe(400);
    });
  });
});
