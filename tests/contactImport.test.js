// Import contacts from a spreadsheet: reading the columns, and the checks that
// the preview and the real import share (duplicates, opted out, dead domains).
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const { parseContacts } = require('../services/sellbird/contactImport');

jest.mock('../services/sellbird/aiEngine', () => ({
  ...jest.requireActual('../services/sellbird/aiEngine'),
  generateOutreachSequence: jest.fn(async () => [
    { step: 1, delay_days: 0, subject: 'Hello', body: 'Body one' },
    { step: 2, delay_days: 3, subject: 'Re: Hello', body: 'Body two' },
  ]),
}));

const csv = (s) => Buffer.from(s, 'utf8');

describe('parseContacts', () => {
  test('finds columns by their names, in any order', () => {
    const r = parseContacts(csv('Company,E-mail,Job Title,Full Name,Website\nAcme,asha@acme.in,Founder,Asha Rao,https://www.acme.in/about\n'));
    expect(r.counts).toEqual({ ok: 1, failed: 0, total: 1 });
    expect(r.rows[0].contact).toMatchObject({ full_name: 'Asha Rao', role: 'Founder', email: 'asha@acme.in', company: 'Acme', domain: 'acme.in' });
  });

  test('joins first and last name; company domain comes from a work email', () => {
    const r = parseContacts(csv('First name,Last name,Email\nVikram,Shah,vikram@sample.in\n'));
    expect(r.rows[0].contact).toMatchObject({ full_name: 'Vikram Shah', domain: 'sample.in', company: 'Sample' });
  });

  test('a personal mailbox has no company domain', () => {
    const r = parseContacts(csv('Name,Email\nRiya,riya@gmail.com\n'));
    expect(r.rows[0].contact).toMatchObject({ domain: '', company: 'Individual contacts' });
  });

  test('says what is wrong with a row, and skips repeats', () => {
    const r = parseContacts(csv('Name,Email\nA,\nB,not-an-email\nC,c@x.com\nD,C@X.com\n'));
    expect(r.rows.map((x) => x.ok)).toEqual([false, false, true, false]);
    expect(r.rows[0].error).toMatch(/No email/);
    expect(r.rows[1].error).toMatch(/isn’t a valid email/);
    expect(r.rows[3].error).toMatch(/earlier in the file/);
    expect(r.rows[0].line).toBe(2); // spreadsheet row numbers, header is row 1
  });

  test('asks for an Email column when there is none', () => {
    expect(() => parseContacts(csv('Name,Phone\nA,123\n'))).toThrow(/Email/);
    expect(() => parseContacts(csv(''))).toThrow(/empty/);
  });
});

describe('POST /contacts/import', () => {
  let knex, app, wsId, campaignId, contactsModule;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [o] = await knex('organizations').insert({ name: 'Imp Org', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'Imp', slug: 'imp' }).returning('id');
    wsId = w?.id ?? w;
    campaignId = (await require('../repos/sellbirdRepo')(knex).createCampaign(wsId, { name: 'Import test' })).id;

    // Every domain takes mail except "nomail.test"
    contactsModule = require('../services/sellbird/contacts');
    jest.spyOn(contactsModule, 'verifyMxRecord').mockImplementation(async (d) => d !== 'nomail.test');

    app = express();
    app.use((req, res, next) => { req.workspaceId = wsId; req.session = { userId: 1 }; next(); });
    app.use('/api/sellbird', require('../routes/sellbird')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  const send = (body, q = '') => request(app).post(`/api/sellbird/contacts/import?campaign_id=${campaignId}${q}`)
    .set('Content-Type', 'application/octet-stream').set('X-File-Name', 'people.csv').send(body);
  const FILE = 'Name,Email,Role,Company\nAsha Rao,asha@acme.in,Founder,Acme\nBob,bob@nomail.test,CEO,Nomail\nCy,cy@acme.in,CTO,Acme\n';

  test('needs a campaign', async () => {
    const r = await request(app).post('/api/sellbird/contacts/import').set('Content-Type', 'application/octet-stream').send(FILE);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/campaign/i);
  });

  test('preview saves nothing and flags a domain that cannot receive mail', async () => {
    const r = await send(FILE, '&dry_run=1');
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ ok: 2, failed: 1, total: 3 });
    expect(r.body.rows[1]).toMatchObject({ ok: false, reason: 'bad_domain' });
    expect(await knex('sellbird_contacts').where({ workspace_id: wsId })).toHaveLength(0);
  });

  test('imports the good rows, groups them by company, and writes emails for approval', async () => {
    const r = await send(FILE);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ imported: 2, skipped: 1 });
    const contacts = await knex('sellbird_contacts').where({ workspace_id: wsId });
    expect(contacts.map((c) => c.email).sort()).toEqual(['asha@acme.in', 'cy@acme.in']);
    expect(contacts.every((c) => c.email_status === 'verified')).toBe(true);
    expect(new Set(contacts.map((c) => c.company_id)).size).toBe(1); // both at Acme
    // the emails are written in the background; give it a moment
    for (let i = 0; i < 20 && (await knex('sellbird_outbox').where({ workspace_id: wsId })).length < 4; i++) await new Promise((x) => setTimeout(x, 50));
    const outbox = await knex('sellbird_outbox').where({ workspace_id: wsId });
    expect(outbox).toHaveLength(4);
    expect(outbox.every((o) => o.status === 'pending_approval')).toBe(true);
  });

  test('importing the same file again adds nobody', async () => {
    const r = await send(FILE);
    expect(r.status).toBe(400);
    expect(r.body.rows.filter((x) => x.reason === 'duplicate')).toHaveLength(2);
  });

  test('someone who asked not to be contacted is skipped', async () => {
    await knex('sellbird_replies').insert({ workspace_id: wsId, sender_email: 'Dee@acme.in', message_text: 'unsubscribe', intent_category: 'unsubscribe', created_at: 1, updated_at: 1 });
    const r = await send('Name,Email\nDee,dee@acme.in\nEve,eve@acme.in\n', '&dry_run=1');
    expect(r.body.rows[0]).toMatchObject({ ok: false, reason: 'opted_out' });
    expect(r.body.rows[1].ok).toBe(true);
  });

  test('another business’s contacts do not count as duplicates', async () => {
    const [w2] = await knex('workspaces').insert({ org_id: (await knex('organizations').first('id')).id, name: 'Other', slug: 'other' }).returning('id');
    const repo = require('../repos/sellbirdRepo')(knex);
    const camp = await repo.createCampaign(w2?.id ?? w2, { name: 'x' });
    const comp = await repo.addCompany(w2?.id ?? w2, camp.id, { name: 'Z', domain: 'z.com' });
    await repo.addContact(w2?.id ?? w2, comp.id, { full_name: 'Zed', email: 'zed@z.com' });
    const r = await send('Name,Email\nZed,zed@z.com\n', '&dry_run=1');
    expect(r.body.rows[0].ok).toBe(true);
  });
});
