// Fixes from the review: webhook secret rules, secrets never sent to the browser,
// the Chatwoot token only goes to the saved address, feeds can't reach local addresses.
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');

describe('review fixes', () => {
  let knex, hooks, api, workspaceId, repo;
  const oldSecret = process.env.FACEBOOK_APP_SECRET;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'R Org', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'R', slug: 'r' }).returning('id');
    workspaceId = ws?.id ?? ws;
    repo = require('../repos/leadPipelineRepo')(knex);
    await repo.getOrCreateConfig(workspaceId);
    await repo.updateConfig(workspaceId, {
      whatsapp_access_token: 'EAAG-real-token-1234', app_secret: null, evolution_api_key: 'evo-key-5678',
      chatwoot_url: 'https://chat.mybiz.example', chatwoot_api_token: 'cw-token-9999', whatsapp_business_account_id: 'W', auto_qualify_ai: 0,
    });
    hooks = express();
    hooks.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
    hooks.use('/api/webhooks', require('../routes/webhooks')(knex));
    api = express();
    api.use(express.json());
    api.use((req, res, next) => { req.workspaceId = workspaceId; req.session = { userId: 1 }; next(); });
    api.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { process.env.FACEBOOK_APP_SECRET = oldSecret; jest.restoreAllMocks(); await knex.destroy(); });

  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const sign = (secret) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

  test('only the Facebook login app’s secret: a mismatch is logged, not refused (messages keep arriving)', async () => {
    process.env.FACEBOOK_APP_SECRET = 'login-app-secret';
    const r = await request(hooks).post('/api/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign('other-app')).send(body);
    expect(r.status).toBe(200);
  });

  test('the secret saved in WhatsApp setup is enforced', async () => {
    await repo.updateConfig(workspaceId, { app_secret: 'wa-app-secret' });
    const bad = await request(hooks).post('/api/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign('login-app-secret')).send(body);
    expect(bad.status).toBe(401);
    const good = await request(hooks).post('/api/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign('wa-app-secret')).send(body);
    expect(good.status).toBe(200);
  });

  test('WhatsApp setup never sends secrets to the browser; saving a masked value keeps the real one', async () => {
    const r = await request(api).get('/api/lead-pipeline/config');
    const c = r.body.config;
    expect(c.whatsapp_access_token).toBe('••••••••1234');
    expect(c.evolution_api_key).toBe('••••••••5678');
    expect(c.chatwoot_api_token).toBe('••••••••9999');
    expect(c.app_secret_set).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/real-token|evo-key|cw-token|wa-app-secret/);

    await request(api).post('/api/lead-pipeline/config').send({ chatwoot_api_token: c.chatwoot_api_token, app_secret: '••••••••cret' });
    const saved = await knex('meta_lead_configs').where({ workspace_id: workspaceId }).first();
    expect(saved.chatwoot_api_token).toBe('cw-token-9999');
    expect(saved.app_secret).toBe('wa-app-secret');
  });

  test('“Test Chatwoot” never sends the saved token to a different address', async () => {
    const post = jest.spyOn(axios, 'get').mockResolvedValue({ data: {} });
    const r = await request(api).post('/api/lead-pipeline/test-chatwoot').send({ chatwoot_url: 'https://attacker.example', chatwoot_api_token: '••••••••9999' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(post.mock.calls)).not.toMatch(/cw-token-9999/);
    post.mockRestore();
  });

  test('feeds can’t point at this PC or the local network', async () => {
    const rss = require('../services/rss');
    for (const url of ['http://localhost:3000/feed', 'http://127.0.0.1/rss', 'http://192.168.1.10/feed', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/x']) {
      await expect(rss.fetchFeed(url)).rejects.toThrow(/public web address/);
    }
  });
});
