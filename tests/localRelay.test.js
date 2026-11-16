// Client approval links on the hosted edition: the app is its own relay (no licence server).
// Whole journey: a manager shares a post, the client opens the page and answers, the app
// applies the answer to the post.
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

const mockKnex = makeTestKnex();
const knex = mockKnex;
jest.mock('../services/knex', () => mockKnex);

const OLD_ENV = { ...process.env };
let approvals, relay, app, wsId, userId;
const t0 = () => Math.floor(Date.now() / 1000);

async function addPost(extra = {}) {
  const [row] = await knex('content_items').insert({
    workspace_id: wsId, title: 'Diwali boxes', body: 'Our Diwali boxes are back.', platforms: JSON.stringify(['instagram']),
    status: 'draft', scheduled_at: t0() + 5 * 86400, created_at: t0(), updated_at: t0(), ...extra,
  }).returning('id');
  return row?.id ?? row;
}
const fragmentKey = (url) => approvals.unb64url(url.split('#')[1]);
const relayId = (url) => url.split('#')[0].split('/a/')[1];

beforeAll(async () => {
  process.env.NEXUS_MODE = 'server';
  process.env.APP_URL = 'https://app.example.test';
  // A throw-away licence server address: if anything tried to use it, the test would fail
  process.env.LICENSE_SERVER_URL = 'http://127.0.0.1:1';
  await knex.migrate.latest();
  const [u] = await knex('users').insert({ email: 'owner@relay.test', password_hash: 'x', role: 'user', email_verified_at: 1700000000 }).returning('id');
  userId = u?.id ?? u;
  const [o] = await knex('organizations').insert({ name: 'Relay Co', owner_user_id: userId, plan: 'trial' }).returning('id');
  const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'Relay Co', slug: 'relay-co' }).returning('id');
  wsId = w?.id ?? w;
  await knex('memberships').insert({ user_id: userId, workspace_id: wsId, role: 'manager' });

  approvals = require('../services/approvals');
  relay = require('../services/localRelay');
  app = express();
  app.use(require('../routes/relayPublic')(knex));
});
afterAll(async () => { process.env = OLD_ENV; await knex.destroy(); });

describe('client approval on the hosted edition', () => {
  test('share → client reads → client approves → the app applies the answer', async () => {
    const itemId = await addPost();
    const shared = await approvals.share(knex, { workspaceId: wsId, userId, itemId, baseUrl: 'http://ignored.test' });

    // the link points at this app (APP_URL), with the key after "#"
    expect(shared.url).toMatch(/^https:\/\/app\.example\.test\/a\/[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$/);
    expect((await knex('content_items').where({ id: itemId }).first()).status).toBe('in_review');

    // the page and the post (encrypted: the server cannot read it)
    const page = await request(app).get(`/a/${relayId(shared.url)}`);
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toMatch(/script-src 'self'/);
    expect(page.text).toMatch(/Please review this post/);
    const got = await request(app).get(`/v1/approvals/${relayId(shared.url)}`);
    expect(got.status).toBe(200);
    expect(got.headers['cache-control']).toBe('no-store');
    expect(got.body.ciphertext).not.toMatch(/Diwali/);
    const stored = await knex('relay_approvals').where({ id: relayId(shared.url) }).first();
    expect(stored.ciphertext).not.toMatch(/Diwali/);
    // with the key from the link the client's browser can read it
    const key = fragmentKey(shared.url);
    expect(approvals.decrypt(key, got.body.ciphertext)).toMatchObject({ body: 'Our Diwali boxes are back.', platforms: ['instagram'] });

    // the client answers; a second answer is refused
    const answer = approvals.encrypt(key, { decision: 'approve', name: 'Asha (client)', comment: 'Love it', at: t0() });
    expect((await request(app).post(`/v1/approvals/${relayId(shared.url)}/response`).send({ response: answer })).status).toBe(200);
    expect((await request(app).post(`/v1/approvals/${relayId(shared.url)}/response`).send({ response: answer })).status).toBe(409);

    // the app collects it (what the 2-minute poll does) and applies it
    expect(await approvals.poll(knex)).toBe(1);
    expect(['approved', 'scheduled']).toContain((await knex('content_items').where({ id: itemId }).first()).status);
    const link = await knex('approval_links').where({ content_item_id: itemId }).first();
    expect(link).toMatchObject({ status: 'approved', response_name: 'Asha (client)', response_comment: 'Love it' });
    const comments = await knex('content_item_comments').where({ content_item_id: itemId });
    expect(comments.some((c) => /Approved by Asha/.test(c.body))).toBe(true);
  });

  test('"ask for changes" sends the post back to draft with the client’s note', async () => {
    const itemId = await addPost({ title: 'Needs edits' });
    const shared = await approvals.share(knex, { workspaceId: wsId, userId, itemId });
    const answer = approvals.encrypt(fragmentKey(shared.url), { decision: 'changes', name: 'Ravi', comment: 'Use the red box photo', at: t0() });
    await request(app).post(`/v1/approvals/${relayId(shared.url)}/response`).send({ response: answer });
    await approvals.poll(knex);
    expect((await knex('content_items').where({ id: itemId }).first()).status).toBe('draft');
    const comments = await knex('content_item_comments').where({ content_item_id: itemId });
    expect(comments.some((c) => /asked for changes.*red box photo/.test(c.body))).toBe(true);
  });

  test('one link for a set of posts; the client answers each', async () => {
    const a = await addPost({ title: 'Set A' });
    const b = await addPost({ title: 'Set B' });
    const shared = await approvals.share(knex, { workspaceId: wsId, userId, itemIds: [a, b] });
    expect(shared.count).toBe(2);
    const answer = approvals.encrypt(fragmentKey(shared.url), { name: 'Meera', at: t0(), decisions: [{ i: 0, decision: 'approve' }, { i: 1, decision: 'changes', comment: 'shorter' }] });
    await request(app).post(`/v1/approvals/${relayId(shared.url)}/response`).send({ response: answer });
    expect(await approvals.poll(knex)).toBe(2);
    expect(['approved', 'scheduled']).toContain((await knex('content_items').where({ id: a }).first()).status);
    expect((await knex('content_items').where({ id: b }).first()).status).toBe('draft');
  });

  test('withdrawing a link removes the stored post', async () => {
    const itemId = await addPost({ title: 'To withdraw' });
    const shared = await approvals.share(knex, { workspaceId: wsId, userId, itemId });
    const link = await knex('approval_links').where({ content_item_id: itemId, status: 'open' }).first();
    await approvals.withdraw(knex, link);
    expect((await request(app).get(`/v1/approvals/${relayId(shared.url)}`)).status).toBe(404);
    expect(await knex('relay_approvals').where({ id: relayId(shared.url) }).first()).toBeUndefined();
  });

  test('an expired link is gone for the client and for the app', async () => {
    const itemId = await addPost({ title: 'Expiring' });
    const shared = await approvals.share(knex, { workspaceId: wsId, userId, itemId });
    await knex('relay_approvals').where({ id: relayId(shared.url) }).update({ expires_at: t0() - 10 });
    expect((await request(app).get(`/v1/approvals/${relayId(shared.url)}`)).status).toBe(404);
    expect((await request(app).post(`/v1/approvals/${relayId(shared.url)}/response`).send({ response: 'abc' })).status).toBe(409);
    const link = await knex('approval_links').where({ content_item_id: itemId }).first();
    const answers = await relay.collect(knex, [{ id: link.relay_id, owner: link.owner_token }]);
    expect(answers[link.relay_id]).toEqual({ gone: true });
  });
});

describe('the relay itself', () => {
  test('only the maker of a link can collect its answer or withdraw it', async () => {
    const made = await relay.create(knex, { workspaceId: wsId, ciphertext: 'abcDEF123-_', days: 5, publicBase: 'https://app.example.test/' });
    expect(made.url).toBe(`https://app.example.test/a/${made.id}`);
    expect(await relay.remove(knex, made.id, 'not-the-owner')).toBe(false);
    expect(await relay.collect(knex, [{ id: made.id, owner: 'not-the-owner' }])).toEqual({ [made.id]: { gone: true } });
    expect(await relay.remove(knex, made.id, made.owner)).toBe(true);
  });

  test('refuses anything that is not base64 text, and over-long lifetimes are capped at 30 days', async () => {
    await expect(relay.create(knex, { workspaceId: wsId, ciphertext: '<script>alert(1)</script>', publicBase: 'https://x.test' })).rejects.toMatchObject({ status: 400 });
    await expect(relay.create(knex, { workspaceId: wsId, ciphertext: '', publicBase: 'https://x.test' })).rejects.toMatchObject({ status: 400 });
    const made = await relay.create(knex, { workspaceId: wsId, ciphertext: 'abc', days: 9999, publicBase: 'https://x.test' });
    const row = await knex('relay_approvals').where({ id: made.id }).first();
    expect(Number(row.expires_at) - Number(row.created_at)).toBe(30 * 86400);
  });

  test('a workspace can make only so many links a day', async () => {
    const [w2] = await knex('workspaces').insert({ org_id: (await knex('organizations').first('id')).id, name: 'Busy', slug: 'busy' }).returning('id');
    const busy = w2?.id ?? w2;
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: `fill${i}`, workspace_id: busy, owner_hash: 'x', ciphertext: 'a', created_at: t0(), expires_at: t0() + 1000 }));
    for (let i = 0; i < rows.length; i += 50) await knex('relay_approvals').insert(rows.slice(i, i + 50));
    await expect(relay.create(knex, { workspaceId: busy, ciphertext: 'abc', publicBase: 'https://x.test' })).rejects.toMatchObject({ status: 429 });
  });

  test('the public answer endpoint rejects unreadable answers', async () => {
    const made = await relay.create(knex, { workspaceId: wsId, ciphertext: 'abc', publicBase: 'https://x.test' });
    const r = await request(app).post(`/v1/approvals/${made.id}/response`).send({ response: '<b>hi</b>' });
    expect(r.status).toBe(400);
  });
});
