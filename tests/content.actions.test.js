// Create Post, step 2: publish now / schedule (with repeat) for a saved post
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const { requirePermission } = require('../middleware/tenancy');

global.__licensed = true;
jest.mock('../services/license', () => ({
  status: () => (global.__licensed
    ? { state: 'active', can_publish: true, limits: {} }
    : { state: 'unlicensed', can_publish: false, limits: {} }),
}));
jest.mock('../services/social', () => ({ postToPlatform: jest.fn() }));
const { postToPlatform } = require('../services/social');

function makeApp(knex, wsId, role, userId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId, activeWorkspaceId: wsId };
    req.workspaceId = wsId;
    req.role = role;
    next();
  });
  app.use('/api/content', require('../routes/content')(knex, requirePermission));
  return app;
}

describe('content actions — publish now / schedule a saved post', () => {
  let knex, wsId;
  const later = () => Math.floor(Date.now() / 1000) + 3600;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const org = await knex('organizations').insert({ name: 'Org', owner_user_id: 1 }).returning('id');
    const ws = await knex('workspaces').insert({ org_id: org[0]?.id ?? org[0], name: 'WS', slug: 'ws-actions' }).returning('id');
    wsId = ws[0]?.id ?? ws[0];
    await knex('social_accounts').insert({ workspace_id: wsId, platform: 'linkedin', external_id: 'li-1', access_token: 'tok' });
  });
  afterAll(() => knex.destroy());
  beforeEach(() => { postToPlatform.mockReset(); global.__licensed = true; });

  const saveDraft = async (app, body = 'Hello') => (await request(app).post('/api/content').send({ body, platforms: ['linkedin'] })).body;

  test('manager: publish now posts the draft, marks it published and adds history', async () => {
    const app = makeApp(knex, wsId, 'manager');
    const draft = await saveDraft(app, 'Publish me');
    postToPlatform.mockResolvedValue({ success: true, id: 'x1' });
    const res = await request(app).post(`/api/content/${draft.id}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.published).toBe(true);
    expect(res.body.item.status).toBe('published');
    expect(postToPlatform).toHaveBeenCalledTimes(1);
    expect(await knex('posts').where({ content: 'Publish me' })).toHaveLength(1);
    // a second click can't post it again
    expect((await request(app).post(`/api/content/${draft.id}/publish`)).status).toBe(400);
  });

  test('publish failure leaves the post as Failed with the reason', async () => {
    const app = makeApp(knex, wsId, 'manager');
    const draft = await saveDraft(app, 'Will fail');
    postToPlatform.mockRejectedValue(new Error('LinkedIn rejected the connection (401)'));
    const res = await request(app).post(`/api/content/${draft.id}/publish`);
    expect(res.body.published).toBe(false);
    expect(res.body.item.status).toBe('failed');
    expect(res.body.item.error_message).toMatch(/401/);
  });

  test('manager: schedule once', async () => {
    const app = makeApp(knex, wsId, 'manager');
    const draft = await saveDraft(app, 'Once');
    const at = later();
    const res = await request(app).post(`/api/content/${draft.id}/schedule`).send({ scheduled_at: at });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ status: 'scheduled', scheduled_at: at });
  });

  test('manager: schedule weekly × 4 turns the draft into the first post of a series', async () => {
    const app = makeApp(knex, wsId, 'manager');
    const draft = await saveDraft(app, 'Weekly tip');
    const res = await request(app).post(`/api/content/${draft.id}/schedule`).send({ scheduled_at: later(), repeat: { every: 'weekly', count: 4 } });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(4);
    const rows = await knex('content_items').where({ series_id: res.body.series_id }).orderBy('series_index');
    expect(rows).toHaveLength(4);
    expect(rows[0].id).toBe(draft.id);
    expect(rows.every(r => r.status === 'scheduled' && r.body === 'Weekly tip')).toBe(true);
    expect(rows[1].scheduled_at - rows[0].scheduled_at).toBe(7 * 86400);
  });

  test('creator cannot publish or schedule (must send for review)', async () => {
    const app = makeApp(knex, wsId, 'creator');
    const draft = await saveDraft(app, 'Creator post');
    expect((await request(app).post(`/api/content/${draft.id}/publish`)).status).toBe(403);
    expect((await request(app).post(`/api/content/${draft.id}/schedule`).send({ scheduled_at: later() })).status).toBe(403);
    expect((await request(app).patch(`/api/content/${draft.id}/status`).send({ toStatus: 'in_review' })).status).toBe(200);
  });

  test('without a licence: refused with a clear message, post stays a draft', async () => {
    const app = makeApp(knex, wsId, 'manager');
    const draft = await saveDraft(app, 'No licence');
    global.__licensed = false;
    const res = await request(app).post(`/api/content/${draft.id}/schedule`).send({ scheduled_at: later() });
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/saved as a draft/);
    expect((await knex('content_items').where({ id: draft.id }).first()).status).toBe('draft');
  });

  test('a past time and bad repeat are refused', async () => {
    const app = makeApp(knex, wsId, 'manager');
    const draft = await saveDraft(app, 'Bad input');
    expect((await request(app).post(`/api/content/${draft.id}/schedule`).send({ scheduled_at: 100 })).status).toBe(400);
    const bad = await request(app).post(`/api/content/${draft.id}/schedule`).send({ scheduled_at: later(), repeat: { every: 'daily', count: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/at least 2/);
  });
});
