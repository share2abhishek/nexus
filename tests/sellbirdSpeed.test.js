// Why outreach felt stuck: (1) a cloud AI that kept timing out made every company wait through
// the same timeout again, and (2) due emails were only looked at every 15 minutes.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

const mockGenerate = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { generateContent: mockGenerate }; }
  },
}));
jest.mock('../services/sellbird/heartbeat', () => ({ runHeartbeat: jest.fn(async () => ({ success: true })), getLastRun: () => 0 }));
jest.mock('../services/entitlements', () => ({ ...jest.requireActual('../services/entitlements'), canPublish: jest.fn(async () => true) }));

const aiHelper = require('../services/aiHelper');
const heartbeat = require('../services/sellbird/heartbeat');
const entitlements = require('../services/entitlements');

describe('a cloud AI that is not answering is skipped for a while', () => {
  const KEY = 'AIza-test-key-123456';
  beforeEach(() => { aiHelper._resetCooldowns(); mockGenerate.mockReset(); });

  test('after a timeout the next request does not wait through it again', async () => {
    mockGenerate.mockRejectedValue(new Error('This operation was aborted'));
    await expect(aiHelper.aiGenerate('write', KEY, 100, null, { ollamaEnabled: false })).rejects.toThrow(/Gemini/);
    const callsAfterFirst = mockGenerate.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0); // it really tried (both Gemini models)
    expect(aiHelper.isCooling('gemini', KEY)).toBe(true);

    const t0 = Date.now();
    await expect(aiHelper.aiGenerate('write', KEY, 100, null, { ollamaEnabled: false })).rejects.toThrow(/skipped for a minute/);
    expect(mockGenerate.mock.calls.length).toBe(callsAfterFirst); // no new call to Gemini
    expect(Date.now() - t0).toBeLessThan(500);
  });

  test('it is tried again after the pause, and a working answer clears nothing it should keep', async () => {
    aiHelper.coolDown('gemini', KEY, 20);
    await new Promise((r) => setTimeout(r, 40));
    expect(aiHelper.isCooling('gemini', KEY)).toBe(false);
    mockGenerate.mockResolvedValue({ response: { text: () => 'hello' } });
    const r = await aiHelper.aiGenerate('write', KEY, 100, null, { ollamaEnabled: false });
    expect(r.text).toBe('hello');
  });

  test('a rejected key is reported as before and does not start a pause', async () => {
    mockGenerate.mockRejectedValue(Object.assign(new Error('API key not valid'), { status: 403 }));
    await expect(aiHelper.aiGenerate('write', KEY, 100, null, { ollamaEnabled: false })).rejects.toThrow();
    expect(aiHelper.isCooling('gemini', KEY)).toBe(false);
  });

  test('one account’s pause does not affect another key', async () => {
    aiHelper.coolDown('gemini', KEY);
    expect(aiHelper.isCooling('gemini', 'AIza-another-key-999999')).toBe(false);
  });
});

describe('approved emails go out without waiting for the next check', () => {
  let knex, app, wsId, otherWs, itemId;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [o] = await knex('organizations').insert({ name: 'Speed Org', owner_user_id: 1 }).returning('id');
    const orgId = o?.id ?? o;
    const mk = async (slug) => { const [w] = await knex('workspaces').insert({ org_id: orgId, name: slug, slug }).returning('id'); return w?.id ?? w; };
    wsId = await mk('speed-one'); otherWs = await mk('speed-two');
    const repo = require('../repos/sellbirdRepo')(knex);
    const camp = await repo.createCampaign(wsId, { name: 'Speed' });
    const company = await repo.addCompany(wsId, camp.id, { name: 'Acme', domain: 'acme.in' });
    const contact = await repo.addContact(wsId, company.id, { full_name: 'Asha Rao', email: 'asha@acme.in', email_status: 'verified' });
    const item = await repo.addOutboxItem(wsId, { campaign_id: camp.id, contact_id: contact.id, step_number: 1, subject: 'Hello', body: 'Body', status: 'pending_approval', scheduled_at: Math.floor(Date.now() / 1000) });
    itemId = item.id;
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = Number(req.headers['x-ws'] || wsId); req.session = { userId: 1 }; next(); });
    app.use('/api/sellbird', require('../routes/sellbird')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { await knex.destroy(); });
  beforeEach(() => { heartbeat.runHeartbeat.mockClear(); entitlements.canPublish.mockResolvedValue(true); });
  const tick = () => new Promise((r) => setTimeout(r, 30));

  test('approving sends that business’s due emails right away', async () => {
    const r = await request(app).patch(`/api/sellbird/outbox/${itemId}/approve`).send({});
    expect(r.status).toBe(200);
    await tick();
    expect(heartbeat.runHeartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeat.runHeartbeat.mock.calls[0][1]).toMatchObject({ workspaceId: wsId }); // only this business
  });

  test('no licence, no sending', async () => {
    entitlements.canPublish.mockResolvedValue(false);
    await knex('sellbird_outbox').where({ id: itemId }).update({ status: 'pending_approval' });
    await request(app).patch(`/api/sellbird/outbox/${itemId}/approve`).send({});
    await tick();
    expect(heartbeat.runHeartbeat).not.toHaveBeenCalled();
  });

  test('approving many at once sends once, and approving nothing sends nothing', async () => {
    await knex('sellbird_outbox').where({ id: itemId }).update({ status: 'pending_approval' });
    await request(app).post('/api/sellbird/outbox/batch-approve').send({ ids: [itemId] });
    await tick();
    expect(heartbeat.runHeartbeat).toHaveBeenCalledTimes(1);
    heartbeat.runHeartbeat.mockClear();
    await request(app).post('/api/sellbird/outbox/batch-approve').set('x-ws', String(otherWs)).send({ ids: [itemId] }); // not this business's email
    await tick();
    expect(heartbeat.runHeartbeat).not.toHaveBeenCalled();
  });
});
