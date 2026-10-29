// Client approval links: encrypted on this PC, readable in the client's browser
// (WebCrypto), answers applied to the post
jest.mock('axios');
jest.mock('../services/license', () => ({ serverUrl: () => 'https://relay.test', licenseProof: () => 'PROOF', status: () => ({ can_publish: true }) }));
const axios = require('axios');
const { webcrypto } = require('crypto');
const { makeTestKnex } = require('./helpers/db');
const approvals = require('../services/approvals');

// What the client's page (approve.js) does, with the browser's WebCrypto
const unb64 = (s) => Uint8Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
async function browserDecrypt(keyB64, data) {
  const key = await webcrypto.subtle.importKey('raw', unb64(keyB64), 'AES-GCM', false, ['decrypt', 'encrypt']);
  const raw = unb64(data);
  return JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12))));
}
async function browserEncrypt(keyB64, obj) {
  const key = await webcrypto.subtle.importKey('raw', unb64(keyB64), 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return Buffer.concat([Buffer.from(iv), Buffer.from(c)]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let knex, ws, itemId;
beforeAll(async () => {
  knex = makeTestKnex();
  await knex.migrate.latest();
  const [o] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
  const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'Chai Point', slug: 'cp' }).returning('id');
  ws = w?.id ?? w;
  await knex('users').insert({ id: 1, email: 'm@x.test', password_hash: 'h', name: 'Manager' });
  await knex('memberships').insert({ user_id: 1, workspace_id: ws, role: 'manager' });
  await knex('users').insert({ id: 2, email: 'c@x.test', password_hash: 'h', name: 'Creator' });
  await knex('memberships').insert({ user_id: 2, workspace_id: ws, role: 'creator' });
  const [i] = await knex('content_items').insert({ workspace_id: ws, body: 'Diwali offer', platforms: '["instagram"]', image_url: 'https://img.test/a.jpg', status: 'draft' }).returning('id');
  itemId = i?.id ?? i;
});
afterAll(() => knex.destroy());

test('the shared post can be read only with the key in the link, and the answer approves it', async () => {
  axios.post.mockResolvedValue({ data: { id: 'R1', owner: 'OWNER', url: 'https://relay.test/a/R1', expires_at: Math.floor(Date.now() / 1000) + 86400 } });
  const r = await approvals.share(knex, { workspaceId: ws, userId: 1, itemId });

  // The relay received only ciphertext, plus the licence proof
  const [url, body, opts] = axios.post.mock.calls[0];
  expect(url).toBe('https://relay.test/v1/approvals');
  expect(opts.headers['X-SN-License']).toBe('PROOF');
  expect(JSON.stringify(body)).not.toContain('Diwali');

  // The link carries the key after "#"; the browser can decrypt
  const keyB64 = r.url.split('#')[1];
  expect(r.url.startsWith('https://relay.test/a/R1#')).toBe(true);
  const post = await browserDecrypt(keyB64, body.ciphertext);
  expect(post).toMatchObject({ business: 'Chai Point', body: 'Diwali offer', platforms: ['instagram'], images: ['https://img.test/a.jpg'] });

  // The post waits for the client
  expect((await knex('content_items').where({ id: itemId }).first()).status).toBe('in_review');

  // Secrets are stored encrypted
  const raw = await new Promise((res) => knex.client.acquireConnection().then(c => c.get('select owner_token, link_key from approval_links', [], (e, row) => { knex.client.releaseConnection(c); res(row); })));
  expect(raw.owner_token.startsWith('enc:v1:')).toBe(true);

  // The client approves in the browser; the app picks it up
  const answer = await browserEncrypt(keyB64, { decision: 'approve', name: 'Mr Sharma', comment: 'Looks great', at: 1 });
  axios.post.mockResolvedValue({ data: { answers: { R1: { response: answer } } } });
  expect(await approvals.poll(knex)).toBe(1);
  expect(axios.post.mock.calls.at(-1)[1]).toEqual({ items: [{ id: 'R1', owner: 'OWNER' }] });
  expect((await knex('content_items').where({ id: itemId }).first()).status).toBe('approved');
  const comment = await knex('content_item_comments').where({ content_item_id: itemId }).first();
  expect(comment.body).toMatch(/Approved by Mr Sharma.*Looks great/);
  expect((await knex('approval_links').first()).status).toBe('approved');
});

test('asking for changes sends the post back to draft with the comment', async () => {
  await knex('content_items').where({ id: itemId }).update({ status: 'draft' });
  axios.post.mockResolvedValue({ data: { id: 'R2', owner: 'O2', url: 'https://relay.test/a/R2', expires_at: Math.floor(Date.now() / 1000) + 86400 } });
  const r = await approvals.share(knex, { workspaceId: ws, userId: 1, itemId });
  const answer = await browserEncrypt(r.url.split('#')[1], { decision: 'changes', name: 'Mr Sharma', comment: 'Use the red logo' });
  axios.post.mockResolvedValue({ data: { answers: { R2: { response: answer } } } });
  await approvals.poll(knex);
  expect((await knex('content_items').where({ id: itemId }).first()).status).toBe('draft');
  expect((await knex('content_item_comments').orderBy('id', 'desc').first()).body).toMatch(/asked for changes.*red logo/);
});

test('approved with a time still ahead: scheduled straight away', async () => {
  const at = Math.floor(Date.now() / 1000) + 86400;
  await knex('content_items').where({ id: itemId }).update({ status: 'draft', scheduled_at: at });
  axios.post.mockResolvedValueOnce({ data: { id: 'R3', owner: 'O3', url: 'https://relay.test/a/R3', expires_at: at } });
  const r = await approvals.share(knex, { workspaceId: ws, userId: 1, itemId });
  axios.post.mockResolvedValueOnce({ data: { answers: { R3: { response: await browserEncrypt(r.url.split('#')[1], { decision: 'approve', name: 'C' }) } } } });
  await approvals.poll(knex);
  expect((await knex('content_items').where({ id: itemId }).first()).status).toBe('scheduled');
});

test('one link for several posts: the client answers each one', async () => {
  const mk = async (body) => { const [i] = await knex('content_items').insert({ workspace_id: ws, body, platforms: '["facebook"]', status: 'draft' }).returning('id'); return i?.id ?? i; };
  const a = await mk('Post A'), b = await mk('Post B');
  axios.post.mockResolvedValueOnce({ data: { id: 'SET', owner: 'OS', url: 'https://relay.test/a/SET', expires_at: Math.floor(Date.now() / 1000) + 86400 } });
  const r = await approvals.share(knex, { workspaceId: ws, userId: 1, itemIds: [a, b] });
  expect(r.count).toBe(2);
  const keyB64 = r.url.split('#')[1];
  const payload = await browserDecrypt(keyB64, axios.post.mock.calls.at(-1)[1].ciphertext);
  expect(payload.posts.map(p => p.body)).toEqual(['Post A', 'Post B']);

  const answer = await browserEncrypt(keyB64, { name: 'C', decisions: [{ i: 0, decision: 'approve' }, { i: 1, decision: 'changes', comment: 'Shorter please' }] });
  axios.post.mockResolvedValueOnce({ data: { answers: { SET: { response: answer } } } });
  expect(await approvals.poll(knex)).toBe(2);
  expect((await knex('content_items').where({ id: a }).first()).status).toBe('approved');
  expect((await knex('content_items').where({ id: b }).first()).status).toBe('draft');
  // one request for the whole set
  expect(axios.post.mock.calls.at(-1)[1].items).toEqual([{ id: 'SET', owner: 'OS' }]);
});

test('editing a shared post closes its link', async () => {
  const [i] = await knex('content_items').insert({ workspace_id: ws, body: 'Old text', platforms: '["facebook"]', status: 'draft' }).returning('id');
  const id = i?.id ?? i;
  axios.post.mockResolvedValueOnce({ data: { id: 'R9', owner: 'O9', url: 'https://relay.test/a/R9', expires_at: Math.floor(Date.now() / 1000) + 86400 } });
  await approvals.share(knex, { workspaceId: ws, userId: 1, itemId: id });
  axios.delete.mockResolvedValue({});
  expect(await approvals.postChanged(knex, ws, id)).toBe(1);
  expect((await knex('approval_links').where({ content_item_id: id }).first()).status).toBe('withdrawn');
  expect(axios.delete.mock.calls[0][0]).toBe('https://relay.test/v1/approvals/R9');
});

test('a link shared by someone who may not approve does not schedule the post', async () => {
  const at = Math.floor(Date.now() / 1000) + 86400;
  const [i] = await knex('content_items').insert({ workspace_id: ws, body: 'By a creator', platforms: '["facebook"]', status: 'draft', scheduled_at: at }).returning('id');
  const id = i?.id ?? i;
  axios.post.mockResolvedValueOnce({ data: { id: 'RC', owner: 'OC', url: 'https://relay.test/a/RC', expires_at: at } });
  const r = await approvals.share(knex, { workspaceId: ws, userId: 2, itemId: id });
  axios.post.mockResolvedValueOnce({ data: { answers: { RC: { response: await browserEncrypt(r.url.split('#')[1], { decision: 'approve', name: 'Me' }) } } } });
  await approvals.poll(knex);
  expect((await knex('content_items').where({ id }).first()).status).toBe('approved');
});
