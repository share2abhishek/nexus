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
});
