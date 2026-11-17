// Email addresses in outreach come from the company's own website, never from the AI:
//  - an address the AI adds to a search result is ignored
//  - an address the AI writes into an email is removed (only the recipient's stays)
//  - "logo@2x.png" is not an address
//  - the same address / website is never added twice, and repeats already in the list can be cleaned
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const aiHelper = require('../services/aiHelper');
const safety = require('../services/aiSafety');

jest.mock('../services/sellbird/crawler', () => {
  const actual = jest.requireActual('../services/sellbird/crawler');
  const SITES = {
    'alpha.in': ['info@alpha.in', 'INFO@alpha.in', 'alpha-logo@2x.png'],
    'beta.in': ['hello@beta.in'],
    'bare.in': [],
    'shared.in': ['info@alpha.in'], // another site lists alpha's address
  };
  return {
    ...actual,
    crawlWebsite: jest.fn(async (domain) => {
      const d = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (!(d in SITES)) return { success: false, domain: d, description: '' };
      return { success: true, domain: d, title: `${d} | Builders`, description: '', buying_signals: { signals: [] }, text: '', links: [], emails: actual.extractEmails(SITES[d].join(' ')) };
    }),
  };
});
jest.mock('../services/sellbird/aiEngine', () => ({
  ...jest.requireActual('../services/sellbird/aiEngine'),
  generateOutreachSequence: jest.fn(async () => [{ step: 1, delay_days: 0, subject: 'Hello', body: 'Body one' }]),
}));

describe('found addresses', () => {
  const { extractEmails } = jest.requireActual('../services/sellbird/crawler');
  test('an image file name is not an address, and repeats (any case) count once', () => {
    expect(extractEmails('Mail info@alpha.in or INFO@Alpha.in, logo@2x.png, hero@3x.jpg, a@b.webp, sales@alpha.in')).toEqual(['info@alpha.in', 'sales@alpha.in']);
  });
});

describe('the AI can not put an address into an email', () => {
  test('only the recipient’s address stays in a written email', () => {
    const r = safety.screenEmail(
      { subject: 'Hello', body: 'Write to ceo@madeup-corp.com or asha@acme.in, or call.' },
      { allowedEmails: ['Asha@Acme.in'] },
    );
    expect(r.body).toContain('asha@acme.in');
    expect(r.body).not.toContain('madeup-corp');
    expect(r.changed).toBe(true);
    expect(safety.screenEmail({ subject: 's', body: 'No addresses here.' }, { allowedEmails: [] }).changed).toBe(false);
  });
});

describe('Sellbird adds each address once, from the website', () => {
  let knex, app, wsId, otherWs, campaignId, campaign2Id, listSpy;
  const ask = (body) => request(app).post('/api/sellbird/discover-by-type').send({ campaign_id: campaignId, business_type: 'builders', location: 'Pune', ...body });
  const add = (domain, campaign = campaignId) => request(app).post('/api/sellbird/companies').send({ campaign_id: campaign, domain });
  const aiSays = (list) => listSpy.mockResolvedValue({ model: 'm', data: list });

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [o] = await knex('organizations').insert({ name: 'Real Org', owner_user_id: 1 }).returning('id');
    const orgId = o?.id ?? o;
    const mk = async (slug) => { const [w] = await knex('workspaces').insert({ org_id: orgId, name: slug, slug }).returning('id'); return w?.id ?? w; };
    wsId = await mk('real-one'); otherWs = await mk('real-two');
    const repo = require('../repos/sellbirdRepo')(knex);
    campaignId = (await repo.createCampaign(wsId, { name: 'One' })).id;
    campaign2Id = (await repo.createCampaign(wsId, { name: 'Two' })).id;
    // every domain takes mail (no real DNS); the route takes this when it loads, so it is set before that
    jest.spyOn(require('../services/sellbird/contacts'), 'verifyContactEmail').mockImplementation(async (e) => (/^[^@s]+@[^@s]+.[a-z]{2,}$/i.test(e) ? { verified: true, status: 'verified' } : { verified: false, status: 'invalid' }));
    listSpy = jest.spyOn(aiHelper, 'aiList');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = Number(req.headers['x-ws'] || wsId); req.session = { userId: 1 }; next(); });
    app.use('/api/sellbird', require('../routes/sellbird')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  test('an address or person the AI adds to a search result is ignored: the address comes from the site', async () => {
    aiSays([
      { name: 'Alpha', domain: 'alpha.in', executive_email: 'ceo@fabricated-alpha.com', executive_name: 'Made Up Person', email: 'sales@fabricated.com' },
      { name: 'Bare', domain: 'bare.in', executive_email: 'founder@fabricated-bare.com' },
    ]);
    const r = await ask({});
    expect(r.status).toBe(200);
    const byDomain = Object.fromEntries(r.body.results.map((x) => [x.domain, x]));
    expect(byDomain['alpha.in'].contact_email).toBe('info@alpha.in');          // found on their website
    expect(byDomain['alpha.in'].email_status).toBe('verified');
    expect(byDomain['bare.in'].contact_email).toBe('contact@bare.in');           // nothing on the site: a labelled guess, not the AI's
    expect(byDomain['bare.in'].email_status).toBe('guessed');
    const all = (await knex('sellbird_contacts').where({ workspace_id: wsId })).map((c) => c.email);
    expect(all.join(' ')).not.toMatch(/fabricated/);
    expect((await knex('sellbird_contacts').where({ email: 'info@alpha.in' }).first()).full_name).not.toMatch(/Made Up/);
  });

  test('the same website is not added twice to a campaign', async () => {
    const again = await add('alpha.in');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already in this campaign/);
    const withWww = await add('https://www.alpha.in/about');
    expect(withWww.status).toBe(409);
    expect(await knex('sellbird_companies').where({ workspace_id: wsId, campaign_id: campaignId }).whereRaw("domain like '%alpha.in'").count({ n: '*' }).first().then((x) => Number(x.n))).toBe(1);
  });

  test('an address already in your contacts (any campaign) is not added again, and not emailed twice', async () => {
    const before = await knex('sellbird_outbox').where({ workspace_id: wsId }).count({ n: '*' }).first().then((x) => Number(x.n));
    const r = await add('shared.in', campaign2Id); // its site lists info@alpha.in, already a contact of campaign One
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/info@alpha\.in is already in your contacts/);
    expect(await knex('sellbird_companies').where({ domain: 'shared.in' }).first()).toBeUndefined();
    expect(await knex('sellbird_outbox').where({ workspace_id: wsId }).count({ n: '*' }).first().then((x) => Number(x.n))).toBe(before);
  });

  test('in a search the repeats are reported as skipped, the rest are added', async () => {
    aiSays([{ name: 'Alpha again', domain: 'alpha.in' }, { name: 'Beta', domain: 'beta.in' }]);
    const r = await ask({});
    expect(r.body.results.map((x) => x.domain)).toEqual(['beta.in']);
    expect(r.body.skipped[0]).toMatchObject({ domain: 'alpha.in' });
    expect(r.body.skipped[0].reason).toMatch(/already/);
  });

  test('"Specific websites": a site already in the campaign is skipped with the reason, the others are added', async () => {
    const r = await request(app).post('/api/sellbird/discover-real').send({ campaign_id: campaignId, targets: ['https://alpha.in', 'bare.in'] });
    expect(r.status).toBe(200);
    expect(r.body.targets.map((x) => x.domain)).toEqual([]); // alpha.in and bare.in are both already in this campaign from the earlier tests
    expect(r.body.skipped.map((x) => x.domain).sort()).toEqual(['alpha.in', 'bare.in']);
    expect(r.body.skipped[0].reason).toMatch(/already in this campaign/);
  });

  test('another business may have the same address (nothing is shared between businesses)', async () => {
    const repo = require('../repos/sellbirdRepo')(knex);
    const c = (await repo.createCampaign(otherWs, { name: 'Other' })).id;
    const r = await request(app).post('/api/sellbird/companies').set('x-ws', String(otherWs)).send({ campaign_id: c, domain: 'alpha.in' });
    expect(r.status).toBe(201);
    expect(r.body.contact.email).toBe('info@alpha.in');
  });

  test('repeats already in the list are cleaned: the one that emailed stays, unsent repeats go, other businesses are untouched', async () => {
    const repo = require('../repos/sellbirdRepo')(knex);
    const camp = (await repo.createCampaign(wsId, { name: 'Messy' })).id;
    const mkCo = (name, domain) => repo.addCompany(wsId, camp, { name, domain });
    const mkContact = (co, email) => repo.addContact(wsId, co.id, { full_name: 'X', email, email_status: 'verified' });
    const mkMail = (contact, status, step = 1) => repo.addOutboxItem(wsId, { campaign_id: camp, contact_id: contact.id, step_number: step, subject: 's', body: 'b', status, scheduled_at: 1 });

    // Address one: two contacts that never emailed, and one that did
    const k1 = await mkContact(await mkCo('Dup One', 'dup1.test'), 'repeat@dup.test');
    const k2 = await mkContact(await mkCo('Dup Two', 'dup2.test'), 'REPEAT@dup.test');
    const k3 = await mkContact(await mkCo('Dup Three', 'dup3.test'), 'repeat@dup.test');
    await mkMail(k1, 'pending_approval'); await mkMail(k2, 'approved'); await mkMail(k3, 'sent'); await mkMail(k3, 'approved', 2);
    // Address two: both already emailed
    const m1 = await mkContact(await mkCo('Both One', 'both1.test'), 'twice@both.test');
    const m2 = await mkContact(await mkCo('Both Two', 'both2.test'), 'twice@both.test');
    await mkMail(m1, 'sent'); await mkMail(m2, 'sent'); await mkMail(m2, 'approved', 2);
    // Another business with the same address
    const otherCamp = (await repo.createCampaign(otherWs, { name: 'O2' })).id;
    const other = await repo.addCompany(otherWs, otherCamp, { name: 'Other', domain: 'o.test' });
    const theirs = await repo.addContact(otherWs, other.id, { full_name: 'O', email: 'repeat@dup.test', email_status: 'verified' });

    const r = await request(app).post('/api/sellbird/contacts/dedupe').send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ addresses: 2, removed_contacts: 2, kept_with_history: 1, cancelled_emails: 3 });

    const alive = async (c) => !!(await knex('sellbird_contacts').where({ id: c.id }).first());
    expect(await alive(k3)).toBe(true);          // it already emailed: it stays
    expect(await alive(k1)).toBe(false);         // never emailed repeats are removed...
    expect(await alive(k2)).toBe(false);
    expect(await knex('sellbird_outbox').whereIn('contact_id', [k1.id, k2.id])).toHaveLength(0); // ...with their unsent emails
    expect((await knex('sellbird_outbox').where({ contact_id: k3.id, step_number: 2 }).first()).status).toBe('approved'); // the keeper's own follow-up is untouched
    expect(await knex('sellbird_companies').where({ domain: 'dup1.test' }).first()).toBeUndefined(); // a company left empty goes too

    expect(await alive(m1) && await alive(m2)).toBe(true);   // both emailed: history kept
    expect((await knex('sellbird_outbox').where({ contact_id: m2.id, step_number: 2 }).first()).status).toBe('rejected'); // but no second follow-up goes out
    expect(await alive(theirs)).toBe(true);                  // another business is not touched
  });
});
