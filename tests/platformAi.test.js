// Server edition: Radixile's platform-default AI keys (set by a Super Admin) fill
// the gap for a business that has not added its own key, so AI works on a trial.
// A business's own shared key, and a person's own key, always win over them.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

const mockKnex = makeTestKnex();
const knex = mockKnex;
jest.mock('../services/knex', () => mockKnex);

const platformAi = require('../services/platformAi');
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
  return a;
}

beforeAll(async () => {
  process.env.NEXUS_MODE = 'server';
  delete process.env.GOOGLE_AI_KEY; delete process.env.GROQ_API_KEY;
  delete process.env.OLLAMA_ENABLED;
  await knex.migrate.latest();
});
afterAll(async () => { process.env = env; await knex.destroy(); });
afterEach(() => platformAi.forget());

describe('platform-default AI keys', () => {
  test('saved encrypted, read back as booleans only', async () => {
    await platformAi.save({ platform_google_ai_key: 'AIza-PLATFORM' });
    const raw = await knex.raw("select value from platform_config where key = 'platform_google_ai_key'");
    const rows = raw.rows || raw;
    expect(String(rows[0].value)).toMatch(/^enc:v1:/);         // stored sealed
    expect(await platformAi.publicView()).toMatchObject({ platform_google_ai_key: true, platform_groq_key: false });
    await platformAi.save({}, { clear: ['platform_google_ai_key'] });
    expect((await platformAi.publicView()).platform_google_ai_key).toBe(false);
  });

  test('a masked or empty value keeps the saved key', async () => {
    await platformAi.save({ platform_groq_key: 'gsk-PLATFORM' });
    await platformAi.save({ platform_groq_key: '••••ORM' });
    expect((await platformAi.keys()).groqKey).toBe('gsk-PLATFORM');
    await platformAi.save({}, { clear: ['platform_groq_key'] });
  });

  test('fills the gap for a business with no key of its own', async () => {
    await platformAi.save({ platform_google_ai_key: 'AIza-PLATFORM' });
    const owner = await user('owner@trial.test');
    const { wsId } = await business('Trial Co', owner);
    const res = await request(app()).get('/keys').set('x-user', String(owner)).set('x-ws', String(wsId));
    expect(res.body.google).toBe('AIza-PLATFORM');
    await platformAi.save({}, { clear: ['platform_google_ai_key'] });
  });

  test('the business’s own key and a person’s own key win over the platform key', async () => {
    await platformAi.save({ platform_google_ai_key: 'AIza-PLATFORM' });
    const owner = await user('owner@paid.test');
    const member = await user('creator@paid.test');
    const { orgId, wsId } = await business('Paid Co', owner);
    await knex('memberships').insert({ user_id: member, workspace_id: wsId, role: 'creator' });
    await bs.save(orgId, { google_ai_key: 'AIza-BUSINESS' });

    const asMember = await request(app()).get('/keys').set('x-user', String(member)).set('x-ws', String(wsId));
    expect(asMember.body.google).toBe('AIza-BUSINESS');       // business key beats platform

    await knex('user_settings').insert({ user_id: owner, google_ai_key: 'AIza-PERSONAL' });
    const asOwner = await request(app()).get('/keys').set('x-user', String(owner)).set('x-ws', String(wsId));
    expect(asOwner.body.google).toBe('AIza-PERSONAL');        // personal key beats both
    await platformAi.save({}, { clear: ['platform_google_ai_key'] });
  });

  test('background jobs fall back to the platform key after the business key', async () => {
    await platformAi.save({ platform_groq_key: 'gsk-PLATFORM' });
    const owner = await user('owner@bg2.test');
    const { wsId } = await business('BG Co', owner);
    const opts = await bs.aiOptionsFor(wsId);
    expect(opts.groqKey).toBe('gsk-PLATFORM');
    await platformAi.save({}, { clear: ['platform_groq_key'] });
  });
});
