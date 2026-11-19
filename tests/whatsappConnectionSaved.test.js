// A WhatsApp connection is saved in the database: connecting once keeps it connected on return,
// and the Business Account ID (needed for templates) is found from the token when not typed.
const request = require('supertest');
const express = require('express');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const whatsappCloud = require('../services/leadPipeline/whatsappCloud');

jest.mock('axios');

describe('detectWabaIds', () => {
  afterEach(() => jest.resetAllMocks());
  test('reads the WhatsApp account ids from the token', async () => {
    axios.get.mockResolvedValue({ data: { data: { granular_scopes: [
      { scope: 'business_management', target_ids: ['1'] },
      { scope: 'whatsapp_business_management', target_ids: ['777', '777'] },
      { scope: 'whatsapp_business_messaging', target_ids: ['777'] },
    ] } } });
    expect(await whatsappCloud.detectWabaIds('tok')).toEqual(['777']);
  });
  test('returns nothing when Meta says nothing or fails', async () => {
    axios.get.mockRejectedValue(new Error('nope'));
    expect(await whatsappCloud.detectWabaIds('tok')).toEqual([]);
    expect(await whatsappCloud.detectWabaIds('')).toEqual([]);
  });
});

describe('connect once, still connected on return', () => {
  let knex, app, ws;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const org = await knex('organizations').insert({ name: 'WA Saved Org', owner_user_id: 1 }).returning('id');
    const w = await knex('workspaces').insert({ org_id: org[0]?.id ?? org[0], name: 'WA Saved', slug: 'wa-saved' }).returning('id');
    ws = w[0]?.id ?? w[0];
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.workspaceId = ws; req.role = 'owner'; req.session = { userId: 1 }; next(); });
    app.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, () => (_q, _s, n) => n()));
  });
  afterAll(async () => { await knex.destroy(); });
  beforeEach(() => axios.get.mockReset());

  test('token, phone id and a typed Business Account ID are kept; the next visit sees them', async () => {
    axios.get.mockResolvedValue({ data: { verified_name: 'Urban Society', display_phone_number: '+91 90000 00000' } });
    const res = await request(app).post('/api/lead-pipeline/whatsapp/verify-connection')
      .send({ access_token: 'EAAtoken123', phone_number_id: '1111', waba_id: '2222' });
    expect(res.body).toMatchObject({ valid: true, waba_id: '2222', waba_missing: false });

    // a fresh request, as when the person comes back later
    const back = await request(app).get('/api/lead-pipeline/config');
    expect(back.body.config.whatsapp_access_token_set).toBe(true);
    expect(back.body.config.whatsapp_phone_number_id).toBe('1111');
    expect(back.body.config.whatsapp_business_account_id).toBe('2222');
    expect(JSON.stringify(back.body.config)).not.toContain('EAAtoken123'); // never sent back in full
  });

  test('a missing Business Account ID is found from the token and saved', async () => {
    await knex('meta_lead_configs').where({ workspace_id: ws }).update({ whatsapp_business_account_id: null });
    axios.get.mockImplementation((url) => Promise.resolve(/debug_token/.test(url)
      ? { data: { data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['9999'] }] } } }
      : { data: { verified_name: 'Urban Society' } }));
    const res = await request(app).post('/api/lead-pipeline/whatsapp/verify-connection')
      .send({ access_token: 'EAAtoken123', phone_number_id: '1111' });
    expect(res.body).toMatchObject({ valid: true, waba_id: '9999', waba_detected: true, waba_missing: false });
    expect((await knex('meta_lead_configs').where({ workspace_id: ws }).first()).whatsapp_business_account_id).toBe('9999');
  });

  test('when it cannot be found the caller is told so, and templates say it is the ID that is missing', async () => {
    await knex('meta_lead_configs').where({ workspace_id: ws }).update({ whatsapp_business_account_id: null });
    axios.get.mockImplementation((url) => Promise.resolve(/debug_token/.test(url) ? { data: { data: {} } } : { data: { verified_name: 'X' } }));
    const res = await request(app).post('/api/lead-pipeline/whatsapp/verify-connection')
      .send({ access_token: 'EAAtoken123', phone_number_id: '1111' });
    expect(res.body).toMatchObject({ valid: true, waba_missing: true });
    axios.get.mockResolvedValue({ data: { data: [] } });
    const t = await request(app).get('/api/lead-pipeline/whatsapp/templates');
    expect(t.body).toMatchObject({ connected: false, waba_missing: true });
  });
});
