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

describe('content routes — edit and delete', () => {
  let knex, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    workspaceId = await makeWorkspace(knex, 'Edit WS', 'edit-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  describe('PATCH /api/content/:id', () => {
    test('creator can edit their draft', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Editable', platforms: [] });
      const id = created.body.id;

      const res = await request(app).patch(`/api/content/${id}`).send({ body: 'Edited body' });
      expect(res.status).toBe(200);
      expect(res.body.body).toBe('Edited body');
    });

    test('editing a failed item resets it to draft and clears error_message', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Will fail', platforms: [] });
      const id = created.body.id;
      await knex('content_items').where({ id }).update({ status: 'failed', error_message: 'token expired' });

      const res = await request(app).patch(`/api/content/${id}`).send({ body: 'Retry with new copy' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('draft');
      expect(res.body.error_message).toBeNull();
    });

    test('returns 409 when editing an approved item directly', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Locked soon', platforms: [] });
      const id = created.body.id;
      await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'in_review' });
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });

      const res = await request(creatorApp).patch(`/api/content/${id}`).send({ body: 'Too late' });
      expect(res.status).toBe(409);
    });

    test('reviewer cannot edit (lacks content.edit)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Mine', platforms: [] });
      const id = created.body.id;

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer');
      const res = await request(reviewerApp).patch(`/api/content/${id}`).send({ body: 'Hijack' });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.edit');
    });

    test('returns 404 for an unknown id', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).patch('/api/content/999999').send({ body: 'Ghost' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/content/:id', () => {
    test('removes a draft', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Delete me', platforms: [] });
      const id = created.body.id;

      const res = await request(app).delete(`/api/content/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(await request(app).get(`/api/content/${id}`).then(r => r.status)).toBe(404);
    });

    test('removes a failed item', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Failed delete', platforms: [] });
      const id = created.body.id;
      await knex('content_items').where({ id }).update({ status: 'failed' });

      const res = await request(app).delete(`/api/content/${id}`);
      expect(res.status).toBe(200);
    });

    test('returns 409 for an in_review item', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Cannot delete', platforms: [] });
      const id = created.body.id;
      await request(app).patch(`/api/content/${id}/status`).send({ toStatus: 'in_review' });

      const res = await request(app).delete(`/api/content/${id}`);
      expect(res.status).toBe(409);
    });

    test('returns 404 for an unknown id', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).delete('/api/content/999999');
      expect(res.status).toBe(404);
    });
  });
});

describe('content routes — status transitions and comments', () => {
  let knex, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    workspaceId = await makeWorkspace(knex, 'Transition Routes WS', 'transition-routes-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  async function createAndSubmit(creatorApp) {
    const created = await request(creatorApp).post('/api/content').send({ body: 'Lifecycle item', platforms: [] });
    const id = created.body.id;
    await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'in_review' });
    return id;
  }

  describe('PATCH /api/content/:id/status', () => {
    test('creator can submit their draft for review (content.submit)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Submit me', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'in_review' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_review');
    });

    test('creator cannot approve (lacks content.approve)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);

      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.approve');
    });

    test('reviewer can approve in-review content and is recorded as approved_by', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      const res = await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(res.body.approved_by).toBe(9);
    });

    test('reviewer can reject in-review content back to draft', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      const res = await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'draft' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('draft');
    });

    test('manager can schedule approved content with a future scheduled_at', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });

      const managerApp = makeApp(knex, workspaceId, 'manager', 5);
      const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
      const res = await request(managerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'scheduled', scheduled_at: futureEpoch });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('scheduled');
      expect(res.body.scheduled_at).toBe(futureEpoch);
    });

    test('creator cannot schedule (lacks content.schedule)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });

      const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'scheduled', scheduled_at: futureEpoch });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.schedule');
    });

    test('rejects scheduling without a future scheduled_at', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });

      const managerApp = makeApp(knex, workspaceId, 'manager', 5);
      const res = await request(managerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'scheduled' });
      expect(res.status).toBe(400);
    });

    test('manager can cancel a schedule back to approved', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      const managerApp = makeApp(knex, workspaceId, 'manager', 5);
      const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
      await request(managerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'scheduled', scheduled_at: futureEpoch });

      const res = await request(managerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(res.body.scheduled_at).toBeNull();
    });

    test('rejects an invalid transition (draft -> approved) with 400', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Skip review', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid transition');
    });

    test('rejects an unknown status value with 400', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Bad status', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'bogus' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/content/:id/comments', () => {
    test('reviewer (has content.comment) can add a comment to any state', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Commentable', platforms: [] });
      const id = created.body.id;

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      const res = await request(reviewerApp).post(`/api/content/${id}/comments`).send({ body: 'Looks good, minor tweak needed' });
      expect(res.status).toBe(201);
      expect(res.body.body).toBe('Looks good, minor tweak needed');
      expect(res.body.user_id).toBe(9);

      const detail = await request(reviewerApp).get(`/api/content/${id}`);
      expect(detail.body.comments.length).toBe(1);
      expect(detail.body.comments[0].body).toBe('Looks good, minor tweak needed');
    });

    test('creator cannot comment (lacks content.comment per the RBAC matrix)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'No comment for you', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).post(`/api/content/${id}/comments`).send({ body: 'Trying anyway' });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.comment');
    });

    test('rejects an empty comment body', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Empty comment test', platforms: [] });
      const id = created.body.id;

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      const res = await request(reviewerApp).post(`/api/content/${id}/comments`).send({ body: '   ' });
      expect(res.status).toBe(400);
    });
  });
});
