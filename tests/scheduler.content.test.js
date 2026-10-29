const { makeTestKnex } = require('./helpers/db');
const contentRepoFactory = require('../repos/contentRepo');

jest.mock('../services/social', () => ({ postToPlatform: jest.fn() }));
const { postToPlatform } = require('../services/social');

async function makeWorkspace(knex, name, slug) {
  const orgRows = await knex('organizations').insert({ name: `${name} Org`, owner_user_id: 1 }).returning('id');
  const orgId = orgRows[0]?.id ?? orgRows[0];
  const wsRows = await knex('workspaces').insert({ org_id: orgId, name, slug }).returning('id');
  return wsRows[0]?.id ?? wsRows[0];
}

describe('scheduler — processDueContent', () => {
  let knex, contentRepo, workspaceId, processDueContent;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    contentRepo = contentRepoFactory(knex);
    workspaceId = await makeWorkspace(knex, 'Scheduler Content WS', 'scheduler-content-ws');
    // processDueContent is constructed by the scheduler module from (knex, contentRepo)
    ({ processDueContent } = require('../services/scheduler'));
  });

  afterAll(async () => { await knex.destroy(); });
  beforeEach(async () => {
    postToPlatform.mockReset();
    await knex('content_items').del();
    await knex('social_accounts').del();
  });

  async function makeAccount(platform) {
    const rows = await knex('social_accounts').insert({
      workspace_id: workspaceId, platform, external_id: `${platform}-1`,
      access_token: 'token', refresh_token: 'refresh', page_token: 'page-token',
      page_id: 'page-1', ig_account_id: 'ig-1', board_id: 'board-1',
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  }

  test('publishes a due item when every platform succeeds', async () => {
    const accountId = await makeAccount('linkedin');
    const id = await contentRepo.create(workspaceId, 1, { body: 'Go live', platforms: ['linkedin'], social_account_ids: [accountId] });
    await knex('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: Math.floor(Date.now() / 1000) - 5 });
    postToPlatform.mockResolvedValue({ success: true, url: 'https://example.com/post/1' });

    await processDueContent(knex, contentRepo);

    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('published');
    expect(item.published_at).not.toBeNull();
    expect(postToPlatform).toHaveBeenCalledWith('linkedin', expect.objectContaining({ access_token: 'token' }), 'Go live', null);
  });

  test('does not post an item that is more than 6 hours overdue (marks it missed)', async () => {
    const accountId = await makeAccount('linkedin');
    const id = await contentRepo.create(workspaceId, 1, { body: 'Happy Diwali', platforms: ['linkedin'], social_account_ids: [accountId] });
    await knex('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: Math.floor(Date.now() / 1000) - 3 * 86400 });

    await processDueContent(knex, contentRepo);

    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('failed');
    expect(item.error_message).toMatch(/^Missed/);
    expect(postToPlatform).not.toHaveBeenCalled();
  });

  test('a post scheduled from Compose (platform only) publishes via the connected account, shows on the calendar and in history', async () => {
    await makeAccount('linkedin');
    const scheduledRepo = require('../repos/scheduledRepo')(knex);
    const now = Math.floor(Date.now() / 1000);
    const id = await scheduledRepo.save(workspaceId, 1, { content: 'From Compose', platforms: ['linkedin'], scheduled_at: now + 3600 });

    // same data as the calendar
    const onCalendar = await contentRepo.list(workspaceId, { from: now, to: now + 7200 });
    expect(onCalendar.map(i => i.id)).toContain(id);
    expect((await scheduledRepo.listPending(workspaceId))[0]).toMatchObject({ id, content: 'From Compose', status: 'pending' });

    await knex('content_items').where({ id }).update({ scheduled_at: now - 5 });
    postToPlatform.mockResolvedValue({ success: true });
    await processDueContent(knex, contentRepo);

    expect((await contentRepo.getById(workspaceId, id)).status).toBe('published');
    expect(postToPlatform).toHaveBeenCalledWith('linkedin', expect.objectContaining({ access_token: 'token' }), 'From Compose', null);
    const history = await knex('posts').where({ workspace_id: workspaceId, content: 'From Compose' });
    expect(history).toHaveLength(1);
  });

  test('a platform that is not connected gives a clear message', async () => {
    const scheduledRepo = require('../repos/scheduledRepo')(knex);
    const id = await scheduledRepo.save(workspaceId, 1, { content: 'No account', platforms: ['pinterest'], scheduled_at: Math.floor(Date.now() / 1000) - 5 });
    await processDueContent(knex, contentRepo);
    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('failed');
    expect(item.error_message).toMatch(/pinterest isn't connected/);
    expect((await scheduledRepo.listRecentFailed(workspaceId))[0]).toMatchObject({ id, status: 'failed' });
  });

  test('marks an item failed when every platform fails', async () => {
    const accountId = await makeAccount('twitter');
    const id = await contentRepo.create(workspaceId, 1, { body: 'Will not post', platforms: ['twitter'], social_account_ids: [accountId] });
    await knex('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: Math.floor(Date.now() / 1000) - 5 });
    postToPlatform.mockResolvedValue({ success: false, error: 'Token expired' });

    await processDueContent(knex, contentRepo);

    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('failed');
    expect(item.error_message).toEqual(expect.stringContaining('Token expired'));
  });

  test('publishes when at least one platform succeeds (partial success counts as published)', async () => {
    const linkedinAccount = await makeAccount('linkedin');
    const twitterAccount = await makeAccount('twitter');
    const id = await contentRepo.create(workspaceId, 1, { body: 'Mixed results', platforms: ['linkedin', 'twitter'], social_account_ids: [linkedinAccount, twitterAccount] });
    await knex('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: Math.floor(Date.now() / 1000) - 5 });
    postToPlatform
      .mockResolvedValueOnce({ success: true, url: 'https://example.com/post/2' })
      .mockResolvedValueOnce({ success: false, error: 'Rate limited' });

    await processDueContent(knex, contentRepo);

    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('published');
  });

  test('marks failed when a referenced social account no longer exists', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Orphaned account', platforms: ['linkedin'], social_account_ids: [999999] });
    await knex('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: Math.floor(Date.now() / 1000) - 5 });

    await processDueContent(knex, contentRepo);

    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('failed');
    expect(item.error_message).toMatch(/isn't connected|disconnected/);
    expect(postToPlatform).not.toHaveBeenCalled();
  });

  test('does not touch items that are not yet due', async () => {
    const accountId = await makeAccount('linkedin');
    const id = await contentRepo.create(workspaceId, 1, { body: 'Future post', platforms: ['linkedin'], social_account_ids: [accountId] });
    await knex('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: Math.floor(Date.now() / 1000) + 3600 });

    await processDueContent(knex, contentRepo);

    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('scheduled');
    expect(postToPlatform).not.toHaveBeenCalled();
  });
});
