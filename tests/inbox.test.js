// Inbox: new comments on published posts are collected once; replies are posted
jest.mock('axios');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const inbox = require('../services/inbox');
const { GRAPH } = require('../services/platforms/apiVersions');

let knex, ws;
beforeAll(async () => {
  knex = makeTestKnex();
  await knex.migrate.latest();
  const [o] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
  const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'W', slug: 'w' }).returning('id');
  ws = w?.id ?? w;
  await require('../repos/socialAccountsRepo')(knex).add(ws, { platform: 'facebook', external_id: 'u', access_token: 'u', page_token: 'PT', page_id: 'PAGE' });
  await knex('posts').insert({ workspace_id: ws, user_id: 1, content: 'Diwali offer', platforms: '["facebook"]', results: JSON.stringify([{ platform: 'facebook', success: true, id: 'PAGE_1' }]), status: 'published', created_at: Math.floor(Date.now() / 1000) });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { console.warn.mockRestore(); return knex.destroy(); });

test('collects new comments once, leaving out the Page’s own', async () => {
  axios.get.mockResolvedValue({ data: { data: [
    { id: 'c1', from: { id: '99', name: 'Ravi' }, message: 'Is it open on Sunday?', created_time: '2026-10-29T10:00:00+0000' },
    { id: 'c2', from: { id: 'PAGE', name: 'Chai Point' }, message: 'Yes!', created_time: '2026-10-29T10:05:00+0000' },
  ] } });
  expect(await inbox.refresh(knex, { workspaceId: ws })).toBe(1);
  expect(await inbox.refresh(knex, { workspaceId: ws })).toBe(0); // not twice
  expect(axios.get.mock.calls[0][0]).toBe(`${GRAPH}/PAGE_1/comments`);
  const items = await knex('inbox_items');
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ author_name: 'Ravi', text: 'Is it open on Sunday?', is_read: 0 });
});

test('a reply is posted under the comment with the Page login', async () => {
  const item = await knex('inbox_items').first();
  axios.post.mockResolvedValue({ data: { id: 'r1' } });
  await inbox.reply(knex, ws, 1, item.id, 'Yes, 8am to 10pm!');
  expect(axios.post.mock.calls[0]).toEqual([`${GRAPH}/c1/comments`, { message: 'Yes, 8am to 10pm!', access_token: 'PT' }]);
  const after = await knex('inbox_items').where({ id: item.id }).first();
  expect(after).toMatchObject({ is_read: 1, reply_text: 'Yes, 8am to 10pm!' });
});
