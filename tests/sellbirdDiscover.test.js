// "Find companies → By Business Type & City (AI)": the AI is asked for a LIST of companies.
// A correct list used to be thrown away (only a single JSON object was read), so the screen
// said "Could not automatically identify domains" even though the AI had answered.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const aiHelper = require('../services/aiHelper');

jest.mock('../services/sellbird/crawler', () => ({
  crawlWebsite: jest.fn(async (domain) => (domain === 'closed.test'
    ? { success: false, domain, description: '' }
    : { success: true, domain, title: `${domain} | Builders`, description: 'We build', buying_signals: { signals: [] }, text: '', links: [], emails: [] })),
}));
jest.mock('../services/sellbird/aiEngine', () => ({
  ...jest.requireActual('../services/sellbird/aiEngine'),
  generateOutreachSequence: jest.fn(async () => [{ step: 1, delay_days: 0, subject: 'Hello', body: 'Body one' }]),
}));

describe('extractJsonList', () => {
  const { extractJsonList } = aiHelper;
  test('reads the list however the AI wrapped it', () => {
    const list = [{ name: 'A', domain: 'a.in' }, { name: 'B', domain: 'b.in' }];
    expect(extractJsonList(JSON.stringify(list))).toEqual(list);
    expect(extractJsonList('Sure! Here are the companies:\n```json\n' + JSON.stringify(list) + '\n```\nHope this helps.')).toEqual(list);
    expect(extractJsonList('Here: ' + JSON.stringify(list) + ' (verified)')).toEqual(list);
    expect(extractJsonList(JSON.stringify({ companies: list }))).toEqual(list);
    expect(extractJsonList(JSON.stringify({ businesses: list }))).toEqual(list);
    expect(extractJsonList(JSON.stringify({ name: 'Solo', domain: 'solo.in' }))).toEqual([{ name: 'Solo', domain: 'solo.in' }]);
  });
  test('keeps the complete entries of an answer that was cut off', () => {
    const cut = '[{"name":"A","domain":"a.in"},{"name":"B","domain":"b.in"},{"name":"C","dom';
    expect(extractJsonList(cut).map((x) => x.domain)).toEqual(['a.in', 'b.in']);
  });
  test('nothing usable gives null', () => {
    expect(extractJsonList('')).toBeNull();
    expect(extractJsonList('I could not find any companies.')).toBeNull();
  });
});

describe('POST /discover-by-type', () => {
  let knex, app, wsId, campaignId, listSpy;
  const ask = (body = {}) => request(app).post('/api/sellbird/discover-by-type').send({ campaign_id: campaignId, business_type: 'construction', location: 'Pune', count: 5, ...body });
  // What the AI said, read the same way the real aiList reads it
  const aiSays = (text) => listSpy.mockResolvedValue({ model: 'm', data: aiHelper.extractJsonList(text) || [] });

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [o] = await knex('organizations').insert({ name: 'Disc Org', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'Disc', slug: 'disc' }).returning('id');
    wsId = w?.id ?? w;
    campaignId = (await require('../repos/sellbirdRepo')(knex).createCampaign(wsId, { name: 'Disc test' })).id;
    jest.spyOn(require('../services/sellbird/contacts'), 'verifyMxRecord').mockResolvedValue(true);
    // the route takes aiList when it loads, so the stand-in has to exist before that
    listSpy = jest.spyOn(aiHelper, 'aiList');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = wsId; req.session = { userId: 1 }; next(); });
    app.use('/api/sellbird', require('../routes/sellbird')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  test('a correct list from the AI (a bare JSON array) is used', async () => {
    aiSays(JSON.stringify([
      { name: 'Alpha Builders', domain: 'https://www.alphabuilders.in/', city: 'Pune', industry: 'construction' },
      { name: 'Beta Infra', domain: 'betainfra.in', city: 'Pune', industry: 'construction' },
      { name: 'Placeholder', domain: 'example.com' },
    ]));
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.body.results.map((x) => x.domain).sort()).toEqual(['alphabuilders.in', 'betainfra.in']);
    expect(r.body.total_discovered).toBe(3);
  });

  test('the same list inside a code block and chatter still works', async () => {
    aiSays('Sure, here you go:\n```json\n[{"name":"Gamma","domain":"gamma.in"}]\n```');
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.body.results[0].domain).toBe('gamma.in');
  });

  test('a company whose website does not open is reported as skipped, not as a failure of the whole search', async () => {
    aiSays(JSON.stringify([{ name: 'Gone', domain: 'closed.test' }, { name: 'Delta', domain: 'delta.in' }]));
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.body.results.map((x) => x.domain)).toEqual(['delta.in']);
    expect(r.body.skipped[0].domain).toBe('closed.test');
  });

  test('when the AI itself fails, the real reason is shown (not "try a more specific category")', async () => {
    listSpy.mockRejectedValue(new Error('No AI key is set and Ollama is not running'));
    const r = await ask();
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/AI could not answer/);
    expect(r.body.error).toMatch(/Ollama is not running/);
    expect(r.body.error).toMatch(/Settings → AI/);
  });

  test('when the AI answers with no companies, the category advice is shown', async () => {
    aiSays('I am not able to find specific companies.');
    const r = await ask();
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/more specific category/);
  });

  test('a business type is required', async () => {
    expect((await ask({ business_type: '  ' })).status).toBe(400);
  });
});
