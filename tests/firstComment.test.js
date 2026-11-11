// First comment on Facebook / Instagram: clear reasons when Meta refuses, a retry
// when a new post isn't ready yet, the "add it after N minutes" timer, and the
// status shown on the Calendar. Meta's API is a stand-in.
jest.mock('axios', () => {
  const post = jest.fn();
  const get = jest.fn();
  return { post, get, create: () => ({ post, get }), default: { post, get } };
});
jest.mock('../services/social', () => ({ postToPlatform: jest.fn() }));
jest.mock('../services/cloudPosting', () => ({ takeOver: async () => ({}) }));
jest.mock('../services/tokenRefresher', () => ({ ensureFresh: async () => {}, checkFacebook: async () => {} }));

const axios = require('axios');
const fc = require('../services/firstComment');
const { cleanOptions } = require('../services/postOptions');
const { makeTestKnex } = require('./helpers/db');

const metaError = (code, message) => Object.assign(new Error(message), { response: { status: 400, data: { error: { code, message } } } });

describe('first comment: posting right away', () => {
  beforeEach(() => axios.post.mockReset());

  test('a post that isn’t ready yet is retried, then the comment is added', async () => {
    axios.post.mockRejectedValueOnce(metaError(9007, 'Media ID is not available')).mockResolvedValueOnce({ data: { id: 'c1' } });
    const r = await fc.postNow('instagram', 'M1', '#diwali', 'tok', { waits: [0, 0] });
    expect(r).toEqual({ ok: true, id: 'c1' });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('a missing permission isn’t retried and says what to do', async () => {
    axios.post.mockRejectedValue(metaError(10, 'Application does not have permission for this action'));
    const r = await fc.postNow('instagram', 'M1', '#diwali', 'tok', { waits: [0, 0] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Connect on the Instagram card/);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('Facebook and Instagram posts report what happened to the comment', async () => {
    jest.unmock('../services/social');
    const { postToFacebook } = jest.requireActual('../services/platforms/facebook');
    axios.post.mockImplementation(async (url) => {
      if (url.endsWith('/feed')) return { data: { id: 'P_1' } };
      throw metaError(200, 'Permissions error');
    });
    const r = await postToFacebook('pt', 'P', 'Hello', null, { options: { first_comment: 'Order on WhatsApp' } });
    expect(r).toMatchObject({ success: true, comment: 'failed' });
    expect(r.warning).toMatch(/first comment wasn’t added.*Connect on the Facebook card/);

    // with a delay: not posted now, handed back to be queued
    axios.post.mockReset().mockResolvedValue({ data: { id: 'P_2' } });
    const d = await postToFacebook('pt', 'P', 'Hello', null, { options: { first_comment: 'Order', first_comment_delay: 5 } });
    expect(d.comment_pending).toEqual({ target_id: 'P_2' });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

describe('first comment: options', () => {
  test('the delay is one of the offered choices, and only kept with a comment', () => {
    expect(cleanOptions({ first_comment: 'hi', first_comment_delay: 5 })).toEqual({ first_comment: 'hi', first_comment_delay: 5 });
    expect(cleanOptions({ first_comment: 'hi', first_comment_delay: 0 })).toEqual({ first_comment: 'hi' });
    expect(cleanOptions({ first_comment_delay: 5 })).toBeNull();
    expect(() => cleanOptions({ first_comment: 'hi', first_comment_delay: 7 })).toThrow(/1, 2, 5, 10, 15, 30 or 60/);
  });
});

describe('first comment: the timer and the Calendar', () => {
  let knex, ws, account, repo;
  const social = require('../services/social');
  const { publishItem } = require('../services/scheduler');

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'W', slug: 'w' }).returning('id');
    ws = w?.id ?? w;
    const [a] = await knex('social_accounts').insert({ workspace_id: ws, platform: 'instagram', external_id: 'IG1', access_token: 'u', page_token: 'pt', ig_account_id: 'IG1' }).returning('id');
    account = a?.id ?? a;
    repo = require('../repos/contentRepo')(knex);
  }, 30000);
  afterAll(() => knex.destroy());
  beforeEach(() => { axios.post.mockReset(); social.postToPlatform.mockReset(); });

  const newItem = async (options) => {
    const id = await repo.create(ws, 1, { body: 'New menu', platforms: ['instagram'], social_account_ids: [account], options });
    return repo.getById(ws, id);
  };

  test('“5 minutes after”: queued when the post goes out, added once it’s due', async () => {
    social.postToPlatform.mockResolvedValue({ success: true, id: 'M9', comment_pending: { target_id: 'M9' } });
    const item = await newItem({ first_comment: '#newmenu', first_comment_delay: 5 });
    const { results } = await publishItem(knex, repo, item);
    expect(results[0]).toMatchObject({ success: true, comment: 'in 5 min' });
    const [row] = await knex('post_comments').where({ content_item_id: item.id });
    expect(row).toMatchObject({ status: 'pending', target_id: 'M9', message: '#newmenu' });
    expect(row.due_at - row.created_at).toBe(300);

    // not due yet: nothing happens
    await fc.processDue(knex);
    expect(axios.post).not.toHaveBeenCalled();

    // due: added with the Page token
    await knex('post_comments').where({ id: row.id }).update({ due_at: 1 });
    axios.post.mockResolvedValue({ data: { id: 'c9' } });
    await fc.processDue(knex);
    expect(axios.post.mock.calls[0][0]).toMatch(/\/M9\/comments$/);
    expect(axios.post.mock.calls[0][1]).toMatchObject({ message: '#newmenu', access_token: 'pt' });
    expect(await fc.forItem(knex, ws, item.id)).toEqual([expect.objectContaining({ platform: 'instagram', status: 'done' })]);
  });

  test('a delayed comment Meta refuses is tried again, then shown as not added with the reason', async () => {
    social.postToPlatform.mockResolvedValue({ success: true, id: 'M10', comment_pending: { target_id: 'M10' } });
    const item = await newItem({ first_comment: 'hi', first_comment_delay: 1 });
    await publishItem(knex, repo, item);
    axios.post.mockRejectedValue(Object.assign(new Error('busy'), { response: { status: 500 } }));
    for (let i = 0; i < 3; i++) {
      await knex('post_comments').where({ content_item_id: item.id }).update({ due_at: 1 });
      await fc.processDue(knex);
    }
    const [row] = await knex('post_comments').where({ content_item_id: item.id });
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(3);
  });

  test('a comment added right away is noted for the Calendar too', async () => {
    social.postToPlatform.mockResolvedValue({ success: true, id: 'M11', comment: 'failed', comment_error: 'Instagram didn’t allow the comment' });
    const item = await newItem({ first_comment: 'hi' });
    await publishItem(knex, repo, item);
    expect(await fc.forItem(knex, ws, item.id)).toEqual([expect.objectContaining({ status: 'failed', error: 'Instagram didn’t allow the comment' })]);
  });

  test('after signing in, it notes whether comments are allowed on each account', async () => {
    axios.get.mockResolvedValue({ data: { data: [{ permission: 'instagram_content_publish', status: 'granted' }, { permission: 'instagram_manage_comments', status: 'declined' }] } });
    await fc.recordCommentPermissions(knex, ws, 'u');
    const row = await knex('social_accounts').where({ id: account }).first();
    expect(JSON.parse(row.profile_json).can_comment).toBe(false);
  });
});
