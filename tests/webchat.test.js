// Website live-chat webhook: a site posts a visitor's message to
// /api/webhooks/webchat/:token and gets the bot's reply back, using the same
// bot engine (menu, keywords, knowledge base) as WhatsApp.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const chatbot = require('../services/leadPipeline/chatbot');

describe('website chat webhook', () => {
  let knex, app, workspaceId, token;
  // A second, unrelated business — to prove each login's bot is isolated
  let ws2Id, token2;

  async function makeBusiness(name, slug, ownerId, bot) {
    const [org] = await knex('organizations').insert({ name, owner_user_id: ownerId }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name, slug }).returning('id');
    const wsId = ws?.id ?? ws;
    const repo = require('../repos/leadPipelineRepo')(knex);
    const cfg = await repo.getOrCreateConfig(wsId);
    await repo.updateConfig(wsId, { auto_qualify_ai: 0 });
    await chatbot.saveSettings(knex, wsId, ownerId, { enabled: true, config: chatbot.normalizeConfig(bot) });
    return { wsId, token: cfg.webchat_token };
  }

  beforeAll(async () => {
    // The bot only replies with an active licence; make canPublish true
    jest.spyOn(require('../services/entitlements'), 'canPublish').mockResolvedValue(true);
    knex = makeTestKnex();
    await knex.migrate.latest();

    const a = await makeBusiness('Urban Society', 'urban', 1, {
      ...chatbot.DEFAULT_CONFIG,
      keywords: [{ keywords: 'price, cost', reply: 'Maintenance billing starts at ₹10 per flat.' }],
      knowledge: 'We cover maintenance billing, visitor management and society accounting. Support 9am–6pm Mon–Sat.',
    });
    workspaceId = a.wsId; token = a.token;

    const b = await makeBusiness('Sweet Crumbs Bakery', 'bakery', 2, {
      ...chatbot.DEFAULT_CONFIG,
      welcome: { enabled: true, text: 'Hi {{name}}! Welcome to Sweet Crumbs.' },
      keywords: [{ keywords: 'price, cost', reply: 'Cakes from ₹499, cupcakes ₹60 each.' }],
      knowledge: 'We bake eggless cakes and cupcakes, delivered across Pune.',
    });
    ws2Id = b.wsId; token2 = b.token;

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

  // ── Per-login isolation: each business has its own bot, token and leads ──────
  describe('each business is isolated', () => {
    const ask = (tok, text, visitor_id) => request(app).post(`/api/webhooks/webchat/${tok}`).send({ text, visitor_id });

    test('the two businesses have different web-chat tokens', () => {
      expect(token).toBeTruthy();
      expect(token2).toBeTruthy();
      expect(token).not.toBe(token2);
    });

    test('each token answers only with its own business’s replies', async () => {
      await ask(token, 'hi', 'iso-a');          // clear welcome
      await ask(token2, 'hi', 'iso-b');
      const a = await ask(token, 'price?', 'iso-a');
      const b = await ask(token2, 'price?', 'iso-b');
      expect(a.body.reply).toContain('Maintenance billing starts at ₹10 per flat.');
      expect(a.body.reply).not.toContain('Cakes');
      expect(b.body.reply).toContain('Cakes from ₹499');
      expect(b.body.reply).not.toContain('Maintenance');
    });

    test('each business’s welcome is its own', async () => {
      const b = await ask(token2, 'hello', 'iso-b-new');
      expect(b.body.reply).toContain('Welcome to Sweet Crumbs');
      expect(b.body.reply).not.toContain('Urban Society');
    });

    test('a visitor’s lead is created in the right workspace only', async () => {
      await ask(token2, 'hi there', 'iso-b-lead');
      const inA = await knex('meta_lead_events').where({ workspace_id: workspaceId, leadgen_id: 'web:iso-b-lead' });
      const inB = await knex('meta_lead_events').where({ workspace_id: ws2Id, leadgen_id: 'web:iso-b-lead' });
      expect(inA.length).toBe(0);
      expect(inB.length).toBe(1);
    });

    test('a disabled bot (another login hasn’t set it up) does not reply', async () => {
      const c = await makeBusiness('Quiet Co', 'quiet', 3, { ...chatbot.DEFAULT_CONFIG });
      await chatbot.saveSettings(knex, c.wsId, 3, { enabled: false, config: chatbot.normalizeConfig({ ...chatbot.DEFAULT_CONFIG }) });
      const r = await ask(c.token, 'price?', 'iso-c');
      expect(r.status).toBe(200);
      expect(r.body.reply).toBeNull();
    });
  });
});
