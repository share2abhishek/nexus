// Server edition: AI keys and email sending belong to each business and are
// shared by its team. Customers never fall back to the server's own .env keys,
// and one business never uses another's keys or mail server.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

const mockKnex = makeTestKnex();
const knex = mockKnex;
jest.mock('../services/knex', () => mockKnex);

const bs = require('../services/businessSettings');
const env = { ...process.env };

async function user(email, role = 'user') {
  const [u] = await knex('users').insert({ email, password_hash: 'x', role }).returning('id');
  return u?.id ?? u;
}
async function business(name, ownerId) {
  const [o] = await knex('organizations').insert({ name, owner_user_id: ownerId, plan: 'trial' }).returning('id');
  const orgId = o?.id ?? o;
  await knex('org_members').insert({ org_id: orgId, user_id: ownerId, role: 'owner' });
  const [w] = await knex('workspaces').insert({ org_id: orgId, name, slug: name.toLowerCase().replace(/\W+/g, '-') }).returning('id');
  const wsId = w?.id ?? w;
  await knex('memberships').insert({ user_id: ownerId, workspace_id: wsId, role: 'manager' });
  return { orgId, wsId };
}

// The config routes as the server mounts them (auth + workspace + keys)
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => {
    req.session = { userId: Number(req.headers['x-user']) };
    req.workspaceId = Number(req.headers['x-ws']);
    next();
  });
  const { injectUserKeys } = require('../middleware/auth');
  a.get('/keys', injectUserKeys, (req, res) => res.json({ google: req.googleKey || null, groq: req.groqKey || null }));
  a.use('/api/config', require('../routes/config'));
  return a;
}

beforeAll(async () => {
  process.env.NEXUS_MODE = 'server';
  // Radixile's own keys and mail server in .env: customers must never use them
  process.env.GOOGLE_AI_KEY = 'AIza-RADIXILE-OWN';
  process.env.GROQ_API_KEY = 'gsk-RADIXILE-OWN';
  process.env.SMTP_HOST = 'smtp.radixile.test'; process.env.SMTP_USER = 'ops@radixile.test'; process.env.SMTP_PASS = 'radixile-secret';
  delete process.env.OLLAMA_ENABLED;
  await knex.migrate.latest();
});
afterAll(async () => { process.env = env; await knex.destroy(); });

describe('business settings store', () => {
  test('secrets are saved encrypted, read back for use, and kept when the form sends a mask or nothing', async () => {
    const owner = await user('owner@store.test');
    const { orgId } = await business('Store Co', owner);
    await bs.save(orgId, { google_ai_key: 'AIza-STORE', smtp_host: 'smtp.store.test', smtp_pass: 'p@ss word' }, { userId: owner });

    // read under another name: query results are decrypted automatically
    const raw = await knex.raw('select key, value, secret_value as stored from business_settings where org_id = ?', [orgId]);
    const rows = raw.rows || raw;
    const pass = rows.find(r => r.key === 'smtp_pass');
    expect(pass.value).toBeNull();
    expect(String(pass.stored)).toMatch(/^enc:v1:/);
    expect(rows.find(r => r.key === 'smtp_host').value).toBe('smtp.store.test');

    expect(await bs.getAll(orgId)).toMatchObject({ google_ai_key: 'AIza-STORE', smtp_pass: 'p@ss word' });

    await bs.save(orgId, { google_ai_key: '••••ORE', smtp_pass: '' });
    expect(await bs.getAll(orgId)).toMatchObject({ google_ai_key: 'AIza-STORE', smtp_pass: 'p@ss word' });

    await bs.save(orgId, {}, { clear: ['google_ai_key'] });
    expect((await bs.getAll(orgId)).google_ai_key).toBeUndefined();

    // Only known settings are stored
    await bs.save(orgId, { role: 'admin', SMTP_HOST: 'x' });
    expect(Object.keys(await bs.getAll(orgId)).sort()).toEqual(['smtp_host', 'smtp_pass']);
  });

  test('a line break in a value is refused', async () => {
    const owner = await user('owner@nl.test');
    const { orgId } = await business('NL Co', owner);
    await expect(bs.save(orgId, { smtp_host: 'a\nb' })).rejects.toThrow(/line break/);
  });
});

describe('AI keys on the server', () => {
  test('a team member uses their business’s shared key, never Radixile’s .env key; another business gets nothing', async () => {
    const ownerA = await user('owner@a.test');
    const memberA = await user('creator@a.test');
    const a = await business('Alpha', ownerA);
    await knex('memberships').insert({ user_id: memberA, workspace_id: a.wsId, role: 'creator' });
    await bs.save(a.orgId, { google_ai_key: 'AIza-ALPHA' });

    const ownerB = await user('owner@b.test');
    const b = await business('Beta', ownerB);

    const asA = await request(app()).get('/keys').set('x-user', String(memberA)).set('x-ws', String(a.wsId));
    expect(asA.body).toEqual({ google: 'AIza-ALPHA', groq: null });

    const asB = await request(app()).get('/keys').set('x-user', String(ownerB)).set('x-ws', String(b.wsId));
    expect(asB.body).toEqual({ google: null, groq: null });
  });

  test('a person’s own key wins over the business key', async () => {
    const owner = await user('owner@own.test');
    const { orgId, wsId } = await business('Own Co', owner);
    await bs.save(orgId, { google_ai_key: 'AIza-BUSINESS' });
    await knex('user_settings').insert({ user_id: owner, google_ai_key: 'AIza-PERSONAL' });
    const res = await request(app()).get('/keys').set('x-user', String(owner)).set('x-ws', String(wsId));
    expect(res.body.google).toBe('AIza-PERSONAL');
  });

  test('background jobs use the business’s keys on the server and .env only on the desktop app; Local AI is off on the server', async () => {
    const owner = await user('owner@bg.test');
    const { orgId, wsId } = await business('Background Co', owner);
    await bs.save(orgId, { groq_key: 'gsk-BG' });

    const opts = await bs.aiOptionsFor(wsId);
    expect(opts.groqKey).toBe('gsk-BG');
    expect(opts.googleKey).toBeUndefined();
    expect(opts.ollamaEnabled).toBe(false);
    expect((await bs.aiOptionsFor(wsId, { googleKey: 'AIza-REQ' })).googleKey).toBe('AIza-REQ');

    process.env.NEXUS_MODE = 'desktop';
    try {
      const desk = await bs.aiOptionsFor(null);
      expect(desk.googleKey).toBe('AIza-RADIXILE-OWN');
      expect(desk.ollamaEnabled).toBe(true);
    } finally { process.env.NEXUS_MODE = 'server'; }

    process.env.OLLAMA_ENABLED = 'true';
    expect(require('../services/edition').ollamaDefault()).toBe(true);
    delete process.env.OLLAMA_ENABLED;
  });
});

describe('Settings screens on the server', () => {
  test('the owner saves the business email settings; the password is never sent back; a creator can’t read or change them', async () => {
    const owner = await user('owner@mail.test');
    const creator = await user('creator@mail.test');
    const { orgId, wsId } = await business('Mail Co', owner);
    await knex('memberships').insert({ user_id: creator, workspace_id: wsId, role: 'creator' });
    const as = (id) => ({ 'x-user': String(id), 'x-ws': String(wsId) });

    const saved = await request(app()).post('/api/config/smtp').set(as(owner))
      .send({ SMTP_HOST: 'smtp.mail.test', SMTP_PORT: '465', SMTP_USER: 'hello@mail.test', SMTP_PASS: 'app pass', SMTP_FROM_NAME: 'Mail Co' });
    expect(saved.status).toBe(200);

    const got = await request(app()).get('/api/config/smtp').set(as(owner));
    expect(got.body).toMatchObject({ SMTP_HOST: 'smtp.mail.test', SMTP_USER: 'hello@mail.test', pass_set: true, configured: true });
    expect(JSON.stringify(got.body)).not.toMatch(/app pass/);

    const { smtpConfigFor } = require('../services/sellbird/dispatcher');
    expect(await smtpConfigFor(wsId)).toMatchObject({ host: 'smtp.mail.test', port: 465, secure: true, from: 'hello@mail.test', fromName: 'Mail Co' });

    expect((await request(app()).get('/api/config/smtp').set(as(creator))).status).toBe(403);
    const denied = await request(app()).post('/api/config/smtp').set(as(creator)).send({ SMTP_HOST: 'evil.test' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('BUSINESS_MANAGER_ONLY');
    expect((await bs.getAll(orgId)).smtp_host).toBe('smtp.mail.test');

    // The server's .env was not touched
    expect(process.env.SMTP_HOST).toBe('smtp.radixile.test');
  });

  test('a business without email settings never sends through Radixile’s mail server', async () => {
    const owner = await user('owner@nomail.test');
    const { wsId } = await business('No Mail Co', owner);
    const { smtpConfigFor, sendOutreachEmail } = require('../services/sellbird/dispatcher');
    expect(await smtpConfigFor(wsId)).toBeNull();
    await expect(sendOutreachEmail({ to: 'x@y.test', subject: 's', body: 'b', workspaceId: wsId })).rejects.toThrow(/not configured/);
  });

  test('shared AI keys: managers save them, everyone sees which are set (never the keys), creators can’t change them', async () => {
    const owner = await user('owner@ai.test');
    const creator = await user('creator@ai.test');
    const { wsId } = await business('AI Co', owner);
    await knex('memberships').insert({ user_id: creator, workspace_id: wsId, role: 'creator' });
    const as = (id) => ({ 'x-user': String(id), 'x-ws': String(wsId) });

    expect((await request(app()).post('/api/config/business-ai').set(as(owner)).send({ google_ai_key: 'AIza-TEAM' })).status).toBe(200);

    const seen = await request(app()).get('/api/config/business-ai').set(as(creator));
    expect(seen.body).toMatchObject({ google_ai_key: true, groq_key: false, can_manage: false });
    expect(JSON.stringify(seen.body)).not.toMatch(/AIza-TEAM/);

    expect((await request(app()).post('/api/config/business-ai').set(as(creator)).send({ google_ai_key: 'AIza-MINE' })).status).toBe(403);

    // The old shared-keys form also saves to the business, not to .env
    expect((await request(app()).post('/api/config/ai-keys').set(as(owner)).send({ GOOGLE_AI_KEY: 'AIza-NEW' })).status).toBe(200);
    const keys = await request(app()).get('/keys').set(as(creator));
    expect(keys.body.google).toBe('AIza-NEW');
    expect(process.env.GOOGLE_AI_KEY).toBe('AIza-RADIXILE-OWN');
  });
});
