// WhatsApp auto-replies: the rules (decide), saving settings, and the full path
// from an incoming webhook message to a sent reply, pause, STOP and broadcasts.
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const { makeTestKnex } = require('./helpers/db');
const chatbot = require('../services/leadPipeline/chatbot');

// Wednesday 2026-11-11 11:00 and 21:00 India time
const OPEN = Math.floor(Date.parse('2026-11-11T11:00:00+05:30') / 1000);
const CLOSED = Math.floor(Date.parse('2026-11-11T21:00:00+05:30') / 1000);

function cfg(over = {}) {
  return chatbot.normalizeConfig({
    ...chatbot.DEFAULT_CONFIG,
    menu: { enabled: true, options: [
      { label: 'Prices', reply: 'Haircut ₹300, colour ₹1200.' },
      { label: 'Timings', reply: '' }, // empty: not offered
      { label: 'Talk to a person', reply: 'Someone will reply soon.', handover: true },
    ] },
    keywords: [
      { keywords: 'price, cost, rate', reply: 'Haircut ₹300.' },
      { keywords: ['address'], reply: 'MG Road, Pune.' },
    ],
    ...over,
  });
}
const welcomed = { welcomed_at: OPEN - 60 };

describe('decide(): which reply the bot gives', () => {
  test('first message gets the welcome with a numbered menu, skipping options without a reply', () => {
    const d = chatbot.decide(cfg(), { text: 'hello there', name: 'Priya Sharma', business: 'Glow Salon' }, {}, OPEN);
    expect(d.reason).toBe('welcome');
    expect(d.replies[0]).toContain('Hi Priya! Thanks for messaging Glow Salon');
    expect(d.replies[0]).toContain('1. Prices\n2. Talk to a person');
    expect(d.replies[0]).not.toContain('Timings');
  });

  test('a menu number or the option name answers that option', () => {
    expect(chatbot.decide(cfg(), { text: '1' }, welcomed, OPEN).replies).toEqual(['Haircut ₹300, colour ₹1200.']);
    expect(chatbot.decide(cfg(), { text: 'Prices!' }, welcomed, OPEN).reason).toBe('menu');
    const h = chatbot.decide(cfg(), { text: '2' }, welcomed, OPEN);
    expect(h.action).toBe('handover');
  });

  test('keywords match whole words, with punctuation and capitals ignored', () => {
    expect(chatbot.decide(cfg(), { text: 'What is the RATE??' }, welcomed, OPEN).replies).toEqual(['Haircut ₹300.']);
    expect(chatbot.decide(cfg(), { text: 'I am grateful' }, welcomed, OPEN).reason).not.toBe('keyword');
  });

  test('a keyword answers even on the first message (better than a generic welcome)', () => {
    expect(chatbot.decide(cfg(), { text: 'your address please' }, {}, OPEN).replies).toEqual(['MG Road, Pune.']);
  });

  test('STOP opts out (even while paused); START only after STOP', () => {
    const paused = { ...welcomed, paused_until: OPEN + 3600 };
    expect(chatbot.decide(cfg(), { text: 'STOP' }, paused, OPEN).action).toBe('opt_out');
    expect(chatbot.decide(cfg(), { text: 'start' }, { ...welcomed, opted_out: true }, OPEN).action).toBe('opt_in');
    expect(chatbot.decide(cfg(), { text: 'start' }, welcomed, OPEN).action).toBe(null);
  });

  test('stays quiet while a person is answering', () => {
    const d = chatbot.decide(cfg(), { text: 'price?' }, { ...welcomed, paused_until: OPEN + 60 }, OPEN);
    expect(d).toMatchObject({ replies: [], reason: 'paused' });
  });

  test('outside business hours the away message is added once, with the next opening time', () => {
    const c = cfg({ away: { enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', text: 'Closed now, back {{opens}}.' } });
    expect(chatbot.isOpen(c, OPEN)).toBe(true);
    expect(chatbot.isOpen(c, CLOSED)).toBe(false);
    const d = chatbot.decide(c, { text: 'anything' }, welcomed, CLOSED);
    expect(d.replies).toEqual(['Closed now, back tomorrow at 09:00.']);
    expect(chatbot.decide(c, { text: 'anything' }, { ...welcomed, away_sent_at: CLOSED - 60 }, CLOSED).replies)
      .toEqual(['Thanks for your message! Someone from our team will reply here soon.']);
  });

  test('anything else: holding message at most once an hour, or AI when chosen, or nothing', () => {
    expect(chatbot.decide(cfg(), { text: 'blue shoes' }, welcomed, OPEN).reason).toBe('fallback');
    expect(chatbot.decide(cfg(), { text: 'blue shoes' }, { ...welcomed, fallback_sent_at: OPEN - 10 }, OPEN).replies).toEqual([]);
    expect(chatbot.decide(cfg({ fallback: { mode: 'ai' } }), { text: 'blue shoes' }, welcomed, OPEN).ai).toBe(true);
    expect(chatbot.decide(cfg({ fallback: { mode: 'none' } }), { text: 'blue shoes' }, welcomed, OPEN).replies).toEqual([]);
  });

  test('normalizeConfig caps sizes and drops empty rules', () => {
    const c = chatbot.normalizeConfig({ keywords: [{ keywords: '', reply: 'x' }, { keywords: 'a', reply: 'y'.repeat(5000) }], menu: { options: Array(20).fill({ label: 'o', reply: 'r' }) } });
    expect(c.keywords).toHaveLength(1);
    expect(c.keywords[0].reply.length).toBe(chatbot.LIMITS.text);
    expect(c.menu.options).toHaveLength(chatbot.LIMITS.menuOptions);
  });
});

describe('Auto-replies end to end', () => {
  let knex, app, appApi, workspaceId, sent, licence;

  beforeAll(async () => {
    // An active licence (each test about the licence switches it off itself)
    licence = jest.spyOn(require('../services/license'), 'status').mockReturnValue({ state: 'active', can_publish: true });
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'Bot Org', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'Glow Salon', slug: 'glow-bot' }).returning('id');
    workspaceId = ws?.id ?? ws;
    const repo = require('../repos/leadPipelineRepo')(knex);
    await repo.getOrCreateConfig(workspaceId);
    await repo.updateConfig(workspaceId, { whatsapp_business_account_id: 'WABA1', whatsapp_phone_number_id: 'PN1', whatsapp_access_token: 'tok', auto_qualify_ai: 0 });

    // Capture what would be sent to WhatsApp
    sent = [];
    const wc = require('../services/leadPipeline/whatsappCloud');
    jest.spyOn(wc, 'sendWhatsAppMessage').mockImplementation(async ({ to, text }) => { sent.push({ to, text }); return { success: true }; });

    app = express();
    app.use(express.json());
    app.use('/api/webhooks', require('../routes/webhooks')(knex));

    appApi = express();
    appApi.use(express.json());
    appApi.use((req, res, next) => { req.workspaceId = workspaceId; req.session = { userId: 1 }; next(); });
    appApi.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  const inbound = (text, from = '919876543210') => request(app).post('/api/webhooks/meta').send({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: {
      contacts: [{ wa_id: from, profile: { name: 'Priya Sharma' } }],
      messages: [{ from, type: 'text', text: { body: text } }],
    } }] }],
  });
  const settle = () => new Promise(r => setTimeout(r, 150)); // the webhook answers Meta first, then works

  test('bot is off by default: message saved, nothing sent', async () => {
    await inbound('hi'); await settle();
    expect(sent).toHaveLength(0);
    const msgs = await knex('lead_conversation_messages').where({ workspace_id: workspaceId });
    expect(msgs.map(m => m.message_text)).toContain('hi');
  });

  test('settings save, and "Try it" previews without sending', async () => {
    const r = await request(appApi).post('/api/lead-pipeline/bot').send({ enabled: true, config: cfg() });
    expect(r.body.enabled).toBe(true);
    const g = await request(appApi).get('/api/lead-pipeline/bot');
    expect(g.body.config.keywords[0].keywords).toEqual(['price', 'cost', 'rate']);
    expect(g.body.whatsapp_connected).toBe(true);
    const p = await request(appApi).post('/api/lead-pipeline/bot/preview').send({ text: 'price', first_time: false });
    expect(p.body.replies).toEqual(['Haircut ₹300.']);
    expect(sent).toHaveLength(0);
  });

  test('when on, a keyword is answered and saved in the chat as an auto-reply', async () => {
    await inbound('price?'); await settle();
    expect(sent).toEqual([{ to: '919876543210', text: 'Haircut ₹300.' }]);
    const bot = await knex('lead_conversation_messages').where({ workspace_id: workspaceId, sender_type: 'bot' });
    expect(bot).toHaveLength(1);
  });

  test('after a person replies, the bot stays quiet in that chat', async () => {
    const lead = await knex('meta_lead_events').where({ workspace_id: workspaceId }).first();
    await request(appApi).post(`/api/lead-pipeline/whatsapp/conversations/${lead.id}/reply`).send({ message_text: 'Hi Priya, I can help.' });
    sent.length = 0;
    await inbound('price?'); await settle();
    expect(sent.filter(s => s.text === 'Haircut ₹300.')).toHaveLength(0);
    await request(appApi).post(`/api/lead-pipeline/bot/resume/${lead.id}`);
    await inbound('price?'); await settle();
    expect(sent.map(s => s.text)).toContain('Haircut ₹300.');
  });

  test('without an active licence: no auto-replies, but STOP is still confirmed and recorded', async () => {
    licence.mockReturnValue({ state: 'none', can_publish: false });
    sent.length = 0;
    await inbound('price?', '919555000111'); await settle();
    expect(sent).toHaveLength(0);
    const msg = await knex('lead_conversation_messages').where({ message_text: 'price?' }).orderBy('id', 'desc').first();
    expect(msg).toBeTruthy(); // still saved in Chats
    await inbound('STOP', '919555000111'); await settle();
    expect(sent.map(s => s.text)[0]).toMatch(/won’t get any more broadcast/);
    const lead = await knex('meta_lead_events').where('phone_number', 'like', '%9555000111').first();
    expect((await knex('whatsapp_bot_state').where({ lead_id: lead.id }).first()).opted_out).toBeTruthy();
    licence.mockReturnValue({ state: 'active', can_publish: true });
  });

  test('STOP is confirmed and the contact is skipped by broadcasts', async () => {
    sent.length = 0;
    await inbound('STOP'); await settle();
    expect(sent[0].text).toMatch(/won’t get any more broadcast/);
    sent.length = 0;
    const r = await request(appApi).post('/api/lead-pipeline/whatsapp/broadcast')
      .send({ contacts: [{ name: 'Priya', phone: '+91 98765 43210' }], message_template: 'Offer!', delay_ms: 0 });
    expect(r.body.skipped_opted_out).toBe(1);
    expect(sent).toHaveLength(0);
  });

  test('never more than the hourly limit of bot messages to one chat', async () => {
    sent.length = 0;
    for (let i = 0; i < 10; i++) await inbound('price', '919000000001');
    await settle();
    expect(sent.length).toBeLessThanOrEqual(chatbot.LIMITS.repliesPerHour);
  });

  test('n8n: gets every message as an event, and can answer when chosen', async () => {
    const axios = require('axios');
    const posts = [];
    const spy = jest.spyOn(axios, 'post').mockImplementation(async (url, body) => {
      posts.push({ url, body });
      return { status: 200, data: body.reply_wanted ? { reply: 'From n8n: we have blue shoes in size 8.' } : {} };
    });
    await knex('meta_lead_configs').where({ workspace_id: workspaceId }).update({ n8n_webhook_url: 'https://n8n.example.test/webhook/wa' });
    await request(appApi).post('/api/lead-pipeline/bot').send({ enabled: true, config: cfg({ fallback: { mode: 'n8n', text: 'Holding' } }) });
    sent.length = 0;

    await inbound('price', '919222333444'); await settle();       // keyword: bot answers, n8n is told
    await inbound('blue shoes?', '919222333444'); await settle(); // nothing matches: n8n answers

    expect(posts[0].body).toMatchObject({ event: 'whatsapp.message_received', reply_wanted: false, bot: { reason: 'keyword', replied: ['Haircut ₹300.'] } });
    expect(posts[1].body).toMatchObject({ reply_wanted: true, message: { text: 'blue shoes?' } });
    expect(sent.map(s => s.text)).toEqual(['Haircut ₹300.', 'From n8n: we have blue shoes in size 8.']);
    const saved = await knex('lead_conversation_messages').where({ sender_name: 'n8n' }).first();
    expect(saved.message_text).toMatch(/blue shoes/);

    spy.mockRestore();
    await knex('meta_lead_configs').where({ workspace_id: workspaceId }).update({ n8n_webhook_url: null });
    await request(appApi).post('/api/lead-pipeline/bot').send({ enabled: true, config: cfg() });
  });

  test('with an app secret saved, unsigned or wrongly signed webhooks are refused', async () => {
    await knex('meta_lead_configs').where({ workspace_id: workspaceId }).update({ app_secret: 'shh' });
    const body = { object: 'whatsapp_business_account', entry: [] };
    expect((await request(app).post('/api/webhooks/meta').send(body)).status).toBe(401);
    const raw = JSON.stringify(body);
    const sig = 'sha256=' + crypto.createHmac('sha256', 'shh').update(raw).digest('hex');
    const ok = await request(app).post('/api/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw);
    expect(ok.status).toBe(200);
    await knex('meta_lead_configs').where({ workspace_id: workspaceId }).update({ app_secret: null });
  });

  test('Evolution (WhatsApp Web) messages arrive at the public address with the workspace token', async () => {
    const cfgRow = await knex('meta_lead_configs').where({ workspace_id: workspaceId }).first();
    expect((await request(app).post('/api/webhooks/evolution/wrong-token').send({})).status).toBe(404);
    const r = await request(app).post(`/api/webhooks/evolution/${cfgRow.verify_token}`).send({
      event: 'messages.upsert',
      data: { key: { remoteJid: '919111222333@s.whatsapp.net', fromMe: false }, pushName: 'Ravi', message: { conversation: 'hello from web' } },
    });
    expect(r.status).toBe(200);
    await settle();
    const m = await knex('lead_conversation_messages').where({ message_text: 'hello from web' }).first();
    expect(m).toBeTruthy();
  });
});
