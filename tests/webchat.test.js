// Website live-chat webhook: a site posts a visitor's message to
// /api/webhooks/webchat/:token and gets the bot's reply back, using the same
// bot engine (menu, keywords, knowledge base) as WhatsApp.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const chatbot = require('../services/leadPipeline/chatbot');

describe('website chat webhook', () => {
  let knex, app, workspaceId, token;

  beforeAll(async () => {
    // The bot only replies with an active licence; make canPublish true
    jest.spyOn(require('../services/entitlements'), 'canPublish').mockResolvedValue(true);
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'Web Org', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'Urban Society', slug: 'urban' }).returning('id');
    workspaceId = ws?.id ?? ws;
    const repo = require('../repos/leadPipelineRepo')(knex);
    const cfg = await repo.getOrCreateConfig(workspaceId);
    token = cfg.webchat_token;
    await repo.updateConfig(workspaceId, { auto_qualify_ai: 0 });

    await chatbot.saveSettings(knex, workspaceId, 1, { enabled: true, config: chatbot.normalizeConfig({
      ...chatbot.DEFAULT_CONFIG,
      keywords: [{ keywords: 'price, cost', reply: 'Maintenance billing starts at ₹10 per flat.' }],
      knowledge: 'We cover maintenance billing, visitor management and society accounting. Support 9am–6pm Mon–Sat.',
    }) });

    app = express();
    app.use('/api/webhooks', require('../routes/webhooks')(knex));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  test('migration gave the workspace a web-chat token distinct from the verify token', async () => {
    const row = await knex('meta_lead_configs').where({ workspace_id: workspaceId }).first();
    expect(row.webchat_token).toMatch(/^webchat_/);
    expect(row.webchat_token).not.toBe(row.verify_token);
  });

  test('a keyword message gets the configured reply', async () => {
    // greet first so the welcome is out of the way, then ask
    await request(app).post(`/api/webhooks/webchat/${token}`).send({ text: 'hi', visitor_id: 'v1' });
    const r = await request(app).post(`/api/webhooks/webchat/${token}`).send({ text: 'what is the price?', visitor_id: 'v1', name: 'Site visitor' });
    expect(r.status).toBe(200);
    expect(r.body.reply).toContain('Maintenance billing starts at ₹10 per flat.');
  });

  test('a visitor keeps one lead across messages', async () => {
    const leads = await knex('meta_lead_events').where({ workspace_id: workspaceId, leadgen_id: 'web:v1' });
    expect(leads.length).toBe(1);
    expect(leads[0].form_id).toBe('webchat_inbound');
  });

  test('the first message of a new visitor gets the welcome', async () => {
    const r = await request(app).post(`/api/webhooks/webchat/${token}`).send({ text: 'hello', visitor_id: 'v2' });
    expect(r.status).toBe(200);
    expect(r.body.reply).toContain('How can we help');
  });

  test('an unknown token is refused', async () => {
    const r = await request(app).post('/api/webhooks/webchat/not-a-real-token').send({ text: 'hi' });
    expect(r.status).toBe(404);
  });

  test('empty message is rejected', async () => {
    const r = await request(app).post(`/api/webhooks/webchat/${token}`).send({ text: '   ' });
    expect(r.status).toBe(400);
  });

  test('CORS preflight is allowed so a website can call it', async () => {
    const r = await request(app).options(`/api/webhooks/webchat/${token}`);
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('*');
  });
});
