// Phone companion: encrypted summary out, actions back with the person's own rights
jest.mock('axios');
jest.mock('../services/license', () => ({ serverUrl: () => 'https://relay.test', licenseProof: () => 'PROOF', status: () => ({ can_publish: true }) }));
const axios = require('axios');
const { webcrypto } = require('crypto');
const { makeTestKnex } = require('./helpers/db');
const companion = require('../services/companion');

const unb64 = (s) => Uint8Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
const phoneDecrypt = async (keyB64, data) => {
  const key = await webcrypto.subtle.importKey('raw', unb64(keyB64), 'AES-GCM', false, ['decrypt']);
  const raw = unb64(data);
  return JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12))));
};
const phoneEncrypt = async (keyB64, obj) => {
  const key = await webcrypto.subtle.importKey('raw', unb64(keyB64), 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return Buffer.concat([Buffer.from(iv), Buffer.from(c)]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let knex, ws, waitingId, url;
beforeAll(async () => {
  knex = makeTestKnex();
  await knex.migrate.latest();
  const [o] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
  const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'Chai Point', slug: 'cp' }).returning('id');
  ws = w?.id ?? w;
  await knex('users').insert([{ id: 1, email: 'm@x.test', password_hash: 'h', name: 'Manager' }, { id: 2, email: 'a@x.test', password_hash: 'h', name: 'Analyst' }]);
  await knex('memberships').insert([{ user_id: 1, workspace_id: ws, role: 'manager' }, { user_id: 2, workspace_id: ws, role: 'analyst' }]);
  const [i] = await knex('content_items').insert({ workspace_id: ws, body: 'Weekend offer', platforms: '["facebook"]', status: 'in_review' }).returning('id');
  waitingId = i?.id ?? i;
});
afterAll(() => knex.destroy());

test('pairing pushes an encrypted summary the phone can read', async () => {
  axios.post.mockResolvedValueOnce({ data: { id: 'P1', owner: 'OWN', url: 'https://relay.test/m/P1' } });
  axios.put.mockResolvedValue({ data: { ok: true } });
  url = (await companion.pair(knex, 1, 'Pixel')).url;
  expect(url).toMatch(/^https:\/\/relay\.test\/m\/P1#/);
  const sent = axios.put.mock.calls[0][1].ciphertext;
  expect(sent).not.toContain('Weekend');
  const s = await phoneDecrypt(url.split('#')[1], sent);
  expect(s.waiting).toEqual([expect.objectContaining({ id: waitingId, body: 'Weekend offer', workspace: 'Chai Point' })]);
});

test('an Approve from the phone is applied with the person’s rights', async () => {
  const keyB64 = url.split('#')[1];
  const v = (await knex('content_items').where({ id: waitingId }).first()).updated_at || 0;
  axios.get.mockResolvedValueOnce({ data: { actions: [await phoneEncrypt(keyB64, { type: 'review', workspace_id: ws, item_id: waitingId, v, decision: 'approve', at: Math.floor(Date.now() / 1000) })] } });
  await companion.sync(knex);
  expect((await knex('content_items').where({ id: waitingId }).first()).status).toBe('approved');
  expect((await knex('content_item_comments').first()).body).toMatch(/Approved on the phone/);
});

test('someone without approve rights can’t approve from a phone', async () => {
  const [i] = await knex('content_items').insert({ workspace_id: ws, body: 'Another', platforms: '[]', status: 'in_review' }).returning('id');
  const p = { user_id: 2 };
  expect(await companion.applyAction(knex, p, { type: 'review', workspace_id: ws, item_id: i?.id ?? i, decision: 'approve' })).toBe(false);
  expect((await knex('content_items').where({ id: i?.id ?? i }).first()).status).toBe('in_review');
});

test('a reply typed on the phone is posted, and the phone is told', async () => {
  await require('../repos/socialAccountsRepo')(knex).add(ws, { platform: 'facebook', external_id: 'u', access_token: 'u', page_token: 'PT', page_id: 'PAGE' });
  const [c] = await knex('inbox_items').insert({ workspace_id: ws, platform: 'facebook', external_id: 'c9', author_name: 'Ravi', text: 'Open today?', created_at: Math.floor(Date.now() / 1000) }).returning('id');
  const cid = c?.id ?? c;
  const s = await companion.summary(knex, 1);
  expect(s.comments.map(x => x.id)).toContain(cid);

  const keyB64 = url.split('#')[1];
  axios.get.mockResolvedValueOnce({ data: { actions: [await phoneEncrypt(keyB64, { type: 'reply', key: `c:${ws}:${cid}`, workspace_id: ws, item_id: cid, text: 'Yes, till 10pm!' })] } });
  axios.post.mockResolvedValueOnce({ data: { id: 'r' } });
  axios.put.mockResolvedValue({ data: { ok: true } });
  await companion.sync(knex);
  expect(axios.post.mock.calls.at(-1)[1]).toMatchObject({ message: 'Yes, till 10pm!', access_token: 'PT' });
  expect((await knex('inbox_items').where({ id: cid }).first()).reply_text).toBe('Yes, till 10pm!');
  const pushed = await phoneDecrypt(keyB64, axios.put.mock.calls.at(-1)[1].ciphertext);
  expect(pushed.done).toContainEqual({ key: `c:${ws}:${cid}`, ok: true, note: null });
});

test('an old or replayed approval is ignored', async () => {
  const [i] = await knex('content_items').insert({ workspace_id: ws, body: 'Edited later', platforms: '[]', status: 'in_review', updated_at: 500 }).returning('id');
  const id = i?.id ?? i;
  expect(await companion.applyAction(knex, { user_id: 1 }, { type: 'review', workspace_id: ws, item_id: id, v: 400, decision: 'approve', at: Math.floor(Date.now() / 1000) })).toBe(false);
  expect(await companion.applyAction(knex, { user_id: 1 }, { type: 'review', workspace_id: ws, item_id: id, v: 500, decision: 'approve', at: 1000 })).toBe(false);
  expect((await knex('content_items').where({ id }).first()).status).toBe('in_review');
});
