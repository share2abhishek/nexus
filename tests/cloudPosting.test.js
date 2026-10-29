// Cloud posting on the app side: copies follow the schedule; the PC takes them
// back at posting time; results from the cloud are recorded
jest.mock('axios');
jest.mock('../services/license', () => ({ serverUrl: () => 'https://lic.test', licenseProof: () => 'PROOF', status: () => ({ can_publish: true }) }));
const axios = require('axios');
const { makeTestKnex } = require('./helpers/db');
const cloud = require('../services/cloudPosting');

let knex, ws, itemId;
const future = () => Math.floor(Date.now() / 1000) + 3600;
beforeAll(async () => {
  knex = makeTestKnex();
  await knex.migrate.latest();
  const [o] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
  const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'W', slug: 'w' }).returning('id');
  ws = w?.id ?? w;
  await require('../repos/socialAccountsRepo')(knex).add(ws, { platform: 'facebook', external_id: 'u', access_token: 'u', page_token: 'PT', page_id: 'P' });
  const [i] = await knex('content_items').insert({ workspace_id: ws, body: 'Cloud post', platforms: '["facebook"]', status: 'scheduled', scheduled_at: future(), options: JSON.stringify({ cloud: true }) }).returning('id');
  itemId = i?.id ?? i;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { console.warn.mockRestore(); return knex.destroy(); });
beforeEach(() => { jest.resetAllMocks(); cloud._reset(); });

test('a scheduled cloud post is handed over once, with the Page login', async () => {
  axios.get.mockResolvedValue({ data: { enabled: true } });
  axios.post.mockResolvedValue({ data: { id: 'J1', owner: 'OWN' } });
  await cloud.sync(knex);
  await cloud.sync(knex); // nothing changed: not handed over twice
  expect(axios.post).toHaveBeenCalledTimes(1);
  const [url, body] = axios.post.mock.calls[0];
  expect(url).toBe('https://lic.test/v1/cloud/jobs');
  expect(body).toMatchObject({ platform: 'facebook', text: 'Cloud post', account: { page_id: 'P', page_token: 'PT' } });
  expect((await knex('cloud_jobs').first()).status).toBe('waiting');
});

test('editing the post replaces the copy', async () => {
  await knex('content_items').where({ id: itemId }).update({ body: 'Cloud post (edited)' });
  axios.get.mockResolvedValue({ data: { enabled: true } });
  axios.delete.mockResolvedValue({ data: { ok: true } });
  axios.post.mockResolvedValue({ data: { id: 'J2', owner: 'OWN2' } });
  await cloud.sync(knex);
  expect(axios.delete.mock.calls[0][0]).toBe('https://lic.test/v1/cloud/jobs/J1');
  expect(axios.post.mock.calls[0][1].text).toBe('Cloud post (edited)');
});

test('at posting time the PC takes the copy back and posts itself', async () => {
  axios.delete.mockResolvedValue({ data: { ok: true } });
  const item = await knex('content_items').where({ id: itemId }).first();
  expect(await cloud.takeOver(knex, item)).toEqual({});
  expect((await knex('cloud_jobs').where({ job_id: 'J2' }).first()).status).toBe('taken_back');
});

test('if the cloud already posted, the PC does not post again', async () => {
  await knex('cloud_jobs').insert({ workspace_id: ws, content_item_id: itemId, platform: 'facebook', job_id: 'J3', owner_token: 'O3', run_at: future(), status: 'waiting', created_at: 1 });
  axios.delete.mockRejectedValue(Object.assign(new Error('409'), { response: { status: 409, data: { status: 'done', result: { success: true, id: 'P_9' } } } }));
  const item = await knex('content_items').where({ id: itemId }).first();
  expect(await cloud.takeOver(knex, item)).toEqual({ facebook: { platform: 'facebook', success: true, id: 'P_9', cloud: true } });
});

test('a post the cloud made while the PC was off is recorded as published', async () => {
  const [i] = await knex('content_items').insert({ workspace_id: ws, body: 'While off', platforms: '["facebook"]', status: 'scheduled', scheduled_at: 1000, options: JSON.stringify({ cloud: true }) }).returning('id');
  const id = i?.id ?? i;
  await knex('cloud_jobs').insert({ workspace_id: ws, content_item_id: id, platform: 'facebook', job_id: 'J4', owner_token: 'O4', run_at: 1000, fingerprint: 'x', status: 'waiting', created_at: 1 });
  axios.get.mockImplementation(async (url) => (url.endsWith('/status') ? { data: { enabled: true } } : { data: { status: 'done', result: { success: true, id: 'P_10' } } }));
  axios.post.mockResolvedValue({ data: { id: 'Jx', owner: 'Ox' } });
  await cloud.sync(knex);
  expect((await knex('content_items').where({ id }).first()).status).toBe('published');
  expect(await knex('posts').where({ content: 'While off' }).first()).toBeTruthy();
});

test('if the cloud could post only some platforms, Retry posts just the rest', async () => {
  const [i] = await knex('content_items').insert({ workspace_id: ws, body: 'Mixed', platforms: '["facebook","bluesky"]', status: 'scheduled', scheduled_at: 1000, options: JSON.stringify({ cloud: true }) }).returning('id');
  const id = i?.id ?? i;
  await knex('cloud_jobs').insert({ workspace_id: ws, content_item_id: id, platform: 'facebook', job_id: 'J5', owner_token: 'O5', run_at: 1000, fingerprint: 'x', status: 'done', result: JSON.stringify({ success: true, id: 'P_5' }), created_at: 1 });
  await cloud.settle(knex, id);
  const item = await knex('content_items').where({ id }).first();
  expect(item.status).toBe('failed');
  expect(item.error_message).toMatch(/Not posted yet: bluesky/);
  // Retry: Facebook counts as done, not posted again
  expect(await cloud.takeOver(knex, item)).toEqual({ facebook: { platform: 'facebook', success: true, id: 'P_5', cloud: true } });
});
