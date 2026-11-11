// Real analytics from the platforms, and best times from the workspace's own results
jest.mock('axios');
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const insights = require('../services/insights');

let knex, wsId;
beforeAll(async () => {
  knex = makeTestKnex();
  await knex.migrate.latest();
  const [o] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
  const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'W', slug: 'w' }).returning('id');
  wsId = w?.id ?? w;
  await knex('social_accounts').insert([
    { workspace_id: wsId, platform: 'facebook', external_id: 'u1', access_token: 'u', page_token: 'pt', page_id: 'P' },
    { workspace_id: wsId, platform: 'instagram', external_id: 'ig', access_token: 'u', page_token: 'pt', ig_account_id: 'IG' },
  ]);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(async () => { console.warn.mockRestore(); await knex.destroy(); });

const addPost = async (results, createdAt = Math.floor(Date.now() / 1000)) => {
  const [r] = await knex('posts').insert({
    workspace_id: wsId, user_id: 1, content: 'x', platforms: '[]', results: JSON.stringify(results), status: 'published', created_at: createdAt,
  }).returning('id');
  return r?.id ?? r;
};

test('fetches Facebook and Instagram numbers for recent posts and keeps only the latest', async () => {
  const postId = await addPost([
    { platform: 'facebook', success: true, id: 'P_1' },
    { platform: 'instagram', success: true, id: 'M1' },
    { platform: 'linkedin', success: true, id: 'urn:li:share:1' }, // not available: skipped
    { platform: 'facebook', success: false, error: 'x' },
  ]);
  axios.get.mockImplementation(async (url, { params }) => {
    if (url.endsWith('/P_1')) return { data: { reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } } };
    if (url.endsWith('/P_1/insights')) return { data: { data: [{ name: 'post_total_media_view_unique', values: [{ value: 400 }] }] } };
    if (url.endsWith('/M1')) return { data: { like_count: 30, comments_count: 4 } };
    if (url.endsWith('/M1/insights')) throw Object.assign(new Error('no permission'), { response: { status: 400 } });
    throw new Error('unexpected ' + url + JSON.stringify(params));
  });

  expect(await insights.refresh(knex, { workspaceId: wsId })).toEqual({ updated: 2, failed: 0 });
  await insights.refresh(knex, { workspaceId: wsId }); // second run replaces, doesn't add
  const rows = await knex('analytics').where({ post_id: postId }).orderBy('platform');
  expect(rows.map(r => [r.platform, r.likes, r.comments, r.shares, r.impressions])).toEqual([
    ['facebook', 12, 3, 2, 400],
    ['instagram', 30, 4, 0, 0],
  ]);
});

test('best times need a few posts, then rank weekday and hour by engagement', async () => {
  expect((await insights.bestTimes(knex, wsId, { minPosts: 50 })).enough).toBe(false);
  const r = await insights.bestTimes(knex, wsId, { minPosts: 1 });
  expect(r.enough).toBe(true);
  expect(r.slots[0]).toHaveProperty('weekday');
  expect(r.slots[0].average).toBeGreaterThan(0);
});
