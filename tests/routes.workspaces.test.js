const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

// Build a tiny app wiring the workspaces router with a fake session.
function appWith(knex, session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/workspaces', require('../routes/workspaces')(knex));
  return app;
}

describe('workspaces routes', () => {
  let knex;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const o = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const orgId = o[0]?.id ?? o[0];
    await knex('org_members').insert({ org_id: orgId, user_id: 1, role: 'owner' });
  });
  afterAll(async () => { await knex.destroy(); });

  test('owner can create a workspace', async () => {
    const org = await knex('organizations').first();
    const res = await request(appWith(knex, { userId: 1 }))
      .post('/workspaces').send({ orgId: org.id, name: 'Client A', slug: 'client-a' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Client A');
  });

  test('user can list workspaces with detailed metrics', async () => {
    // Connect a mock social account and add membership
    const ws = await knex('workspaces').where({ slug: 'client-a' }).first();
    await knex('social_accounts').insert({
      workspace_id: ws.id,
      platform: 'linkedin',
      account_label: 'Starbucks LinkedIn',
      external_id: 'lk-123',
      access_token: 'tok-123'
    });

    const res = await request(appWith(knex, { userId: 1 }))
      .get('/workspaces');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    const clientA = res.body.find(w => w.name === 'Client A');
    expect(clientA).toBeDefined();
    expect(clientA.member_count).toBe(1);
    expect(clientA.social_accounts).toHaveLength(1);
    expect(clientA.social_accounts[0].platform).toBe('linkedin');
  });

  test('user can list their organizations', async () => {
    const res = await request(appWith(knex, { userId: 1 }))
      .get('/workspaces/organizations');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('O');
  });

  test('owner can delete a workspace', async () => {
    const ws = await knex('workspaces').where({ slug: 'client-a' }).first();
    const res = await request(appWith(knex, { userId: 1 }))
      .delete(`/workspaces/${ws.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const check = await knex('workspaces').where({ id: ws.id }).first();
    expect(check).toBeUndefined();
  });
});
