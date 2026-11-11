// Server edition (SaaS) sign-up: each sign-up gets its own business on a 14-day
// trial, no customer becomes admin of the service, invitations join the right
// business, and email links confirm the address and reset passwords.
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { makeTestKnex } = require('./helpers/db');

const mockKnex = makeTestKnex();
const knex = mockKnex;
const mockMails = [];
jest.mock('../services/knex', () => mockKnex);
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async (m) => { mockMails.push(m); return { messageId: 'x' }; } }) }));
const guard = require('../services/loginGuard');

const linkIn = (mail) => (mail.text.match(/https?:\/\/\S+/) || [])[0];
const tokenFrom = (url, key) => new URL(url).searchParams.get(key);

let app;
const env = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    NEXUS_MODE: 'server', PLATFORM_ADMIN_EMAILS: 'ops@radixile.test',
    SMTP_HOST: 'smtp.test', SMTP_USER: 'noreply@radixile.test', SMTP_PASS: 'x', APP_URL: 'https://app.radixile.test',
  });
  await knex.migrate.latest();
  app = express();
  app.use(express.json());
  app.use(session({ secret: 't', resave: false, saveUninitialized: false }));
  app.use('/users', require('../routes/users'));
  app.use('/invitations', require('../routes/invitations')(knex, (req, res, next) => { req.workspaceId = Number(req.headers['x-ws']); next(); }, () => (req, res, next) => next()));
});
afterAll(async () => { process.env = env; await knex.destroy(); });
beforeEach(() => { guard._reset(); mockMails.length = 0; });

test('sign-up creates a business on a 14-day trial; the first customer is not an admin', async () => {
  const info = (await request(app).get('/users/registration-info')).body;
  expect(info).toMatchObject({ server: true, is_first_user: false });

  const agent = request.agent(app);
  const r = await agent.post('/users/register').send({ email: 'Asha@Acme.test', password: 'long-enough', name: 'Asha', business_name: 'Acme Interiors' });
  expect(r.status).toBe(200);
  expect(r.body.user.role).toBe('user');
  expect(r.body.verify_email_sent).toBe(true);
  expect(r.body.recovery_code).toBeUndefined();

  const user = await knex('users').where({ email: 'asha@acme.test' }).first();
  expect(user.role).toBe('user');
  const org = await knex('organizations').where({ owner_user_id: user.id }).first();
  expect(org).toMatchObject({ name: 'Acme Interiors', plan: 'trial' });
  expect(org.trial_ends_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(14 * 86400 - 60);
  const ws = await knex('workspaces').where({ org_id: org.id }).first();
  expect(await knex('memberships').where({ user_id: user.id, workspace_id: ws.id }).first()).toMatchObject({ role: 'manager' });

  const me = (await agent.get('/users/me')).body;
  expect(me).toMatchObject({ server: true, user: { email_verified: false }, business: { name: 'Acme Interiors', plan: 'trial', role: 'owner', trial_days_left: 14 } });
});

test('a business name and a longer password are needed; an email can sign up only once', async () => {
  expect((await request(app).post('/users/register').send({ email: 'b@b.test', password: 'long-enough' })).body.error).toMatch(/business name/);
  expect((await request(app).post('/users/register').send({ email: 'b@b.test', password: 'short', business_name: 'B' + 'x' })).body.error).toMatch(/8 characters/);
  const dup = await request(app).post('/users/register').send({ email: 'asha@acme.test', password: 'long-enough', business_name: 'Other' });
  expect(dup.status).toBe(409);
});

test('the confirmation link confirms the email once; Radixile staff become admins only after confirming', async () => {
  const agent = request.agent(app);
  await agent.post('/users/register').send({ email: 'ops@radixile.test', password: 'long-enough', business_name: 'Radixile' });
  expect((await knex('users').where({ email: 'ops@radixile.test' }).first()).role).toBe('user'); // not yet
  const link = linkIn(mockMails.find((m) => m.to === 'ops@radixile.test'));
  expect(link).toMatch(/^https:\/\/app\.radixile\.test\/users\/verify-email\?token=/);

  const path = new URL(link).pathname + new URL(link).search;
  const ok = await agent.get(path);
  expect(ok.headers.location).toBe('/?verified=1');
  const u = await knex('users').where({ email: 'ops@radixile.test' }).first();
  expect(u.email_verified_at).toBeTruthy();
  expect(u.role).toBe('admin');
  expect((await agent.get(path)).headers.location).toBe('/login.html?verify=expired'); // used up
  // Only a hash of the token is stored
  expect(await knex('auth_tokens').where({ token_hash: tokenFrom(link, 'token') }).first()).toBeUndefined();
});

test('forgot password: same answer for any address; the emailed link resets once and expires', async () => {
  const unknown = await request(app).post('/users/forgot-password').send({ email: 'nobody@nowhere.test' });
  const known = await request(app).post('/users/forgot-password').send({ email: 'asha@acme.test' });
  expect(unknown.body).toEqual(known.body);
  expect(mockMails).toHaveLength(1);
  const token = tokenFrom(linkIn(mockMails[0]), 'reset');

  expect((await request(app).post('/users/reset-password').send({ token, password: 'short' })).status).toBe(400);
  const r = await request(app).post('/users/reset-password').send({ token, password: 'brand-new-pass' });
  expect(r.status).toBe(200);
  expect((await request(app).post('/users/login').send({ email: 'asha@acme.test', password: 'brand-new-pass' })).status).toBe(200);
  expect((await request(app).post('/users/reset-password').send({ token, password: 'again-again' })).status).toBe(400); // once

  // An expired link doesn't work
  await request(app).post('/users/forgot-password').send({ email: 'asha@acme.test' });
  const t2 = tokenFrom(linkIn(mockMails[1]), 'reset');
  await knex('auth_tokens').where({ kind: 'reset_password' }).whereNull('used_at').update({ expires_at: 1 });
  expect((await request(app).post('/users/reset-password').send({ token: t2, password: 'brand-new-2' })).status).toBe(400);
});

test('an invited person signs up into the inviting business (no new business), with the invited address only', async () => {
  const owner = await knex('users').where({ email: 'asha@acme.test' }).first();
  const org = await knex('organizations').where({ owner_user_id: owner.id }).first();
  const ws = await knex('workspaces').where({ org_id: org.id }).first();
  const agent = request.agent(app);
  await agent.post('/users/login').send({ email: 'asha@acme.test', password: 'brand-new-pass' });
  const inv = await agent.post('/invitations').set('x-ws', String(ws.id)).send({ email: 'ravi@acme.test', role: 'creator' });
  expect(inv.status).toBe(201);
  expect(inv.body.emailed).toBe(true);
  expect(mockMails.at(-1)).toMatchObject({ to: 'ravi@acme.test' });

  const wrong = await request(app).post('/users/register').send({ email: 'someone@else.test', password: 'long-enough', invite_token: inv.body.token });
  expect(wrong.status).toBe(403);
  const r = await request(app).post('/users/register').send({ email: 'ravi@acme.test', password: 'long-enough', name: 'Ravi', invite_token: inv.body.token });
  expect(r.status).toBe(200);
  const ravi = await knex('users').where({ email: 'ravi@acme.test' }).first();
  expect(await knex('organizations').where({ owner_user_id: ravi.id }).first()).toBeUndefined();
  expect(await knex('memberships').where({ user_id: ravi.id, workspace_id: ws.id }).first()).toMatchObject({ role: 'creator' });
});

test('the desktop app keeps its old sign-up (no business name, no server flag)', async () => {
  delete process.env.NEXUS_MODE;
  expect((await request(app).get('/users/registration-info')).body.server).toBe(false);
  const created = await require('../repos/usersRepo')(knex).create('first@desk.test', 'x', 'D');
  expect(created.role).toBe('user'); // not the first user in this database
  process.env.NEXUS_MODE = 'server';
});
