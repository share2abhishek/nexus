// WhatsApp templates: list (only the business's own account), create with plain-language
// checks before Meta sees it, remember what each fill-in means, delete.
const request = require('supertest');
const express = require('express');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const whatsappCloud = require('../services/leadPipeline/whatsappCloud');

describe('WhatsApp templates', () => {
  let knex, app, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'Tpl Org', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'Tpl WS', slug: 'tpl-ws' }).returning('id');
    workspaceId = ws?.id ?? ws;
    const repo = require('../repos/leadPipelineRepo')(knex);
    await repo.getOrCreateConfig(workspaceId);
    await repo.updateConfig(workspaceId, { whatsapp_access_token: 'tok', whatsapp_business_account_id: 'MY_WABA', whatsapp_phone_number_id: 'PN' });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = workspaceId; req.session = { userId: 1 }; next(); });
    app.use('/api/lead-pipeline', require('../routes/leadPipeline')(knex, () => (req, res, next) => next()));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });
  beforeEach(() => { jest.restoreAllMocks(); whatsappCloud.clearTemplateCache('MY_WABA'); });

  const good = {
    name: 'diwali_offer', category: 'MARKETING', language: 'en', header: 'A treat for you',
    body: 'Hi {{1}}, enjoy {{2}} this Diwali. Reply STOP to stop these messages.',
    footer: 'Sweet Crumbs', buttons: [{ type: 'QUICK_REPLY', text: 'I’m interested' }, { type: 'URL', text: 'Order', url: 'https://sweet.example/order' }],
    fields: [{ key: 'name', label: 'Customer’s name', example: 'Priya' }, { key: 'offer', label: 'Offer', example: '20% off' }],
  };

  test('creating sends Meta the right template, with examples, and remembers the fill-ins', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { id: 'T1', status: 'PENDING', category: 'MARKETING' } });
    const r = await request(app).post('/api/lead-pipeline/whatsapp/templates').send(good);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, status: 'PENDING' });
    const [url, payload] = post.mock.calls[0];
    expect(url).toMatch(/\/MY_WABA\/message_templates$/);
    expect(payload.components.find(c => c.type === 'BODY').example.body_text).toEqual([['Priya', '20% off']]);
    expect(payload.components.find(c => c.type === 'BUTTONS').buttons).toEqual([
      { type: 'QUICK_REPLY', text: 'I’m interested' }, { type: 'URL', text: 'Order', url: 'https://sweet.example/order' },
    ]);
    const saved = await knex('whatsapp_template_fields').where({ workspace_id: workspaceId, name: 'diwali_offer' }).first();
    expect(JSON.parse(saved.fields_json)[0].label).toBe('Customer’s name');
  });

  test('mistakes Meta would reject are explained before anything is sent', async () => {
    const post = jest.spyOn(axios, 'post');
    const r = await request(app).post('/api/lead-pipeline/whatsapp/templates').send({
      ...good, body: '{{1}}, enjoy {{2}}', fields: [{ example: 'Priya' }, { example: '' }],
      buttons: [{ type: 'URL', text: 'Order', url: 'http://not-secure.example' }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/start or end with a fill-in/);
    expect(r.body.error).toMatch(/example for each fill-in/);
    expect(r.body.error).toMatch(/https:\/\//);
    expect(post).not.toHaveBeenCalled();
  });

  test('a name already in use gets a plain message', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({ response: { data: { error: { message: 'Content in this language already exists' } } } });
    const r = await request(app).post('/api/lead-pipeline/whatsapp/templates').send(good);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already exists/);
  });

  test('listing reads only this business’s account, with status, reason and fill-in meanings', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { data: [
      { id: 'T1', name: 'diwali_offer', status: 'APPROVED', category: 'MARKETING', language: 'en', components: [{ type: 'BODY', text: good.body }] },
      { id: 'T2', name: 'old_promo', status: 'REJECTED', rejected_reason: 'PROMOTIONAL', category: 'UTILITY', language: 'en', components: [{ type: 'BODY', text: 'Buy now' }] },
    ] } });
    const r = await request(app).get('/api/lead-pipeline/whatsapp/templates?forceRefresh=1');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toMatch(/\/MY_WABA\/message_templates/);
    expect(r.body.connected).toBe(true);
    expect(r.body.templates[0].fields[1].example).toBe('20% off');
    expect(r.body.templates[1].rejected_reason).toBe('PROMOTIONAL');
  });

  test('without a Business Account ID it says so instead of trying other accounts', async () => {
    await knex('meta_lead_configs').where({ workspace_id: workspaceId }).update({ whatsapp_business_account_id: null });
    const get = jest.spyOn(axios, 'get');
    const r = await request(app).get('/api/lead-pipeline/whatsapp/templates');
    expect(get).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ success: false, connected: false });
    expect(r.body.error).toMatch(/Business Account ID/);
    await knex('meta_lead_configs').where({ workspace_id: workspaceId }).update({ whatsapp_business_account_id: 'MY_WABA' });
  });

  test('deleting removes it at Meta and forgets its fill-ins', async () => {
    const del = jest.spyOn(axios, 'delete').mockResolvedValue({ data: { success: true } });
    const r = await request(app).delete('/api/lead-pipeline/whatsapp/templates/diwali_offer?id=T1&language=en');
    expect(r.status).toBe(200);
    expect(del.mock.calls[0][1].params).toEqual({ name: 'diwali_offer', hsm_id: 'T1' });
    expect(await knex('whatsapp_template_fields').where({ name: 'diwali_offer' }).first()).toBeUndefined();
  });
});
