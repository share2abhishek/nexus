// The whole Sales outreach life cycle through the app's own routes:
// campaign → add company → drafts → approve → send in order → reply → answer → opt-out.
// Websites, DNS and the mail server are stand-ins; nothing leaves the machine.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

const mockMails = [];
const mockSites = {};
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async (m) => { mockMails.push(m); return { messageId: 'x' }; } }) }));
jest.mock('../services/sellbird/crawler', () => ({
  ...jest.requireActual('../services/sellbird/crawler'),
  crawlWebsite: async (d) => {
    const domain = String(d).replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    const site = mockSites[domain];
    if (!site) return { success: false, domain, title: domain, description: 'Website could not be reached directly.', emails: [], buying_signals: { signals: ['Domain Identified'], headlines: [], snippet: '' } };
    return { success: true, domain, title: site.title, description: '', emails: site.emails || [], buying_signals: { signals: site.signals || [], headlines: [], snippet: site.text || '' } };
  },
}));
jest.mock('../services/sellbird/contacts', () => ({
  ...jest.requireActual('../services/sellbird/contacts'),
  verifyContactEmail: async (e) => (/@nomail\./.test(e) ? { verified: false, status: 'invalid' } : { verified: true, status: 'verified' }),
}));
// No AI in tests: the plain template is used
jest.mock('../services/aiHelper', () => ({
  ...jest.requireActual('../services/aiHelper'),
  aiJSON: async () => { throw new Error('no AI'); },
  aiGenerate: async () => { throw new Error('no AI'); },
}));

const { processDueOutbox } = require('../services/sellbird/dispatcher');

describe('Sales outreach life cycle', () => {
  let knex, app, ws, campaign;
  const env = { ...process.env };
  const DAY = 86400;
  const now = () => Math.floor(Date.now() / 1000);
  const send = () => processDueOutbox(knex, require('../repos/sellbirdRepo')(knex), { workspaceId: ws, enableJitter: false });
  const outboxFor = (contactId) => knex('sellbird_outbox').where({ contact_id: contactId }).orderBy('step_number');

  beforeAll(async () => {
    Object.assign(process.env, { SMTP_HOST: 'smtp.test', SMTP_USER: 'me@mybiz.example', SMTP_PASS: 'x', SMTP_FROM: 'me@mybiz.example', SMTP_FROM_NAME: 'Asha' });
    jest.spyOn(require('../services/license'), 'status').mockReturnValue({ state: 'active', can_publish: true });
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'W', slug: 'w' }).returning('id');
    ws = w?.id ?? w;
    await knex('brand_kit').insert({ workspace_id: ws, company_name: 'BrightDesk' });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = ws; req.session = { userId: 1 }; next(); });
    app.use('/api/sellbird', require('../routes/sellbird')(knex, () => (req, res, next) => next()));

    Object.assign(mockSites, {
      'acme.example': { title: 'Acme Interiors — office fit-outs in Pune', emails: ['hello@acme.example', 'studio@webagency.example'], signals: ['Actively Hiring / Growing'], text: 'Ravi Kumar, Founder of Acme' },
      'beta.example': { title: 'Beta Foods', emails: [] },
      'gamma.example': { title: 'Gamma Labs', emails: ['team@gamma.example'] },
    });
  });
  afterAll(async () => { process.env = env; jest.restoreAllMocks(); await knex.destroy(); });

  let acme;
  test('1. a campaign is created with what you offer', async () => {
    const r = await request(app).post('/api/sellbird/campaigns').send({ name: 'Pune offices', product_description: 'Office booking software for small teams', max_emails_per_day: 10 });
    expect(r.status).toBe(201);
    campaign = r.body;
  });

  test('2. adding a company reads its website, picks the address found there and drafts 3 emails for your OK', async () => {
    const r = await request(app).post('/api/sellbird/companies').send({ campaign_id: campaign.id, domain: 'https://acme.example' });
    expect(r.status).toBe(201);
    acme = r.body;
    // their own address, not the web agency's from the footer
    expect(acme.contact).toMatchObject({ email: 'hello@acme.example', email_status: 'verified', full_name: 'Ravi Kumar' });
    expect(acme.company.name).toBe('Acme Interiors'); // not the whole page title
    expect(acme.outbox.map((o) => o.status)).toEqual(['pending_approval', 'pending_approval', 'pending_approval']);
    const [first] = acme.outbox;
    expect(first.body).toMatch(/^Hi Ravi,/);
    expect(first.body).toMatch(/Office booking software/);
    expect(first.body).toMatch(/BrightDesk$/); // signed with the business name, not "Growth Team"
    expect(first.body + first.subject).not.toMatch(/\[|\{\{|gate pass|invoices|Pune offices/i);
  });

  test('3. an address that isn’t on their website is marked “guessed”; a site that won’t open isn’t added', async () => {
    const beta = await request(app).post('/api/sellbird/companies').send({ campaign_id: campaign.id, domain: 'beta.example' });
    expect(beta.status).toBe(201);
    expect(beta.body.contact).toMatchObject({ email: 'contact@beta.example', email_status: 'guessed' });
    expect(beta.body.outbox[0].body).toMatch(/^Hello,/); // no "Hi Beta"

    const bad = await request(app).post('/api/sellbird/companies').send({ campaign_id: campaign.id, domain: 'nowhere.example' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Couldn’t add nowhere\.example/);
    expect(await knex('sellbird_companies').where({ domain: 'nowhere.example' }).first()).toBeUndefined();

    const many = await request(app).post('/api/sellbird/discover-real').send({ targets: ['gamma.example', 'nowhere.example'] });
    expect(many.body).toMatchObject({ count: 1, skipped: [{ domain: 'nowhere.example' }] });
  });

  test('4. approving all three: the first goes out now, follow-ups wait their turn', async () => {
    const ids = acme.outbox.map((o) => o.id);
    const r = await request(app).post('/api/sellbird/outbox/batch-approve').send({ ids });
    expect(r.body.approved).toBe(3);
    // approved 5 days after the drafts were written: by the plan step 2 is already due
    await knex('sellbird_outbox').whereIn('id', ids).update({ scheduled_at: knex.raw('scheduled_at - ?', [5 * DAY]) });

    expect((await send()).sent).toBe(1);
    expect(mockMails).toHaveLength(1);
    expect(mockMails[0]).toMatchObject({ to: 'hello@acme.example', from: 'Asha <me@mybiz.example>' });
    const [s1, s2, s3] = await outboxFor(acme.contact.id);
    expect(s1.status).toBe('sent');
    expect(s2.status).toBe('approved');
    expect(s2.scheduled_at).toBeGreaterThan(now() + 2 * DAY); // moved to ~3 days after step 1 really went out
    expect(s3.status).toBe('approved');

    // a sent email can't be approved again (that sent it twice) or cancelled
    expect((await request(app).patch(`/api/sellbird/outbox/${s1.id}/approve`)).status).toBe(400);
    expect((await request(app).patch(`/api/sellbird/outbox/${s1.id}/reject`)).status).toBe(400);
    await send();
    await send();
    expect(mockMails).toHaveLength(1);
    // the waiting follow-up keeps its date (it used to drift later on every run)
    expect((await knex('sellbird_outbox').where({ id: s2.id }).first()).scheduled_at).toBe(s2.scheduled_at);
  });

  test('5. three days later the follow-up goes out', async () => {
    const [s1, s2] = await outboxFor(acme.contact.id);
    await knex('sellbird_outbox').where({ id: s1.id }).update({ sent_at: now() - 4 * DAY });
    await knex('sellbird_outbox').where({ id: s2.id }).update({ scheduled_at: now() - 10 });
    expect((await send()).sent).toBe(1);
    expect((await knex('sellbird_outbox').where({ id: s2.id }).first()).status).toBe('sent');
    expect(mockMails[1].subject).toMatch(/^Re: /);
  });

  test('6. an email with a blank like [Name] can’t be approved and isn’t sent', async () => {
    const [, , s3] = await outboxFor(acme.contact.id);
    await knex('sellbird_outbox').where({ id: s3.id }).update({ status: 'pending_approval' });
    await request(app).patch(`/api/sellbird/outbox/${s3.id}`).send({ body: 'Hi [Name], last note.' });
    const r = await request(app).patch(`/api/sellbird/outbox/${s3.id}/approve`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/\[Name\]/);
    await request(app).patch(`/api/sellbird/outbox/${s3.id}`).send({ body: 'Hi Ravi, last note from me.\n\nBrightDesk' });
    expect((await request(app).patch(`/api/sellbird/outbox/${s3.id}/approve`)).status).toBe(200);
  });

  test('7. when they reply: follow-ups stop, the company shows “replied”, you answer', async () => {
    const r = await request(app).post('/api/sellbird/replies/simulate').send({ sender_email: 'Hello@Acme.example', message_text: 'Sounds good, can we have a call next week?' });
    expect(r.status).toBe(201);
    expect(r.body.intent_category).toBe('interested');
    expect(r.body.ai_drafted_reply).not.toMatch(/11:00 AM|3:00 PM/); // no made-up time slots

    const [, , s3] = await outboxFor(acme.contact.id);
    expect(s3).toMatchObject({ status: 'rejected', error_message: 'Not sent: they replied.' });
    expect((await knex('sellbird_companies').where({ id: acme.company.id }).first()).status).toBe('replied');

    // the Replies screen gets who they are and the email of ours they answered
    const listed = (await request(app).get('/api/sellbird/replies')).body.find((x) => x.id === r.body.id);
    expect(listed).toMatchObject({ contact_name: 'Ravi Kumar', company_name: 'Acme Interiors', campaign_name: 'Pune offices' });
    expect(listed.last_sent).toMatchObject({ step_number: 2, subject: 'Re: A question for Acme Interiors' });
    expect((await request(app).get('/api/sellbird/stats')).body.replies_to_answer).toBe(1);

    const contacts = (await request(app).get('/api/sellbird/contacts')).body;
    expect(contacts.find((c) => c.id === acme.contact.id).last_sent_at).toBeGreaterThan(0);

    const ans = await request(app).post(`/api/sellbird/replies/${r.body.id}/send`).send({ ai_drafted_reply: 'Great — does Tuesday 4 pm work? <b>R&D</b>' });
    expect(ans.status).toBe(200);
    // no subject pasted: it answers under the subject of our email
    const last = mockMails[mockMails.length - 1];
    expect(last).toMatchObject({ to: 'Hello@Acme.example', subject: 'Re: A question for Acme Interiors' });
    expect(last.html).toContain('&lt;b&gt;R&amp;D&lt;/b&gt;'); // text stays text in the HTML version
    // answering twice is refused (it sent a second email)
    expect((await request(app).post(`/api/sellbird/replies/${r.body.id}/send`).send({ ai_drafted_reply: 'again' })).status).toBe(400);
    expect((await request(app).get('/api/sellbird/stats')).body.replies_to_answer).toBe(0);
    // reply edits can only change the answer and its state
    await request(app).patch(`/api/sellbird/replies/${r.body.id}`).send({ status: 'pending_review', sender_email: 'x@evil.example' });
    expect((await knex('sellbird_replies').where({ id: r.body.id }).first()).sender_email).toBe('Hello@Acme.example');
  });

  test('8. someone who asks to stop is never emailed again, by any campaign', async () => {
    const beta = await knex('sellbird_contacts').where({ email: 'contact@beta.example' }).first();
    await request(app).post('/api/sellbird/replies/simulate').send({ sender_email: 'contact@beta.example', message_text: 'Please stop emailing us.' });
    const other = (await request(app).post('/api/sellbird/campaigns').send({ name: 'Second try' })).body;
    const company = await knex('sellbird_companies').where({ id: beta.company_id }).first();
    const [o] = await knex('sellbird_outbox').insert({ workspace_id: ws, campaign_id: other.id, contact_id: beta.id, step_number: 1, subject: 'Hi again', body: 'Hello,\n\nAnother idea.', status: 'approved', scheduled_at: now() - 5, created_at: now(), updated_at: now() }).returning('id');
    const before = mockMails.length;
    await send();
    expect(mockMails.length).toBe(before);
    expect((await knex('sellbird_outbox').where({ id: o?.id ?? o }).first()).status).toBe('rejected');
    expect(company).toBeTruthy();
  });

  test('9. a follow-up whose first email was cancelled is never sent', async () => {
    const gamma = await knex('sellbird_contacts').where({ email: 'team@gamma.example' }).first();
    const [s1, s2] = await outboxFor(gamma.id);
    await request(app).patch(`/api/sellbird/outbox/${s1.id}/reject`);
    await request(app).patch(`/api/sellbird/outbox/${s2.id}/approve`);
    await knex('sellbird_outbox').where({ id: s2.id }).update({ scheduled_at: now() - 5 });
    await send();
    expect((await knex('sellbird_outbox').where({ id: s2.id }).first())).toMatchObject({ status: 'rejected', error_message: 'Not sent: the email before it wasn’t sent.' });
  });

  test('10. the numbers on screen match what happened', async () => {
    const s = (await request(app).get('/api/sellbird/stats')).body;
    expect(s.sent_outreach).toBe(2);
    expect(s.total_replies).toBe(2);
    expect(s.sender).toEqual({ email: 'me@mybiz.example', name: 'Asha' });
  });
});
