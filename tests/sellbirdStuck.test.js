// An outreach email must never sit on "Sending…" forever: a send that hangs gives up after a
// while, and one cut off by a restart is marked failed (not sent again by itself: it may have gone out).
process.env.SELLBIRD_SEND_TIMEOUT_MS = '200';
process.env.SMTP_HOST = '8.8.8.8'; process.env.SMTP_USER = 'me@biz.test'; process.env.SMTP_PASS = 'x'; process.env.SMTP_FROM = 'me@biz.test';
delete process.env.MAIL_PROVIDER;

const { makeTestKnex } = require('./helpers/db');
const smtpSettings = require('../services/smtpSettings');
const dispatcher = require('../services/sellbird/dispatcher');

describe('stuck sending', () => {
  let knex, repo, wsId, camp, n = 0;
  const now = () => Math.floor(Date.now() / 1000);

  const addMail = async (status, { updated = now(), email } = {}) => {
    n++;
    const co = await repo.addCompany(wsId, camp, { name: `Co${n}`, domain: `co${n}.test` });
    const c = await repo.addContact(wsId, co.id, { full_name: `P${n}`, email: email || `p${n}@co${n}.test`, email_status: 'verified' });
    const it = await repo.addOutboxItem(wsId, { campaign_id: camp, contact_id: c.id, step_number: 1, subject: 'Hello', body: 'Body', status, scheduled_at: now() - 60 });
    await knex('sellbird_outbox').where({ id: it.id }).update({ status, updated_at: updated });
    return it.id;
  };
  const row = (id) => knex('sellbird_outbox').where({ id }).first();

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [o] = await knex('organizations').insert({ name: 'Stuck Org', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'Stuck', slug: 'stuck' }).returning('id');
    wsId = w?.id ?? w;
    repo = require('../repos/sellbirdRepo')(knex);
    camp = (await repo.createCampaign(wsId, { name: 'Stuck' })).id;
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  test('only emails stuck on "sending" for a while are marked failed, with advice', async () => {
    const stale = await addMail('sending', { updated: now() - 3600 });
    const fresh = await addMail('sending', { updated: now() - 5 });      // being sent right now
    const sent = await addMail('sent', { updated: now() - 3600 });
    const approved = await addMail('approved', { updated: now() - 3600 });
    expect(await dispatcher.recoverInterruptedSending(knex, 600)).toBe(1);
    expect(await row(stale)).toMatchObject({ status: 'failed' });
    expect((await row(stale)).error_message).toMatch(/interrupted.*check your sent mail/);
    expect((await row(fresh)).status).toBe('sending');
    expect((await row(sent)).status).toBe('sent');
    expect((await row(approved)).status).toBe('approved');
    // at start-up nothing is being sent, so everything on "sending" was cut off
    expect(await dispatcher.recoverInterruptedSending(knex, 0)).toBe(1);
    expect((await row(fresh)).status).toBe('failed');
  });

  test('a send that never answers gives up, is marked failed, and the next email still goes out', async () => {
    await knex('sellbird_outbox').del();
    const hung = await addMail('approved', { email: 'hung@slow.test' });
    const fine = await addMail('approved', { email: 'fine@ok.test' });
    const sentTo = [];
    jest.spyOn(smtpSettings, 'createTransport').mockResolvedValue({
      sendMail: (m) => (m.to === 'hung@slow.test' ? new Promise(() => {}) : Promise.resolve({ messageId: 'x' }).then((r) => { sentTo.push(m.to); return r; })),
    });
    const t0 = Date.now();
    const r = await dispatcher.processDueOutbox(knex, repo, { enableJitter: false });
    expect(Date.now() - t0).toBeLessThan(3000);                 // it did not wait forever
    expect(r.sent).toBe(1);
    expect(await row(hung)).toMatchObject({ status: 'failed' });
    expect((await row(hung)).error_message).toMatch(/did not answer in time/);
    expect((await row(fine)).status).toBe('sent');
    expect(sentTo).toEqual(['fine@ok.test']);
  });

  test('every check also clears an email stuck on "sending"', async () => {
    await knex('sellbird_outbox').del();
    const stuck = await addMail('sending', { updated: now() - 3600 });
    await dispatcher.processDueOutbox(knex, repo, { enableJitter: false });
    expect((await row(stuck)).status).toBe('failed');
  });
});
