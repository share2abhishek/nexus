// WhatsApp broadcasts: who gets it (STOP, bad numbers, duplicates left out), each
// person's fill-ins, background sending with progress, stop, spreadsheet reading.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const broadcast = require('../services/leadPipeline/broadcast');

describe('WhatsApp broadcasts', () => {
  let knex, app, workspaceId, sent, wc, licence;
  const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };

  beforeAll(async () => {
    licence = jest.spyOn(require('../services/license'), 'status').mockReturnValue({ state: 'active', can_publish: true });
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'BC Org', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'BC WS', slug: 'bc-ws' }).returning('id');
    workspaceId = ws?.id ?? ws;
    const repo = require('../repos/leadPipelineRepo')(knex);
    await repo.getOrCreateConfig(workspaceId);
    await repo.updateConfig(workspaceId, { whatsapp_access_token: 'tok', whatsapp_phone_number_id: 'PN', whatsapp_business_account_id: 'WB', auto_qualify_ai: 0 });
    const add = (full_name, phone_number, tags) => repo.addLeadEvent(workspaceId, { full_name, phone_number, tags_json: JSON.stringify(tags) });
    await add('Priya Sharma', '+91 98765 43210', ['vip']);
    await add('Rahul Mehta', '9123456789', ['vip']);
    const stopped = await add('Anil Kumar', '+919000000001', []);
    await add('No Number', 'abc', []);
    await knex('whatsapp_bot_state').insert({ workspace_id: workspaceId, lead_id: stopped.id, opted_out: true, window_count: 0, updated_at: 1 });

    wc = require('../services/leadPipeline/whatsappCloud');
    sent = [];
    jest.spyOn(wc, 'sendWhatsAppMessage').mockImplementation(async (m) => {
      sent.push(m);
      return m.to.endsWith('3210') || m.to.endsWith('6789') || m.to.endsWith('7777') ? { success: true } : { success: false, error: 'Number not on WhatsApp' };
    });
    // no waiting between messages in tests
    broadcast.DELAY.cloud_api = 0;

    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = workspaceId; req.session = { userId: 1 }; next(); });
    app.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  test('the audience leaves out people who replied STOP, bad numbers and duplicates', async () => {
    const all = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts/audience').send({ audience: { type: 'all' } });
    expect(all.body.count).toBe(2);
    expect(all.body.skipped).toEqual({ opted_out: 1, invalid: 1, duplicate: 0 });
    const tag = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts/audience').send({ audience: { type: 'tag', tag: 'vip' } });
    expect(tag.body.count).toBe(2);
    const list = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts/audience').send({ audience: { type: 'list', contacts: [
      { name: 'A', phone: '9876543210' }, { name: 'A again', phone: '+91 98765-43210' }, { name: 'Anil', phone: '9000000001' }, { name: 'x', phone: '12' },
    ] } });
    expect(list.body).toMatchObject({ count: 1, skipped: { duplicate: 1, opted_out: 1, invalid: 1 } });
  });

  test('a template needs every fill-in; nothing is sent without one', async () => {
    const r = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts').send({
      audience: { type: 'all' }, message: { template: { name: 'offer', language: 'en', var_count: 2, params: [{ source: 'name' }, { source: 'text', value: '' }] } },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Fill in \{\{2\}\}/);
    expect(sent).toHaveLength(0);
  });

  test('sends in the background with each person’s name, records results and chat copies', async () => {
    const r = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts').send({
      title: 'Diwali offer',
      audience: { type: 'list', contacts: [{ name: 'Priya Sharma', phone: '9876543210' }, { name: 'Neha', phone: '9188888888' }, { name: '', phone: '9177777777' }] },
      message: { template: { name: 'offer', language: 'en', body: 'Hi {{1}}, enjoy {{2}}!', var_count: 2, params: [{ source: 'name' }, { source: 'text', value: '20% off' }] } },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'sending', total_recipients: 3, title: 'Diwali offer' });
    const id = r.body.id;
    expect(await until(async () => (await request(app).get(`/api/lead-pipeline/whatsapp/broadcasts/${id}`)).body.status !== 'sending')).toBe(true);
    const done = (await request(app).get(`/api/lead-pipeline/whatsapp/broadcasts/${id}`)).body;
    expect(done).toMatchObject({ status: 'completed', sent_count: 2, failed_count: 1 });
    expect(done.results.failures[0]).toMatchObject({ name: 'Neha', error: 'Number not on WhatsApp' });
    expect(sent.map(m => m.templateParams)).toEqual([['Priya', '20% off'], ['Neha', '20% off'], ['there', '20% off']]);
    const copy = await knex('lead_conversation_messages').where({ sender_type: 'broadcast' }).first();
    expect(copy.message_text).toBe('Hi Priya, enjoy 20% off!');
  });

  test('a broadcast can be stopped', async () => {
    broadcast.DELAY.cloud_api = 200;
    sent.length = 0;
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, phone: `91770000${String(i).padStart(4, '0')}` }));
    const r = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts').send({
      audience: { type: 'list', contacts: many }, message: { template: { name: 'hello_world', language: 'en_US', var_count: 0, params: [] } },
    });
    await request(app).post(`/api/lead-pipeline/whatsapp/broadcasts/${r.body.id}/stop`);
    await until(async () => (await request(app).get(`/api/lead-pipeline/whatsapp/broadcasts/${r.body.id}`)).body.status !== 'sending');
    const b = (await request(app).get(`/api/lead-pipeline/whatsapp/broadcasts/${r.body.id}`)).body;
    expect(b.status).toBe('stopped');
    expect(sent.length).toBeLessThan(20);
    broadcast.DELAY.cloud_api = 0;
  });

  test('reads a spreadsheet: finds the name and phone columns', async () => {
    const csv = 'Customer Name,Mobile Number,City\nPriya,98765 43210,Pune\nRahul,9123456789,Mumbai\n';
    const r = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts/read-file')
      .set('Content-Type', 'application/octet-stream').set('X-File-Name', 'list.csv').send(Buffer.from(csv));
    expect(r.status).toBe(200);
    expect(r.body.contacts).toEqual([{ name: 'Priya', phone: '98765 43210' }, { name: 'Rahul', phone: '9123456789' }]);
  });

  test('without an active licence nothing is sent: no broadcast, no test message', async () => {
    licence.mockReturnValue({ state: 'none', can_publish: false });
    sent.length = 0;
    const msg = { template: { name: 'hello_world', language: 'en_US', var_count: 0, params: [] } };
    const r = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts').send({ audience: { type: 'all' }, message: msg });
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({ code: 'LICENSE_REQUIRED' });
    expect(r.body.error).toMatch(/licence/);
    const t = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts/test').send({ to: '9876543210', message: msg });
    expect(t.status).toBe(402);
    expect(sent).toHaveLength(0);
    const setup = await request(app).get('/api/lead-pipeline/whatsapp/broadcasts/setup');
    expect(setup.body.licensed).toBe(false);
    licence.mockReturnValue({ state: 'active', can_publish: true });
  });

  test('a broadcast stops if the licence stops being active while sending', async () => {
    broadcast.DELAY.cloud_api = 60;
    sent.length = 0;
    const many = Array.from({ length: 15 }, (_, i) => ({ name: `P${i}`, phone: `91660000${String(i).padStart(4, '0')}` }));
    const r = await request(app).post('/api/lead-pipeline/whatsapp/broadcasts').send({
      audience: { type: 'list', contacts: many }, message: { template: { name: 'hello_world', language: 'en_US', var_count: 0, params: [] } },
    });
    licence.mockReturnValue({ state: 'expired', can_publish: false });
    await until(async () => (await request(app).get(`/api/lead-pipeline/whatsapp/broadcasts/${r.body.id}`)).body.status !== 'sending');
    const b = (await request(app).get(`/api/lead-pipeline/whatsapp/broadcasts/${r.body.id}`)).body;
    expect(b.status).toBe('stopped');
    expect(b.results.failures[0].error).toMatch(/licence/);
    expect(sent.length).toBeLessThan(15);
    licence.mockReturnValue({ state: 'active', can_publish: true });
    broadcast.DELAY.cloud_api = 0;
  });

  test('a broadcast cut off by a restart shows as stopped', async () => {
    const [row] = await knex('whatsapp_broadcasts').insert({ workspace_id: workspaceId, title: 'x', message_content: '', status: 'sending', created_at: 1, updated_at: 1 }).returning('id');
    await broadcast.recoverInterrupted(knex);
    expect((await knex('whatsapp_broadcasts').where({ id: row?.id ?? row }).first()).status).toBe('stopped');
  });
});
