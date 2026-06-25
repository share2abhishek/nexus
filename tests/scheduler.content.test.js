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
    expect(item.error_message).toEqual(expect.stringContaining('Account not found'));
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
