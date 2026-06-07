const { makeTestKnex } = require('./helpers/db');
const contentRepoFactory = require('../repos/contentRepo');

async function makeWorkspace(knex, name, slug) {
  const orgRows = await knex('organizations').insert({ name: `${name} Org`, owner_user_id: 1 }).returning('id');
  const orgId = orgRows[0]?.id ?? orgRows[0];
  const wsRows = await knex('workspaces').insert({ org_id: orgId, name, slug }).returning('id');
  return wsRows[0]?.id ?? wsRows[0];
}

describe('contentRepo CRUD', () => {
  let knex, contentRepo, workspaceId, otherWorkspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    contentRepo = contentRepoFactory(knex);
    workspaceId = await makeWorkspace(knex, 'Test WS', 'test-ws');
    otherWorkspaceId = await makeWorkspace(knex, 'Other WS', 'other-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  test('create + getById round trip with defaults', async () => {
    const id = await contentRepo.create(workspaceId, 1, { title: 'Launch post', body: 'Hello world', platforms: ['linkedin'] });
    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('draft');
    expect(item.title).toBe('Launch post');
    expect(item.body).toBe('Hello world');
    expect(item.platforms).toEqual(['linkedin']);
    expect(item.social_account_ids).toEqual([]);
    expect(item.submitted_by).toBe(1);
  });

  test('getById returns null for an item in another workspace', async () => {
    const id = await contentRepo.create(otherWorkspaceId, 2, { body: 'Not yours', platforms: [] });
    expect(await contentRepo.getById(workspaceId, id)).toBeNull();
    expect(await contentRepo.getById(otherWorkspaceId, id)).not.toBeNull();
  });

  test('list scopes by workspace_id and supports a status filter', async () => {
    const draftId = await contentRepo.create(workspaceId, 1, { body: 'Filter me', platforms: [] });
    await knex('content_items').insert({ workspace_id: otherWorkspaceId, body: 'Other workspace post', status: 'draft' });

    const mine = await contentRepo.list(workspaceId);
    expect(mine.some(i => i.id === draftId)).toBe(true);
    expect(mine.every(i => i.body !== 'Other workspace post')).toBe(true);

    const onlyDrafts = await contentRepo.list(workspaceId, { status: 'draft' });
    expect(onlyDrafts.some(i => i.id === draftId)).toBe(true);
    const onlyPublished = await contentRepo.list(workspaceId, { status: 'published' });
    expect(onlyPublished.some(i => i.id === draftId)).toBe(false);
  });

  test('list supports limit/offset pagination', async () => {
    for (let i = 0; i < 3; i++) await contentRepo.create(workspaceId, 1, { body: `Page item ${i}`, platforms: [] });
    const page1 = await contentRepo.list(workspaceId, { limit: 1, offset: 0 });
    const page2 = await contentRepo.list(workspaceId, { limit: 1, offset: 1 });
    expect(page1.length).toBe(1);
    expect(page2.length).toBe(1);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  test('list with from/to matches scheduled_at OR created_at within range', async () => {
    const now = Math.floor(Date.now() / 1000);
    const draftId = await contentRepo.create(workspaceId, 1, { body: 'Created now, no schedule', platforms: [] });
    const scheduledId = await contentRepo.create(workspaceId, 1, { body: 'Scheduled far away', platforms: [] });
    await knex('content_items').where({ id: scheduledId }).update({ status: 'scheduled', scheduled_at: now + 100000, created_at: now - 100000 });

    const inRange = await contentRepo.list(workspaceId, { from: now - 10, to: now + 10 });
    const ids = inRange.map(i => i.id);
    expect(ids).toContain(draftId);
    expect(ids).not.toContain(scheduledId);

    const futureRange = await contentRepo.list(workspaceId, { from: now + 99000, to: now + 101000 });
    expect(futureRange.map(i => i.id)).toContain(scheduledId);
  });

  test('update edits fields, bumps updated_at, and leaves status untouched for non-failed items', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Original', platforms: [] });
    await knex('content_items').where({ id }).update({ updated_at: 1000, status: 'in_review' });

    const updated = await contentRepo.update(workspaceId, id, { body: 'Edited', platforms: ['twitter'] });
    expect(updated.body).toBe('Edited');
    expect(updated.platforms).toEqual(['twitter']);
    expect(updated.status).toBe('in_review');
    expect(updated.updated_at).toBeGreaterThan(1000);
  });

  test('update on a failed item resets it to draft and clears error_message', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Will fail', platforms: [] });
    await knex('content_items').where({ id }).update({ status: 'failed', error_message: 'boom' });

    const updated = await contentRepo.update(workspaceId, id, { body: 'Retry me' });
    expect(updated.status).toBe('draft');
    expect(updated.error_message).toBeNull();
    expect(updated.body).toBe('Retry me');
  });

  test('update returns null for an item in another workspace', async () => {
    const id = await contentRepo.create(otherWorkspaceId, 1, { body: 'Theirs', platforms: [] });
    expect(await contentRepo.update(workspaceId, id, { body: 'Hijack' })).toBeNull();
  });

  test('remove deletes the item scoped to its workspace', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Delete me', platforms: [] });
    const deletedCount = await contentRepo.remove(workspaceId, id);
    expect(deletedCount).toBe(1);
    expect(await contentRepo.getById(workspaceId, id)).toBeNull();
  });

  test('remove is a no-op for an item in another workspace', async () => {
    const id = await contentRepo.create(otherWorkspaceId, 1, { body: 'Theirs', platforms: [] });
    expect(await contentRepo.remove(workspaceId, id)).toBe(0);
    expect(await contentRepo.getById(otherWorkspaceId, id)).not.toBeNull();
  });
});

describe('contentRepo.transition', () => {
  let knex, contentRepo, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    contentRepo = contentRepoFactory(knex);
    workspaceId = await makeWorkspace(knex, 'Transition WS', 'transition-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  test('draft -> in_review is valid and clears reviewed_by', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Submit me', platforms: [] });
    const result = await contentRepo.transition(workspaceId, id, { toStatus: 'in_review', userId: 1 });
    expect(result.ok).toBe(true);
    expect(result.item.status).toBe('in_review');
    expect(result.item.reviewed_by).toBeNull();
  });

  test('in_review -> approved sets approved_by to the acting user', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Approve me', platforms: [] });
    await contentRepo.transition(workspaceId, id, { toStatus: 'in_review', userId: 1 });
    const result = await contentRepo.transition(workspaceId, id, { toStatus: 'approved', userId: 7 });
    expect(result.ok).toBe(true);
    expect(result.item.status).toBe('approved');
    expect(result.item.approved_by).toBe(7);
  });

  test('in_review -> draft (reject) clears reviewed_by and approved_by', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Reject me', platforms: [] });
    await contentRepo.transition(workspaceId, id, { toStatus: 'in_review', userId: 1 });
    const result = await contentRepo.transition(workspaceId, id, { toStatus: 'draft', userId: 7 });
    expect(result.ok).toBe(true);
    expect(result.item.status).toBe('draft');
    expect(result.item.reviewed_by).toBeNull();
    expect(result.item.approved_by).toBeNull();
  });

  test('approved -> draft (unapprove) clears reviewed_by and approved_by', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Unapprove me', platforms: [] });
    await contentRepo.transition(workspaceId, id, { toStatus: 'in_review', userId: 1 });
    await contentRepo.transition(workspaceId, id, { toStatus: 'approved', userId: 7 });
    const result = await contentRepo.transition(workspaceId, id, { toStatus: 'draft', userId: 7 });
    expect(result.ok).toBe(true);
    expect(result.item.status).toBe('draft');
    expect(result.item.approved_by).toBeNull();
  });

  test('approved -> scheduled stores the provided scheduled_at', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Schedule me', platforms: [] });
    await contentRepo.transition(workspaceId, id, { toStatus: 'in_review', userId: 1 });
    await contentRepo.transition(workspaceId, id, { toStatus: 'approved', userId: 7 });
    const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
    const result = await contentRepo.transition(workspaceId, id, { toStatus: 'scheduled', userId: 7, fields: { scheduled_at: futureEpoch } });
    expect(result.ok).toBe(true);
    expect(result.item.status).toBe('scheduled');
    expect(result.item.scheduled_at).toBe(futureEpoch);
  });

  test('scheduled -> approved (cancel) clears scheduled_at and preserves approval', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Cancel me', platforms: [] });
    await contentRepo.transition(workspaceId, id, { toStatus: 'in_review', userId: 1 });
    await contentRepo.transition(workspaceId, id, { toStatus: 'approved', userId: 7 });
    const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
    await contentRepo.transition(workspaceId, id, { toStatus: 'scheduled', userId: 7, fields: { scheduled_at: futureEpoch } });

    const result = await contentRepo.transition(workspaceId, id, { toStatus: 'approved', userId: 7 });
    expect(result.ok).toBe(true);
    expect(result.item.status).toBe('approved');
    expect(result.item.scheduled_at).toBeNull();
    expect(result.item.approved_by).toBe(7);
  });

  test('rejects an invalid transition (draft -> published) and leaves the item untouched', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Cannot skip review', platforms: [] });
    const result = await contentRepo.transition(workspaceId, id, { toStatus: 'published', userId: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_transition');
    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('draft');
  });

  test('rejects a transition from failed (must go through update, not transition)', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Stuck in failed', platforms: [] });
    await knex('content_items').where({ id }).update({ status: 'failed', error_message: 'boom' });
    const result = await contentRepo.transition(workspaceId, id, { toStatus: 'draft', userId: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_transition');
  });

  test('returns not_found for an item in another workspace', async () => {
    const otherWorkspaceId = await makeWorkspace(knex, 'Transition Other WS', 'transition-other-ws');
    const id = await contentRepo.create(otherWorkspaceId, 1, { body: 'Not yours', platforms: [] });
    const result = await contentRepo.transition(workspaceId, id, { toStatus: 'in_review', userId: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
  });
});
