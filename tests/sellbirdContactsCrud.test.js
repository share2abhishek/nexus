// Outreach: change or delete a contact, delete emails from the outbox, change the daily limit,
// and the AI never putting an address of its own into an email. All inside one business.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

jest.mock('../services/aiHelper', () => ({ ...jest.requireActual('../services/aiHelper'), aiJSON: jest.fn() }));
jest.mock('../services/sellbird/contacts', () => ({
  ...jest.requireActual('../services/sellbird/contacts'),
  // every domain takes mail, except nomail.test (no real DNS in tests)
  verifyContactEmail: jest.fn(async (e) => (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) && !/@nomail\.test$/i.test(e) ? { verified: true, status: 'verified' } : { verified: false, status: 'invalid' })),
}));

const aiHelper = require('../services/aiHelper');

describe('the AI never writes an address into an email', () => {
  const { generateOutreachSequence } = require('../services/sellbird/aiEngine');
  test('an address the AI makes up is removed and the drafts wait for a person', async () => {
    aiHelper.aiJSON.mockResolvedValue({ data: { steps: [
      { step: 1, delay_days: 0, subject: 'Hello', body: 'Hi Asha, write to sales@madeup-sender.com or reply here at asha@acme.in.' },
      { step: 2, delay_days: 3, subject: 'Follow up', body: 'Call us or mail ceo@fake-corp.io.' },
    ] } });
    const steps = await generateOutreachSequence(
      { product: { name: 'BrightDesk', description: 'Booking software', url: 'https://brightdesk.example' }, company: { name: 'Acme', domain: 'acme.in' }, contact: { full_name: 'Asha Rao', role: 'Founder', email: 'asha@acme.in' } },
      {},
    );
    const text = steps.map((s) => `${s.subject}\n${s.body}`).join('\n');
    expect(text).not.toMatch(/madeup-sender|fake-corp/);
    expect(text).toContain('asha@acme.in');   // the recipient's own address may stay
    expect(steps.flagged).toBe(true);          // changed by the safety screen: a person reads it first
  });
});

describe('contacts, outbox and daily limit', () => {
  let knex, app, wsId, otherWs, repo, campaignId, otherCampaign;
  const as = (ws) => ({ 'x-ws': String(ws) });
  const seed = async (ws, camp, name, email, mails = []) => {
    const co = await repo.addCompany(ws, camp, { name: `${name} Co`, domain: `${name.toLowerCase()}.test` });
    const c = await repo.addContact(ws, co.id, { full_name: name, role: 'Owner', email, email_status: 'verified' });
    const items = [];
    for (const [i, status] of mails.entries()) items.push(await repo.addOutboxItem(ws, { campaign_id: camp, contact_id: c.id, step_number: i + 1, subject: `s${i + 1}`, body: 'b', status, scheduled_at: 1 }));
    return { co, c, items };
  };

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [o] = await knex('organizations').insert({ name: 'Crud Org', owner_user_id: 1 }).returning('id');
    const orgId = o?.id ?? o;
    const mk = async (slug) => { const [w] = await knex('workspaces').insert({ org_id: orgId, name: slug, slug }).returning('id'); return w?.id ?? w; };
    wsId = await mk('crud-one'); otherWs = await mk('crud-two');
    repo = require('../repos/sellbirdRepo')(knex);
    campaignId = (await repo.createCampaign(wsId, { name: 'One' })).id;
    otherCampaign = (await repo.createCampaign(otherWs, { name: 'Two' })).id;
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = Number(req.headers['x-ws'] || wsId); req.session = { userId: 1 }; next(); });
    app.use('/api/sellbird', require('../routes/sellbird')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { await knex.destroy(); });

  test('update a contact: name and role, with checks on the address', async () => {
    const a = await seed(wsId, campaignId, 'Aaron', 'aaron@aaron.test');
    const b = await seed(wsId, campaignId, 'Bella', 'bella@bella.test');
    const ok = await request(app).patch(`/api/sellbird/contacts/${a.c.id}`).send({ full_name: '  Aaron   Smith ', role: 'Director' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ full_name: 'Aaron Smith', role: 'Director', email: 'aaron@aaron.test' });

    expect((await request(app).patch(`/api/sellbird/contacts/${a.c.id}`).send({ full_name: '   ' })).status).toBe(400);
    expect((await request(app).patch(`/api/sellbird/contacts/${a.c.id}`).send({ email: 'not an email' })).status).toBe(400);
    const taken = await request(app).patch(`/api/sellbird/contacts/${a.c.id}`).send({ email: 'BELLA@bella.test' });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatch(/already in your contacts/);
    const dead = await request(app).patch(`/api/sellbird/contacts/${a.c.id}`).send({ email: 'x@nomail.test' });
    expect(dead.status).toBe(400);
    expect(dead.body.error).toMatch(/can not receive email/);

    const changed = await request(app).patch(`/api/sellbird/contacts/${a.c.id}`).send({ email: ' Aaron.Smith@Aaron.test ' });
    expect(changed.body).toMatchObject({ email: 'aaron.smith@aaron.test', email_status: 'verified' });
  });

  test('another business can not change or delete this contact', async () => {
    const a = await seed(wsId, campaignId, 'Cara', 'cara@cara.test', ['pending_approval']);
    expect((await request(app).patch(`/api/sellbird/contacts/${a.c.id}`).set(as(otherWs)).send({ full_name: 'Hacked' })).status).toBe(404);
    const del = await request(app).delete(`/api/sellbird/contacts/${a.c.id}`).set(as(otherWs));
    expect(del.body.deleted).toBe(0);
    expect((await knex('sellbird_contacts').where({ id: a.c.id }).first()).full_name).toBe('Cara');
    expect(await knex('sellbird_outbox').where({ contact_id: a.c.id })).toHaveLength(1);
  });

  test('delete a contact: its emails go, and a company left empty goes too', async () => {
    const a = await seed(wsId, campaignId, 'Dara', 'dara@dara.test', ['pending_approval', 'approved']);
    const r = await request(app).delete(`/api/sellbird/contacts/${a.c.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ deleted: 1, removed_emails: 2, removed_companies: 1 });
    expect(await knex('sellbird_contacts').where({ id: a.c.id }).first()).toBeUndefined();
    expect(await knex('sellbird_companies').where({ id: a.co.id }).first()).toBeUndefined();
  });

  test('delete several at once; choosing none is refused; ids of another business are ignored', async () => {
    const x = await seed(wsId, campaignId, 'Eli', 'eli@eli.test', ['pending_approval']);
    const y = await seed(wsId, campaignId, 'Faye', 'faye@faye.test');
    const foreign = await seed(otherWs, otherCampaign, 'Gus', 'gus@gus.test', ['pending_approval']);
    expect((await request(app).post('/api/sellbird/contacts/delete').send({ ids: [] })).status).toBe(400);
    const r = await request(app).post('/api/sellbird/contacts/delete').send({ ids: [x.c.id, y.c.id, foreign.c.id] });
    expect(r.body.deleted).toBe(2);
    expect(await knex('sellbird_contacts').where({ id: foreign.c.id }).first()).toBeDefined();
    expect(await knex('sellbird_outbox').where({ contact_id: foreign.c.id })).toHaveLength(1);
  });

  test('delete an email from the outbox: its unsent follow-ups go with it', async () => {
    const a = await seed(wsId, campaignId, 'Hana', 'hana@hana.test', ['pending_approval', 'pending_approval', 'pending_approval']);
    const r = await request(app).delete(`/api/sellbird/outbox/${a.items[0].id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ deleted: 1, follow_ups_deleted: 2 });
    expect(await knex('sellbird_outbox').where({ contact_id: a.c.id })).toHaveLength(0);
    expect(await knex('sellbird_contacts').where({ id: a.c.id }).first()).toBeDefined(); // the contact stays
  });

  test('deleting only a follow-up leaves the first email; an email already sent can not be deleted', async () => {
    const a = await seed(wsId, campaignId, 'Iris', 'iris@iris.test', ['sent', 'approved', 'approved']);
    const sent = await request(app).delete(`/api/sellbird/outbox/${a.items[0].id}`);
    expect(sent.status).toBe(400);
    expect(sent.body.error).toMatch(/already gone out/);
    const f = await request(app).delete(`/api/sellbird/outbox/${a.items[1].id}`);
    expect(f.body).toMatchObject({ deleted: 1, follow_ups_deleted: 1 }); // step 3 goes with step 2
    const left = await knex('sellbird_outbox').where({ contact_id: a.c.id });
    expect(left.map((x) => x.status)).toEqual(['sent']);
  });

  test('bulk delete reports what was kept; another business’s emails are untouched', async () => {
    const a = await seed(wsId, campaignId, 'Jon', 'jon@jon.test', ['sent', 'pending_approval']);
    const b = await seed(wsId, campaignId, 'Kim', 'kim@kim.test', ['rejected']);
    const foreign = await seed(otherWs, otherCampaign, 'Lou', 'lou@lou.test', ['pending_approval']);
    expect((await request(app).post('/api/sellbird/outbox/delete').send({ ids: [] })).status).toBe(400);
    const r = await request(app).post('/api/sellbird/outbox/delete').send({ ids: [a.items[0].id, b.items[0].id, foreign.items[0].id] });
    expect(r.body).toMatchObject({ deleted: 1, kept_sent: 1 });
    expect(await knex('sellbird_outbox').where({ id: foreign.items[0].id }).first()).toBeDefined();
    expect(await knex('sellbird_outbox').where({ id: a.items[0].id }).first()).toBeDefined(); // the sent one stays
  });

  test('the daily limit is a whole number from 1 to 500 (25 is only the starting value)', async () => {
    const set = (n) => request(app).patch(`/api/sellbird/campaigns/${campaignId}`).send({ max_emails_per_day: n });
    expect((await set(40)).body.max_emails_per_day).toBe(40);
    expect((await set('60.4')).body.max_emails_per_day).toBe(60);
    expect((await set(100000)).body.max_emails_per_day).toBe(500);
    expect((await set(-5)).body.max_emails_per_day).toBe(1);
    expect((await set('abc')).body.max_emails_per_day).toBe(25);
    const created = await request(app).post('/api/sellbird/campaigns').send({ name: 'Default limit' });
    expect(created.body.max_emails_per_day).toBe(25);
  });
});
