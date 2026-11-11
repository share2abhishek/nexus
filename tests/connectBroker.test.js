// One-click connect on the app side: collect the encrypted login, save the
// account as via='radixile', and renew it through Radixile's helper
jest.mock('axios');
jest.mock('../services/license', () => ({ serverUrl: () => 'https://lic.test', licenseProof: () => 'PROOF', status: () => ({ can_publish: true }) }));
const crypto = require('crypto');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const broker = require('../services/connectBroker');
const refresher = require('../services/tokenRefresher');

const enc = (keyHex, obj) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
};

let knex, ws;
beforeAll(async () => {
  knex = makeTestKnex();
  await knex.migrate.latest();
  const [o] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
  const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'W', slug: 'w' }).returning('id');
  ws = w?.id ?? w;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => { console.log.mockRestore(); return knex.destroy(); });
beforeEach(() => { jest.resetAllMocks(); broker._reset(); });

test('start → wait → done saves a LinkedIn account marked as one-click', async () => {
  axios.post.mockResolvedValueOnce({ data: { session_id: 'S1', auth_url: 'https://www.linkedin.com/oauth/v2/authorization?x' } });
  const s = await broker.start({ wsId: ws, platform: 'linkedin' });
  expect(axios.post.mock.calls[0][2].headers['X-SN-License']).toBe('PROOF');
  const keyHex = axios.post.mock.calls[0][1].key_hex;
  expect(keyHex).toMatch(/^[0-9a-f]{64}$/);

  axios.get.mockResolvedValueOnce({ data: { status: 'waiting' } });
  expect((await broker.check(knex, s.session_id, ws)).status).toBe('waiting');

  axios.get
    .mockResolvedValueOnce({ data: { status: 'done', result: enc(keyHex, { platform: 'linkedin', token: { access_token: 'LI', expires_in: 5184000, refresh_token: 'R1', refresh_token_expires_in: 31536000 } }) } })
    .mockResolvedValueOnce({ data: { sub: 'abc', name: 'Asha' } }); // userinfo
  const done = await broker.check(knex, s.session_id, ws);
  expect(done).toMatchObject({ status: 'done', connected: 'linkedin' });
  const acc = await knex('social_accounts').where({ workspace_id: ws, platform: 'linkedin' }).first();
  expect(acc).toMatchObject({ access_token: 'LI', refresh_token: 'R1', via: 'radixile', external_id: 'abc' });

  // Another workspace can't collect it
  expect((await broker.check(knex, s.session_id, ws + 1)).status).toBe('expired');
});

test('a one-click login is renewed through the helper, not with local app keys', async () => {
  const acc = await knex('social_accounts').where({ platform: 'linkedin' }).first();
  await knex('social_accounts').where({ id: acc.id }).update({ expires_at: Math.floor(Date.now() / 1000) + 60 });
  const fresh = await knex('social_accounts').where({ id: acc.id }).first();
  axios.post.mockResolvedValueOnce({ data: { access_token: 'LI2', expires_in: 5184000 } });
  await refresher.ensureFresh(knex, fresh);
  expect(axios.post.mock.calls[0][0]).toBe('https://lic.test/v1/connect/refresh');
  expect(axios.post.mock.calls[0][1]).toEqual({ platform: 'linkedin', refresh_token: 'R1' });
  expect((await knex('social_accounts').where({ id: acc.id }).first()).access_token).toBe('LI2');
  // Renewable, so no "reconnect in N days" countdown from the short login
  expect(refresher.reconnectInDays(fresh)).toBeGreaterThan(300);
});
