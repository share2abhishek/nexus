// Login renewal before posting and in the daily check
jest.mock('axios');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const refresher = require('../services/tokenRefresher');
const { open } = require('../services/secrets'); // saved logins are stored encrypted

const now = () => Math.floor(Date.now() / 1000);
let knex, wsId;

beforeAll(async () => {
  knex = makeTestKnex();
  await knex.migrate.latest();
  const [org] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
  const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'W', slug: 'w', timezone: 'UTC' }).returning('id');
  wsId = ws?.id ?? ws;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(async () => { console.log.mockRestore(); console.warn.mockRestore(); await knex.destroy(); });
beforeEach(async () => { jest.resetAllMocks(); await knex('social_accounts').del(); });

const addAccount = async (fields) => {
  const [r] = await knex('social_accounts').insert({ workspace_id: wsId, external_id: 'x' + Math.random(), ...fields }).returning('id');
  return knex('social_accounts').where({ id: r?.id ?? r }).first();
};

test('a Google Business login about to run out is renewed, and the shared Google row too', async () => {
  const gb = await addAccount({ platform: 'google_business', access_token: 'old', refresh_token: 'R', expires_at: now() + 60 });
  await addAccount({ platform: 'google', access_token: 'old', refresh_token: 'R', expires_at: now() + 60 });
  axios.post.mockResolvedValue({ data: { access_token: 'new', expires_in: 3600 } });

  await refresher.ensureFresh(knex, gb);
  expect(gb.access_token).toBe('new');
  expect((await knex('social_accounts').select('access_token')).map(r => r.access_token).sort()).toEqual(['new', 'new']);
  expect(axios.post.mock.calls[0][1]).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'R' });
});

test('a login with time left is not renewed', async () => {
  const acc = await addAccount({ platform: 'pinterest', access_token: 'a', refresh_token: 'R', expires_at: now() + 5 * 86400 });
  await refresher.ensureFresh(knex, acc);
  expect(axios.post).not.toHaveBeenCalled();
});

test('a cancelled login is marked, stops counting as connected, and explains what to do', async () => {
  const acc = await addAccount({ platform: 'pinterest', access_token: 'a', refresh_token: 'R', expires_at: now() - 10 });
  axios.post.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
  await expect(refresher.ensureFresh(knex, acc)).rejects.toThrow(/sign in again/);
  const row = await knex('social_accounts').where({ id: acc.id }).first();
  expect(row.auth_error).toMatch(/cancelled or has run out/);
  const list = await require('../repos/socialAccountsRepo')(knex).list(wsId);
  expect(list[0].usable).toBe(false);
});

test('network trouble keeps the old login (tries again later)', async () => {
  const acc = await addAccount({ platform: 'pinterest', access_token: 'a', refresh_token: 'R', expires_at: now() - 10 });
  axios.post.mockRejectedValue(new Error('ECONNRESET'));
  await refresher.ensureFresh(knex, acc);
  expect((await knex('social_accounts').where({ id: acc.id }).first()).auth_error).toBeNull();
});

test('daily check renews what ends within a week and checks Facebook Page logins', async () => {
  process.env.FACEBOOK_APP_ID = 'app'; process.env.FACEBOOK_APP_SECRET = 'sec';
  const pin = await addAccount({ platform: 'pinterest', access_token: 'a', refresh_token: 'R', expires_at: now() + 3 * 86400 });
  const fb = await addAccount({ platform: 'facebook', access_token: 'u', page_token: 'p', expires_at: now() + 3600 });
  axios.post.mockResolvedValue({ data: { access_token: 'new', expires_in: 30 * 86400, refresh_token: 'R2', refresh_token_expires_in: 365 * 86400 } });
  axios.get.mockResolvedValue({ data: { data: { is_valid: true, expires_at: 0 } } });

  await refresher.checkAll(knex);
  const p = await knex('social_accounts').where({ id: pin.id }).first();
  expect([p.access_token, p.refresh_token]).toEqual(['new', 'R2']);
  const f = await knex('social_accounts').where({ id: fb.id }).first();
  expect(f.expires_at).toBeNull(); // Page login that never ends
  expect(axios.get.mock.calls[0][1].params.input_token).toBe('p');
});

test('days until signing in again: counted for logins the app cannot renew', () => {
  expect(refresher.reconnectInDays({ platform: 'linkedin', access_token: 'a', expires_at: now() + 5 * 86400 + 100 })).toBe(5);
  expect(refresher.reconnectInDays({ platform: 'linkedin', access_token: 'a', refresh_token: 'R', expires_at: now() + 86400, refresh_expires_at: now() + 300 * 86400 + 100 })).toBe(300);
  expect(refresher.reconnectInDays({ platform: 'twitter', access_token: 'a' })).toBeNull();
  expect(refresher.reconnectInDays({ platform: 'google_business', access_token: 'a', refresh_token: 'R', expires_at: now() + 100 })).toBeNull();
});

test('saved logins are encrypted in the database file', async () => {
  const acc = await addAccount({ platform: 'pinterest', access_token: 'plain' });
  await require('../services/secrets').sweep(knex);
  const raw = await knex.raw('select access_token from social_accounts where id = ?', [acc.id]);
  // knex decrypts results, so check the stored form through the sealed flag
  const { isSealed } = require('../services/secrets');
  const stored = await new Promise((res) => knex.client.acquireConnection().then(c => c.get('select access_token from social_accounts where id = ?', [acc.id], (e, row) => { knex.client.releaseConnection(c); res(row.access_token); })));
  expect(isSealed(stored)).toBe(true);
  expect(raw[0].access_token).toBe('plain');
});
