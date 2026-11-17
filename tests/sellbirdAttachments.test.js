// Files attached to a campaign's outreach emails: only safe, real files; the first email carries
// them all, follow-ups only the files marked "every email"; one business never sees another's.
process.env.SMTP_HOST = '8.8.8.8'; process.env.SMTP_USER = 'me@biz.test'; process.env.SMTP_PASS = 'x'; process.env.SMTP_FROM = 'me@biz.test';
delete process.env.MAIL_PROVIDER;

const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const att = require('../services/sellbird/attachments');
const smtpSettings = require('../services/smtpSettings');
const dispatcher = require('../services/sellbird/dispatcher');

const PDF = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n${extra}%%EOF`);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe('what may be attached', () => {
  const ok = (name, buffer, more = {}) => att.check({ name, buffer, ...more });

  test('real documents and images are accepted, typed by their extension', () => {
    expect(ok('Brochure.pdf', PDF())).toMatchObject({ filename: 'Brochure.pdf', contentType: 'application/pdf' });
    expect(ok('logo.PNG', PNG)).toMatchObject({ contentType: 'image/png' });
    expect(ok('prices.csv', Buffer.from('a,b\n1,2\n'))).toMatchObject({ contentType: 'text/csv' });
    expect(ok('deck.pptx', Buffer.concat([Buffer.from('PK'), Buffer.alloc(10)]))).toMatchObject({ contentType: expect.stringContaining('presentationml') });
  });

  test('anything that can run, or is not a plain document, is refused', () => {
    for (const bad of ['setup.exe', 'run.js', 'page.html', 'pic.svg', 'bundle.zip', 'macro.bat', 'tool.jar', 'noext', 'weird.pdf.exe', 'x.php']) {
      expect(() => ok(bad, PDF())).toThrow(/can not be attached|no name/);
    }
  });

  test('a file that is not what its name says is refused', () => {
    expect(() => ok('fake.pdf', Buffer.from('MZ this is a program'))).toThrow(/not a real \.pdf/);
    expect(() => ok('fake.png', PDF())).toThrow(/not a real \.png/);
    expect(() => ok('fake.txt', Buffer.from([0x41, 0x00, 0x42]))).toThrow(/not a real \.txt/);
    expect(() => ok('empty.pdf', Buffer.alloc(0))).toThrow(/empty/);
  });

  test('size and count limits, and file names can not point at folders', () => {
    expect(() => ok('big.pdf', PDF('x'.repeat(att.MAX_FILE)))).toThrow(/too large/);
    expect(() => ok('a.pdf', PDF(), { existingCount: att.MAX_FILES })).toThrow(/at most 5/);
    expect(() => ok('a.pdf', PDF('x'.repeat(2000)), { existingBytes: att.MAX_TOTAL - 100 })).toThrow(/in all|at most/);
    expect(att.cleanName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(att.cleanName('C:\\Users\\me\\My file.pdf')).toBe('My file.pdf');
    expect(att.cleanName('bad\r\nname<>.pdf')).not.toMatch(/[\r\n<>]/);
  });
});

describe('attachments of a campaign', () => {
  let knex, app, repo, wsId, otherWs, camp, otherCamp;
  const upload = (campId, name, buf, ws = wsId, q = '') => request(app).post(`/api/sellbird/campaigns/${campId}/attachments${q}`)
    .set('x-ws', String(ws)).set('Content-Type', 'application/octet-stream').set('X-File-Name', encodeURIComponent(name)).send(buf);
  const now = () => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [o] = await knex('organizations').insert({ name: 'Att Org', owner_user_id: 1 }).returning('id');
    const orgId = o?.id ?? o;
    const mk = async (slug) => { const [w] = await knex('workspaces').insert({ org_id: orgId, name: slug, slug }).returning('id'); return w?.id ?? w; };
    wsId = await mk('att-one'); otherWs = await mk('att-two');
    repo = require('../repos/sellbirdRepo')(knex);
    camp = (await repo.createCampaign(wsId, { name: 'One' })).id;
    otherCamp = (await repo.createCampaign(otherWs, { name: 'Two' })).id;
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = Number(req.headers['x-ws'] || wsId); req.session = { userId: 1 }; next(); });
    app.use('/api/sellbird', require('../routes/sellbird')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  test('upload, list (never the file contents), change when it is sent, remove', async () => {
    const r = await upload(camp, 'Brochure.pdf', PDF('hello'));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ filename: 'Brochure.pdf', content_type: 'application/pdf', send_with: 'first' });
    expect(r.body.data).toBeUndefined();

    const list = await request(app).get(`/api/sellbird/campaigns/${camp}/attachments`);
    expect(list.body.attachments).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('hello');
    expect(list.body.limits).toMatchObject({ max_files: 5 });

    const patched = await request(app).patch(`/api/sellbird/attachments/${r.body.id}`).send({ send_with: 'all' });
    expect(patched.body.send_with).toBe('all');
    const del = await request(app).delete(`/api/sellbird/attachments/${r.body.id}`);
    expect(del.status).toBe(200);
    expect((await request(app).get(`/api/sellbird/campaigns/${camp}/attachments`)).body.attachments).toHaveLength(0);
  });

  test('bad uploads are refused with a reason; the count limit holds', async () => {
    expect((await upload(camp, 'tool.exe', PDF())).body.error).toMatch(/can not be attached/);
    expect((await upload(camp, 'fake.pdf', Buffer.from('not a pdf'))).body.error).toMatch(/not a real/);
    for (let i = 0; i < att.MAX_FILES; i++) expect((await upload(camp, `f${i}.pdf`, PDF(String(i)))).status).toBe(201);
    const sixth = await upload(camp, 'six.pdf', PDF());
    expect(sixth.status).toBe(400);
    expect(sixth.body.error).toMatch(/at most 5/);
    await knex('sellbird_attachments').where({ campaign_id: camp }).del();
  });

  test('another business can not see, change, remove or add to this campaign’s files', async () => {
    const mine = await upload(camp, 'mine.pdf', PDF('secret'));
    expect((await request(app).get(`/api/sellbird/campaigns/${camp}/attachments`).set('x-ws', String(otherWs))).status).toBe(404);
    expect((await upload(camp, 'intruder.pdf', PDF(), otherWs)).status).toBe(404);
    expect((await request(app).patch(`/api/sellbird/attachments/${mine.body.id}`).set('x-ws', String(otherWs)).send({ send_with: 'all' })).status).toBe(404);
    expect((await request(app).delete(`/api/sellbird/attachments/${mine.body.id}`).set('x-ws', String(otherWs))).status).toBe(404);
    expect(await knex('sellbird_attachments').where({ id: mine.body.id }).first()).toBeDefined();
    await knex('sellbird_attachments').where({ campaign_id: camp }).del();
  });

  test('the files that go with an email: first email all of them, follow-ups only the “every email” ones', async () => {
    const a = await upload(camp, 'first.pdf', PDF('a'));
    const b = await upload(camp, 'always.pdf', PDF('b'), wsId, '?send_with=all');
    expect(b.body.send_with).toBe('all');
    const names = async (step) => (await repo.attachmentsFor(wsId, camp, step)).map((x) => x.filename);
    expect(await names(1)).toEqual(['first.pdf', 'always.pdf']);
    expect(await names(2)).toEqual(['always.pdf']);
    expect(await names(3)).toEqual(['always.pdf']);
    expect(await repo.attachmentsFor(otherWs, camp, 1)).toEqual([]);          // not another business's
    const file = (await repo.attachmentsFor(wsId, camp, 1))[0];
    expect(Buffer.isBuffer(file.content)).toBe(true);
    expect(file.content.toString()).toContain('%PDF');
    expect(file.contentType).toBe('application/pdf');
    expect(a.status).toBe(201);
  });

  test('the sender attaches them: first email gets both files, the follow-up one, another campaign none', async () => {
    const sent = [];
    jest.spyOn(smtpSettings, 'createTransport').mockResolvedValue({ sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; } });
    const co = await repo.addCompany(wsId, camp, { name: 'Acme', domain: 'acme.test' });
    const c = await repo.addContact(wsId, co.id, { full_name: 'Asha', email: 'asha@acme.test', email_status: 'verified' });
    const mail = (step) => repo.addOutboxItem(wsId, { campaign_id: camp, contact_id: c.id, step_number: step, subject: `s${step}`, body: 'b', status: 'approved', scheduled_at: now() - 60 });
    await mail(1);
    await dispatcher.processDueOutbox(knex, repo, { enableJitter: false });
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments.map((x) => x.filename)).toEqual(['first.pdf', 'always.pdf']);
    expect(sent[0].attachments[0]).toMatchObject({ contentType: 'application/pdf' });

    // the follow-up goes a day later
    await mail(2);
    await knex('sellbird_outbox').where({ step_number: 1, contact_id: c.id }).update({ sent_at: now() - 2 * 86400 });
    await dispatcher.processDueOutbox(knex, repo, { enableJitter: false });
    expect(sent).toHaveLength(2);
    expect(sent[1].attachments.map((x) => x.filename)).toEqual(['always.pdf']);

    // a campaign with no files sends no attachments at all
    const co2 = await repo.addCompany(otherWs, otherCamp, { name: 'Beta', domain: 'beta.test' });
    const c2 = await repo.addContact(otherWs, co2.id, { full_name: 'Bo', email: 'bo@beta.test', email_status: 'verified' });
    await repo.addOutboxItem(otherWs, { campaign_id: otherCamp, contact_id: c2.id, step_number: 1, subject: 's', body: 'b', status: 'approved', scheduled_at: now() - 60 });
    await dispatcher.processDueOutbox(knex, repo, { enableJitter: false });
    expect(sent).toHaveLength(3);
    expect(sent[2].attachments).toBeUndefined();
  });
});
