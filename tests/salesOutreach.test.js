// Sales outreach fixes: nothing faked as sent, real pause, replies stop
// follow-ups, editing can't approve, answers only "replied" if sent, licence, real numbers.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

let mockMailOk = true;
const mockMails = [];
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async (m) => { if (!mockMailOk) throw new Error('SMTP refused'); mockMails.push(m); return { messageId: 'x' }; } }) }));

const { processDueOutbox } = require('../services/sellbird/dispatcher');

describe('Sales outreach', () => {
  let knex, app, repo, ws, camp, contact, licence;
  const env = { ...process.env };
  const now = () => Math.floor(Date.now() / 1000);
  const add = (data) => repo.addOutboxItem(ws, { campaign_id: camp.id, contact_id: contact.id, subject: 'S', body: 'B', status: 'approved', scheduled_at: now() - 10, ...data });

  beforeAll(async () => {
    Object.assign(process.env, { SMTP_HOST: 'smtp.test', SMTP_USER: 'sales@mybiz.example', SMTP_PASS: 'x', SMTP_FROM: 'sales@mybiz.example', SMTP_FROM_NAME: 'My Biz' });
    licence = jest.spyOn(require('../services/license'), 'status').mockReturnValue({ state: 'active', can_publish: true });
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'S Org', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'S', slug: 's' }).returning('id');
    ws = w?.id ?? w;
    repo = require('../repos/sellbirdRepo')(knex);
    camp = await repo.createCampaign(ws, { name: 'Pune offices', max_emails_per_day: 10 });
    const company = await repo.addCompany(ws, camp.id, { name: 'Acme', domain: 'acme.example' });
    contact = await repo.addContact(ws, company.id, { full_name: 'Ravi Kumar', role: 'Owner', email: 'ravi@acme.example', email_status: 'verified' });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = ws; req.session = { userId: 1 }; next(); });
    app.use('/api/sellbird', require('../routes/sellbird')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { process.env = env; jest.restoreAllMocks(); await knex.destroy(); });
  beforeEach(async () => { mockMails.length = 0; mockMailOk = true; await knex('sellbird_outbox').del(); await knex('sellbird_replies').del(); });

  test('editing an email changes text and time only — it can’t approve or mark it sent', async () => {
    const o = await add({ status: 'pending_approval' });
    await request(app).patch(`/api/sellbird/outbox/${o.id}`).send({ subject: 'Better subject', status: 'sent' });
    const after = await repo.getOutboxItem(ws, o.id);
    expect(after).toMatchObject({ subject: 'Better subject', status: 'pending_approval' });
  });

  test('“Pause sending” really pauses; paused campaigns are skipped', async () => {
    const o = await add();
    await request(app).post('/api/sellbird/sending/pause').send({ paused: true });
    expect((await processDueOutbox(knex, repo, { workspaceId: ws, enableJitter: false })).sent).toBe(0);
    expect((await repo.getOutboxItem(ws, o.id)).status).toBe('approved');
    await request(app).post('/api/sellbird/sending/pause').send({ paused: false });

    await knex('sellbird_campaigns').where({ id: camp.id }).update({ status: 'paused' });
    expect((await processDueOutbox(knex, repo, { workspaceId: ws, enableJitter: false })).sent).toBe(0);
    await knex('sellbird_campaigns').where({ id: camp.id }).update({ status: 'active' });
    expect((await processDueOutbox(knex, repo, { workspaceId: ws, enableJitter: false })).sent).toBe(1);
    expect(mockMails[0]).toMatchObject({ to: 'ravi@acme.example', from: 'My Biz <sales@mybiz.example>' });
  });

  test('adding a reply stops that person’s follow-ups (and they’re skipped if already approved)', async () => {
    const f2 = await add({ step_number: 2, status: 'pending_approval' });
    const f3 = await add({ step_number: 3 });
    const r = await request(app).post('/api/sellbird/replies/simulate').send({ sender_email: 'Ravi@Acme.example', message_text: 'Sounds good, call me Thursday.' });
    expect(r.status).toBe(201);
    expect((await repo.getOutboxItem(ws, f2.id)).status).toBe('rejected');
    expect((await repo.getOutboxItem(ws, f3.id))).toMatchObject({ status: 'rejected', error_message: 'Not sent: they replied.' });

    // a follow-up approved later is still not sent
    const f4 = await add({ step_number: 2 });
    await processDueOutbox(knex, repo, { workspaceId: ws, enableJitter: false });
    expect((await repo.getOutboxItem(ws, f4.id)).status).toBe('rejected');
    expect(mockMails).toHaveLength(0);
  });

  test('an answer is only marked “replied” if the email really went out', async () => {
    const r = await request(app).post('/api/sellbird/replies/simulate').send({ sender_email: 'ravi@acme.example', message_text: 'Price?' });
    mockMailOk = false;
    const bad = await request(app).post(`/api/sellbird/replies/${r.body.id}/send`).send({ ai_drafted_reply: 'Our price is ₹999.' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/wasn’t sent/);
    expect((await repo.getReply(ws, r.body.id)).status).not.toBe('replied');
    mockMailOk = true;
    const ok = await request(app).post(`/api/sellbird/replies/${r.body.id}/send`).send({ ai_drafted_reply: 'Our price is ₹999.' });
    expect(ok.status).toBe(200);
    expect((await repo.getReply(ws, r.body.id)).status).toBe('replied');
  });

  test('“Send now” needs an active licence', async () => {
    licence.mockReturnValue({ state: 'none', can_publish: false });
    const r = await request(app).post('/api/sellbird/heartbeat/run');
    expect(r.status).toBe(402);
    licence.mockReturnValue({ state: 'active', can_publish: true });
  });

  test('the screen gets real numbers and the real sending address', async () => {
    const sent = await add({ status: 'sent' });
    await knex('sellbird_outbox').where({ id: sent.id }).update({ sent_at: now() });
    await add({ status: 'failed' });
    const s = (await request(app).get('/api/sellbird/stats')).body;
    expect(s).toMatchObject({ sent_today: 1, daily_cap: 10, failed: 1, active_campaigns: 1, paused: false, licensed: true, sender: { email: 'sales@mybiz.example', name: 'My Biz' } });
  });
});
