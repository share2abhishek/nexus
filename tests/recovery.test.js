// Password guessing is slowed down; a forgotten password is reset with the recovery code
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { makeTestKnex } = require('./helpers/db');

const mockKnex = makeTestKnex();
const knex = mockKnex;
jest.mock('../services/knex', () => mockKnex);
jest.mock('../services/license', () => ({ status: () => ({ state: 'active', can_publish: true, limits: { users: -1 } }) }));
jest.mock('../middleware/license', () => ({ withinLimit: () => true, limitMessage: () => '' }));
const guard = require('../services/loginGuard');

let app;
beforeAll(async () => {
  await knex.migrate.latest();
  app = express();
  app.use(express.json());
  app.use(session({ secret: 't', resave: false, saveUninitialized: false }));
  app.use('/users', require('../routes/users'));
});
afterAll(() => knex.destroy());
beforeEach(() => guard._reset());

test('a new account gets a recovery code once, and it resets a forgotten password', async () => {
  const reg = await request(app).post('/users/register').send({ email: 'asha@shop.test', password: 'first-pass', name: 'Asha' });
  expect(reg.status).toBe(200);
  expect(reg.body.recovery_code).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);

  const wrong = await request(app).post('/users/recover').send({ email: 'asha@shop.test', code: 'AAAAA-AAAAA-AAAAA-AAAAA', password: 'new-pass' });
  expect(wrong.status).toBe(401);

  // Lower case and missing dashes are fine
  const ok = await request(app).post('/users/recover').send({ email: 'asha@shop.test', code: reg.body.recovery_code.toLowerCase().replace(/-/g, ''), password: 'new-pass' });
  expect(ok.status).toBe(200);
  expect(ok.body.recovery_code).not.toBe(reg.body.recovery_code);

  expect((await request(app).post('/users/login').send({ email: 'asha@shop.test', password: 'new-pass' })).status).toBe(200);
  // The old code is used up
  const again = await request(app).post('/users/recover').send({ email: 'asha@shop.test', code: reg.body.recovery_code, password: 'x123456' });
  expect(again.status).toBe(401);
});

test('after 5 wrong passwords, sign-in waits (even with the right password)', async () => {
  await request(app).post('/users/register').send({ email: 'ravi@shop.test', password: 'right-pass' });
  for (let i = 0; i < 5; i++) {
    expect((await request(app).post('/users/login').send({ email: 'ravi@shop.test', password: 'nope' })).status).toBe(401);
  }
  const blocked = await request(app).post('/users/login').send({ email: 'ravi@shop.test', password: 'right-pass' });
  expect(blocked.status).toBe(429);
  expect(blocked.body.error).toMatch(/Wait 1 minute/);
});

test('a signed-in user can make a new code with their password', async () => {
  const agent = request.agent(app);
  await agent.post('/users/register').send({ email: 'meera@shop.test', password: 'pass-123' });
  // A wrong password is a message, not a sign-out (401 sent people to the sign-in page)
  const wrong = await agent.post('/users/recovery-code').send({ password: 'wrong' });
  expect(wrong.status).toBe(400);
  expect(wrong.body.error).toBe('Your current password is not right.');
  const r = await agent.post('/users/recovery-code').send({ password: 'pass-123' });
  expect(r.body.recovery_code).toBeTruthy();
  expect((await agent.get('/users/me')).body.user.has_recovery_code).toBe(true);
});
