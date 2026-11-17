// Contact auto-sync to Google Sheets and Salesforce: what is sent, only new/changed
// contacts, no duplicates, safe addresses, no secret leaks, and one business never
// touching another's sheet, Salesforce or contacts.
const express = require('express');
const request = require('supertest');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const repoFactory = require('../repos/leadPipelineRepo');
const cs = require('../services/contactSync');

describe('contactSync', () => {
  let knex, repo, ws1, ws2, app, calls, reqSpy, responder;
  const allow = () => (req, res, next) => next();
  const now = () => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret';
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'Sync Org', owner_user_id: 1 }).returning('id');
    const orgId = org?.id ?? org;
    const mk = async (slug) => { const [w] = await knex('workspaces').insert({ org_id: orgId, name: slug, slug }).returning('id'); return w?.id ?? w; };
    ws1 = await mk('sync-one'); ws2 = await mk('sync-two');
    repo = repoFactory(knex);
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.workspaceId = Number(req.headers['x-ws']); req.session = { userId: 1 }; next(); });
    app.use('/api/contact-sync', require('../routes/contactSync')(knex, allow));
  });
  afterAll(async () => { jest.restoreAllMocks(); await knex.destroy(); });

  beforeEach(async () => {
    await knex('contact_sync_state').del();
    await knex('contact_sync_configs').del();
    await knex('lead_activities').del();
    await knex('meta_lead_events').del();
    calls = [];
    responder = () => ({ data: {} });
    reqSpy = jest.spyOn(axios, 'request').mockImplementation(async (opts) => { calls.push(opts); return responder(opts); });
  });
  afterEach(() => reqSpy.mockRestore());

  const addLead = (ws, data) => repo.addLeadEvent(ws, { source: 'MANUAL', ...data });
  const cfg = (ws, extra) => knex('contact_sync_configs').insert({ workspace_id: ws, created_at: now(), updated_at: now(), ...extra });

  // ── Safe Salesforce address ────────────────────────────────────────────────
  test('only Salesforce addresses are accepted', () => {
    expect(cs.sfBase('https://acme.my.salesforce.com')).toBe('https://acme.my.salesforce.com');
    expect(cs.sfBase('acme.my.salesforce.com/path')).toBe('https://acme.my.salesforce.com');
    expect(cs.sfBase('https://acme.my.site.force.com')).toBe('https://acme.my.site.force.com');
    for (const bad of ['http://acme.my.salesforce.com', 'https://localhost:3000', 'https://169.254.169.254', 'https://salesforce.com.evil.test', 'https://evil.test/.salesforce.com', 'https://user:pw@acme.my.salesforce.com', 'not a url']) {
      expect(() => cs.sfBase(bad)).toThrow();
    }
  });

  test('what is sent for a contact: sheet row and Salesforce body', async () => {
    const l = await addLead(ws1, { full_name: 'Priya Sharma Rao', phone_number: '919000000001', email: 'p@x.test', society: 'Green Heights', intent_summary: 'wants a demo', lead_score: 85 });
    const rec = cs.toRecord(l, { kind: 'call', actor_name: 'Ana', body: 'Spoke about pricing' });
    const row = cs.sheetRow(rec);
    expect(row).toHaveLength(cs.COLUMNS.length);
    expect(row.slice(0, 5)).toEqual([String(l.id), 'Priya Sharma Rao', '919000000001', 'p@x.test', 'Green Heights']);
    expect(row[11]).toBe('call by Ana: Spoke about pricing');
    const body = cs.leadBody({ sf_lead_source: 'NEXUS', sf_default_company: '[Not provided]' }, rec);
    expect(body).toMatchObject({ FirstName: 'Priya', LastName: 'Sharma Rao', Company: 'Green Heights', Email: 'p@x.test', Phone: '919000000001', LeadSource: 'NEXUS' });
    expect(body.Description).toContain('Score: 85');
    // no company known: the configured default is used; one-word name is the last name
    const b2 = cs.leadBody({ sf_default_company: 'Individual' }, cs.toRecord({ id: 9, full_name: 'Madonna' }));
    expect(b2).toMatchObject({ LastName: 'Madonna', Company: 'Individual' });
    expect(b2.FirstName).toBeUndefined();
  });

  // ── Google Sheets ──────────────────────────────────────────────────────────
  test('creating the sheet writes the header and keeps the id; contacts then go out new and changed only', async () => {
    await cfg(ws1, { google_refresh_token: 'REFRESH_ONE', google_enabled: 1, google_auto: 1 });
    responder = (o) => {
      if (/oauth2\.googleapis\.com\/token/.test(o.url)) return { data: { access_token: 'AT_ONE' } };
      if (o.method === 'post' && o.url === 'https://sheets.googleapis.com/v4/spreadsheets') return { data: { spreadsheetId: 'SHEET1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET1' } };
      return { data: {} };
    };
    const c = await cs.createSheet(knex, ws1, 'Mine');
    expect(c.google_sheet_id).toBe('SHEET1');
    const header = calls.find(x => x.method === 'put');
    expect(header.params.valueInputOption).toBe('RAW');
    expect(header.data.values[0]).toEqual(cs.COLUMNS);

    const a = await addLead(ws1, { full_name: 'A One' });
    const b = await addLead(ws1, { full_name: 'B Two' });
    calls.length = 0;
    responder = (o) => {
      if (/oauth2\.googleapis\.com\/token/.test(o.url)) return { data: { access_token: 'AT_ONE' } };
      if (o.method === 'get') return { data: { values: [[]] } }; // empty sheet
      return { data: {} };
    };
    const r1 = await cs.run(knex, ws1, 'google');
    expect(r1.sent).toBe(2);
    const append = calls.find(x => x.method === 'post' && /:append/.test(decodeURIComponent(x.url)));
    expect(append.params.valueInputOption).toBe('RAW');       // never "USER_ENTERED": a name like =HYPERLINK() stays text
    expect(append.data.values.map(v => v[1])).toEqual(['A One', 'B Two']);
    expect(append.headers.Authorization).toBe('Bearer AT_ONE');

    // nothing changed: nothing sent
    calls.length = 0;
    expect((await cs.run(knex, ws1, 'google')).sent).toBe(0);
    expect(calls.some(x => /:append|batchUpdate/.test(decodeURIComponent(x.url)))).toBe(false);

    // one contact changes: it is updated in its own row, not appended again
    await repo.updateLeadEvent(ws1, b.id, { full_name: 'B Renamed' });
    await knex('meta_lead_events').where({ id: b.id }).update({ updated_at: now() + 10 }); // a later second
    calls.length = 0;
    responder = (o) => {
      if (/oauth2\.googleapis\.com\/token/.test(o.url)) return { data: { access_token: 'AT_ONE' } };
      if (o.method === 'get') return { data: { values: [[String(a.id), String(b.id)]] } };
      return { data: {} };
    };
    const r2 = await cs.run(knex, ws1, 'google');
    expect(r2.sent).toBe(1);
    const upd = calls.find(x => /batchUpdate/.test(x.url));
    expect(upd.data.data[0].range).toMatch(/!A3:N3$/);           // b is the second contact: row 3
    expect(upd.data.data[0].values[0][1]).toBe('B Renamed');
    expect(calls.some(x => /:append/.test(decodeURIComponent(x.url)))).toBe(false);
  });

  test('a logged action marks the contact as changed so the sheet gets the new last action', async () => {
    await cfg(ws1, { google_refresh_token: 'R', google_sheet_id: 'S1', google_enabled: 1, google_auto: 1 });
    const l = await addLead(ws1, { full_name: 'Acts' });
    responder = (o) => (/oauth2/.test(o.url) ? { data: { access_token: 'T' } } : { data: { values: [[]] } });
    await cs.run(knex, ws1, 'google');
    await knex('meta_lead_events').where({ id: l.id }).update({ updated_at: now() - 100 }); // pretend it was old
    await knex('contact_sync_state').where({ lead_id: l.id }).update({ synced_updated_at: now() - 50 });
    expect((await cs.pendingLeads(knex, ws1, 'google')).length).toBe(0);
    await repo.addActivity(ws1, l.id, { kind: 'call', body: 'rang', actor_name: 'Ana' });
    expect((await cs.pendingLeads(knex, ws1, 'google')).length).toBe(1);
  });

  test('two businesses: each uses only its own Google login and sheet, with only its own contacts', async () => {
    await cfg(ws1, { google_refresh_token: 'REFRESH_ONE', google_sheet_id: 'SHEET_ONE', google_enabled: 1, google_auto: 1 });
    await cfg(ws2, { google_refresh_token: 'REFRESH_TWO', google_sheet_id: 'SHEET_TWO', google_enabled: 1, google_auto: 1 });
    await addLead(ws1, { full_name: 'Only One' });
    await addLead(ws2, { full_name: 'Only Two' });
    responder = (o) => {
      if (/oauth2\.googleapis\.com\/token/.test(o.url)) return { data: { access_token: `AT_${o.data.refresh_token}` } };
      if (o.method === 'get') return { data: { values: [[]] } };
      return { data: {} };
    };
    await cs.sweep(knex);
    const appends = calls.filter(x => /:append/.test(decodeURIComponent(x.url)));
    expect(appends).toHaveLength(2);
    const one = appends.find(x => x.url.includes('SHEET_ONE'));
    const two = appends.find(x => x.url.includes('SHEET_TWO'));
    expect(one.headers.Authorization).toBe('Bearer AT_REFRESH_ONE');
    expect(two.headers.Authorization).toBe('Bearer AT_REFRESH_TWO');
    expect(one.data.values.map(v => v[1])).toEqual(['Only One']);
    expect(two.data.values.map(v => v[1])).toEqual(['Only Two']);
  });

  test('Google problems become clear messages and are shown on the screen', async () => {
    await cfg(ws1, { google_refresh_token: 'R', google_sheet_id: 'S', google_enabled: 1, google_auto: 1 });
    await addLead(ws1, { full_name: 'X' });
    responder = (o) => { if (/oauth2/.test(o.url)) { const e = new Error('bad'); e.response = { status: 400, data: { error: 'invalid_grant' } }; throw e; } return { data: {} }; };
    await expect(cs.run(knex, ws1, 'google')).rejects.toMatchObject({ code: 'google_auth' });
    expect((await cs.getConfig(knex, ws1)).last_google_error).toMatch(/Connect Google again/);
    const st = await request(app).get('/api/contact-sync/status').set('x-ws', String(ws1));
    expect(st.body.google.last_error).toMatch(/Connect Google again/);
  });

  // ── Salesforce ─────────────────────────────────────────────────────────────
  const sfCfg = (ws, extra = {}) => cfg(ws, { sf_enabled: 1, sf_auto: 1, sf_domain: 'https://acme.my.salesforce.com', sf_client_id: 'KEY', sf_client_secret: 'SECRET', ...extra });
  const sfResponder = (state = {}) => (o) => {
    if (/oauth2\/token/.test(o.url)) return { data: { access_token: 'SF_TOKEN', instance_url: 'https://acme.my.salesforce.com' } };
    if (o.method === 'post' && /sobjects\/Lead$/.test(o.url)) return { data: { id: `00Q${(state.n = (state.n || 0) + 1)}`, success: true } };
    if (o.method === 'patch') return { data: '' };
    if (o.method === 'get' && /describe/.test(o.url)) return { data: { createable: true, fields: [{ name: 'LastName' }, { name: 'NEXUS_Lead_Id__c' }] } };
    return { data: {} };
  };

  test('Salesforce: logs in with the client credentials, creates a Lead once, then updates it', async () => {
    await sfCfg(ws1);
    const l = await addLead(ws1, { full_name: 'Sam Lee', phone_number: '919000000009' });
    responder = sfResponder();
    expect((await cs.run(knex, ws1, 'salesforce')).sent).toBe(1);
    const login = calls.find(x => /oauth2\/token/.test(x.url));
    expect(login.data).toContain('grant_type=client_credentials');
    expect(login.data).toContain('client_id=KEY');
    const create = calls.find(x => x.method === 'post' && /sobjects\/Lead$/.test(x.url));
    expect(create.url).toBe('https://acme.my.salesforce.com/services/data/v60.0/sobjects/Lead');
    expect(create.headers.Authorization).toBe('Bearer SF_TOKEN');
    expect(create.data).toMatchObject({ FirstName: 'Sam', LastName: 'Lee' });
    const state = await knex('contact_sync_state').where({ lead_id: l.id, target: 'salesforce' }).first();
    expect(state.external_id).toMatch(/^00Q/);

    // changed later: the same Salesforce record is updated, not created again
    await knex('meta_lead_events').where({ id: l.id }).update({ full_name: 'Sam Lee-Jones', updated_at: now() + 20 });
    calls.length = 0;
    expect((await cs.run(knex, ws1, 'salesforce')).sent).toBe(1);
    expect(calls.some(x => x.method === 'post' && /sobjects\/Lead$/.test(x.url))).toBe(false);
    const patch = calls.find(x => x.method === 'patch');
    expect(patch.url).toBe(`https://acme.my.salesforce.com/services/data/v60.0/sobjects/Lead/${state.external_id}`);
  });

  test('Salesforce with an External ID field upserts on it (no duplicates even without saved state)', async () => {
    await sfCfg(ws1, { sf_external_id_field: 'NEXUS_Lead_Id__c' });
    const l = await addLead(ws1, { full_name: 'Zed Zed' });
    responder = sfResponder();
    await cs.run(knex, ws1, 'salesforce');
    const up = calls.find(x => x.method === 'patch');
    expect(up.url).toBe(`https://acme.my.salesforce.com/services/data/v60.0/sobjects/Lead/NEXUS_Lead_Id__c/${l.id}`);
    expect(calls.some(x => x.method === 'post' && /sobjects\/Lead$/.test(x.url))).toBe(false);
  });

  test('Salesforce login problems stop the run, are explained, and failed contacts are parked then retried', async () => {
    await sfCfg(ws1);
    const l = await addLead(ws1, { full_name: 'Fail Me' });
    responder = (o) => { const e = new Error('x'); e.response = { status: 400, data: { error: 'invalid_client', error_description: 'invalid client credentials' } }; throw e; };
    await expect(cs.run(knex, ws1, 'salesforce')).rejects.toMatchObject({ code: 'sf_auth' });
    expect((await cs.getConfig(knex, ws1)).last_sf_error).toMatch(/Consumer Key or Secret/);

    // a record-level error is kept against that contact, with a count, until it is retried
    responder = (o) => {
      if (/oauth2\/token/.test(o.url)) return { data: { access_token: 'T', instance_url: 'https://acme.my.salesforce.com' } };
      const e = new Error('x'); e.response = { status: 400, data: [{ errorCode: 'REQUIRED_FIELD_MISSING', message: 'Required fields are missing: [LastName]' }] }; throw e;
    };
    await expect(cs.run(knex, ws1, 'salesforce')).rejects.toBeTruthy();
    const st = await knex('contact_sync_state').where({ lead_id: l.id, target: 'salesforce' }).first();
    expect(st.attempts).toBe(1);
    expect(st.error).toMatch(/Required fields/);
    const c = await cs.counts(knex, ws1, 'salesforce');
    expect(c).toMatchObject({ failing: 1, synced: 0 });
  });

  test('two businesses: Salesforce credentials and contacts never mix', async () => {
    await sfCfg(ws1, { sf_domain: 'https://one.my.salesforce.com', sf_client_id: 'KEY1', sf_client_secret: 'SEC1' });
    await sfCfg(ws2, { sf_domain: 'https://two.my.salesforce.com', sf_client_id: 'KEY2', sf_client_secret: 'SEC2' });
    await addLead(ws1, { full_name: 'Aaa One' });
    await addLead(ws2, { full_name: 'Bbb Two' });
    responder = (o) => {
      if (/oauth2\/token/.test(o.url)) return { data: { access_token: `TOK_${o.url.includes('one') ? 1 : 2}`, instance_url: new URL(o.url).origin } };
      return { data: { id: '00Qx' } };
    };
    await cs.sweep(knex);
    const creates = calls.filter(x => x.method === 'post' && /sobjects\/Lead$/.test(x.url));
    const one = creates.find(x => x.url.startsWith('https://one.'));
    const two = creates.find(x => x.url.startsWith('https://two.'));
    expect(one.headers.Authorization).toBe('Bearer TOK_1');
    expect(two.headers.Authorization).toBe('Bearer TOK_2');
    expect(one.data.LastName).toBe('One');
    expect(two.data.LastName).toBe('Two');
    expect(creates).toHaveLength(2);
  });

  // ── Settings API ───────────────────────────────────────────────────────────
  test('settings: secrets are never returned; a blank secret keeps the saved one; bad values are refused', async () => {
    const save = (body, ws = ws1) => request(app).post('/api/contact-sync/config').set('x-ws', String(ws)).send(body);
    let r = await save({ sf_domain: 'https://acme.my.salesforce.com', sf_client_id: 'KEY', sf_client_secret: 'TOPSECRET', sf_external_id_field: 'NEXUS_Lead_Id__c' });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('TOPSECRET');
    expect(r.body.salesforce).toMatchObject({ has_secret: true, domain: 'https://acme.my.salesforce.com', external_id_field: 'NEXUS_Lead_Id__c' });
    await save({ sf_lead_source: 'Website' }); // no secret sent
    expect((await cs.getConfig(knex, ws1)).sf_client_secret).toBe('TOPSECRET'); // test db is plain; kept
    const st = await request(app).get('/api/contact-sync/status').set('x-ws', String(ws1));
    expect(JSON.stringify(st.body)).not.toContain('TOPSECRET');

    expect((await save({ sf_domain: 'https://localhost:8080' })).status).toBe(400);
    expect((await save({ sf_external_id_field: 'bad name' })).status).toBe(400);
    expect((await save({ sf_api_version: '60' })).status).toBe(400);
    expect((await save({ google_enabled: true })).body.code).toBe('google_no_sheet'); // cannot switch on without a sheet
    const empty = await save({ sf_enabled: true }, ws2); // business two has no Salesforce details
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('sf_not_configured');
    const other = await request(app).get('/api/contact-sync/status').set('x-ws', String(ws2));
    expect(other.body.salesforce.domain).toBe(''); // business one's settings are not business two's
  });

  test('"Sync now" gives failed contacts another go; the test button checks the External ID field', async () => {
    await sfCfg(ws1, { sf_external_id_field: 'NEXUS_Lead_Id__c' });
    const l = await addLead(ws1, { full_name: 'Retry Me' });
    await knex('contact_sync_state').insert({ workspace_id: ws1, lead_id: l.id, target: 'salesforce', error: 'old', attempts: 9 });
    responder = sfResponder();
    const r = await request(app).post('/api/contact-sync/sync').set('x-ws', String(ws1)).send({ target: 'salesforce' });
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(1);
    const t = await request(app).post('/api/contact-sync/salesforce/test').set('x-ws', String(ws1)).send({});
    expect(t.body).toMatchObject({ ok: true, external_id_field_found: true });
  });
});
