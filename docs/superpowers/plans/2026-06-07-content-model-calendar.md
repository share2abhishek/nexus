# Unified Content Model & Calendar (Phase 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-scoped `content_items` lifecycle (draft → in_review → approved → scheduled → published / failed) with a repo, REST routes, AI Assist, calendar UI, and scheduler integration — replacing the calendar's `scheduled_posts`-only view with a full six-state content pipeline, while leaving Quick Post and the legacy `scheduled_posts`/`posts` tables untouched.

**Architecture:** A new `content_items` table (+ `content_item_comments`) follows the Phase 1a tenancy pattern (`workspace_id` FK, epoch-second integer timestamps, `text` columns for JSON). `repos/contentRepo.js` is a workspace-scoped factory exposing CRUD plus a `transition()` state-machine guard. `routes/content.js` is a plain factory `(knex, requirePermission) => router` mounted at `/api/content` exactly like `routes/api.js`/`routes/seo.js` (NOT the `social-accounts.js` `mergeParams` pattern — `withWorkspace`/`injectUserKeys` already run once for the whole `/api/*` family). `services/aiAssist.js` is a thin prompt-building wrapper around the existing `aiGenerate()` (which already implements the full Ollama → Gemini → Claude routing chain — no new model-routing logic). The calendar UI is rebuilt against `GET /api/content/calendar` with three views (month/week/agenda, week default), status filter chips, and a slide-in detail panel reusing the existing `.modal-overlay`/`.modal` CSS pattern. `services/scheduler.js` gains a second polling branch alongside its existing (untouched) `getDuePosts()` loop.

**Tech Stack:** Node.js/Express, Knex.js (dual SQLite/Postgres), Jest + Supertest, vanilla JS/HTML frontend (`public/app.js`/`public/index.html`), existing `services/aiHelper.js` AI routing, existing `services/rbac.js` permissions.

---

## Reference: spec

Full design: `docs/superpowers/specs/2026-06-07-content-model-calendar-design.md` (approved by user). All tasks below implement that spec; where the spec had gaps discovered during planning (scheduler function names, route factory signature, AI routing duplication, missing comments endpoint, an inconsistent Ollama-source-selector bullet with no corresponding selector control), the spec was corrected first (commits `1635ffe`, `c4936c0`, `b9be7e2`, `cc3d198`) and this plan reflects the corrected version.

## Reference: RBAC matrix (from `services/rbac.js`, unchanged by this phase)

```js
manager:  ['social.manage','members.manage','content.create','content.edit','content.submit',
           'content.approve','content.comment','content.publish','content.schedule',
           'content.view','analytics.view'],
creator:  ['content.create','content.edit','content.submit','content.view','analytics.view'],
reviewer: ['content.approve','content.comment','content.view','analytics.view'],
client:   ['content.approve','content.comment','content.view','analytics.view'],
analyst:  ['content.view','analytics.view'],
```

Note: `creator` lacks `content.approve`, `content.schedule`, AND `content.comment`. Only `manager` has `content.schedule`. Only `manager`/`reviewer`/`client` have `content.approve` and `content.comment`.

---

### Task 1: Migration — `content_items` + `content_item_comments`

**Files:**
- Create: `db/migrations/20260607000001_content_items.js`
- Test: `tests/content.migration.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/content.migration.test.js
const { makeTestKnex } = require('./helpers/db');

describe('content_items migration', () => {
  let knex;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
  });
  afterAll(async () => { await knex.destroy(); });

  test('creates content_items with the expected columns', async () => {
    expect(await knex.schema.hasTable('content_items')).toBe(true);
    for (const col of [
      'id', 'workspace_id', 'title', 'body', 'platforms', 'image_url',
      'social_account_ids', 'status', 'scheduled_at', 'published_at',
      'submitted_by', 'reviewed_by', 'approved_by', 'error_message',
      'created_at', 'updated_at',
    ]) {
      expect(await knex.schema.hasColumn('content_items', col)).toBe(true);
    }
  });

  test('creates content_item_comments with the expected columns', async () => {
    expect(await knex.schema.hasTable('content_item_comments')).toBe(true);
    for (const col of ['id', 'content_item_id', 'workspace_id', 'user_id', 'body', 'created_at']) {
      expect(await knex.schema.hasColumn('content_item_comments', col)).toBe(true);
    }
  });

  test('content_items defaults status to draft', async () => {
    const orgRows = await knex('organizations').insert({ name: 'T', owner_user_id: 1 }).returning('id');
    const orgId = orgRows[0]?.id ?? orgRows[0];
    const wsRows = await knex('workspaces').insert({ org_id: orgId, name: 'WS', slug: 'ws' }).returning('id');
    const workspaceId = wsRows[0]?.id ?? wsRows[0];

    const rows = await knex('content_items').insert({ workspace_id: workspaceId, body: 'Hello' }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    const row = await knex('content_items').where({ id }).first();
    expect(row.status).toBe('draft');
    expect(row.created_at).toBeGreaterThan(0);
    expect(row.updated_at).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/content.migration.test.js -v`
Expected: FAIL — `expect(await knex.schema.hasTable('content_items')).toBe(true)` receives `false` (table doesn't exist yet)

- [ ] **Step 3: Write the migration**

```js
// db/migrations/20260607000001_content_items.js
exports.up = async function (knex) {
  const epochDefault = knex.client.config.client === 'pg'
    ? knex.raw('extract(epoch from now())')
    : knex.raw("(strftime('%s','now'))");

  await knex.schema.createTable('content_items', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.text('title');
    t.text('body').notNullable();
    t.text('platforms');
    t.text('image_url');
    t.text('social_account_ids');
    t.string('status').notNullable().defaultTo('draft');
    t.bigInteger('scheduled_at');
    t.bigInteger('published_at');
    t.integer('submitted_by');
    t.integer('reviewed_by');
    t.integer('approved_by');
    t.text('error_message');
    t.bigInteger('created_at').notNullable().defaultTo(epochDefault);
    t.bigInteger('updated_at').notNullable().defaultTo(epochDefault);
    t.index(['workspace_id', 'status']);
    t.index(['workspace_id', 'scheduled_at']);
  });

  await knex.schema.createTable('content_item_comments', (t) => {
    t.increments('id').primary();
    t.integer('content_item_id').notNullable().references('id').inTable('content_items').onDelete('CASCADE');
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.integer('user_id').notNullable();
    t.text('body').notNullable();
    t.bigInteger('created_at').notNullable().defaultTo(epochDefault);
    t.index(['content_item_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('content_item_comments');
  await knex.schema.dropTableIfExists('content_items');
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/content.migration.test.js -v`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add db/migrations/20260607000001_content_items.js tests/content.migration.test.js
git commit -m "feat(content): add content_items + content_item_comments migration"
```

---

### Task 2: `repos/contentRepo.js` — CRUD (create, list, getById, update, remove)

**Files:**
- Create: `repos/contentRepo.js`
- Test: `tests/content.repo.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/content.repo.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/content.repo.test.js -v`
Expected: FAIL with `Cannot find module '../repos/contentRepo'`

- [ ] **Step 3: Write the repo CRUD implementation**

```js
// repos/contentRepo.js
function nowEpoch() { return Math.floor(Date.now() / 1000); }
function safe(v) { if (!v) return v; try { return JSON.parse(v); } catch { return v; } }

function deserialize(row) {
  if (!row) return row;
  return {
    ...row,
    platforms: safe(row.platforms) || [],
    social_account_ids: safe(row.social_account_ids) || [],
  };
}

module.exports = (knex) => ({
  async create(workspaceId, userId, data) {
    const rows = await knex('content_items').insert({
      workspace_id: workspaceId,
      title: data.title || null,
      body: data.body,
      platforms: JSON.stringify(data.platforms || []),
      image_url: data.image_url || null,
      social_account_ids: JSON.stringify(data.social_account_ids || []),
      status: 'draft',
      submitted_by: userId,
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },

  async list(workspaceId, { status, from, to, limit, offset } = {}) {
    let query = knex('content_items').where({ workspace_id: workspaceId });
    if (status) query = query.where({ status });
    if (from != null && to != null) {
      query = query.where((qb) => {
        qb.whereBetween('scheduled_at', [from, to]).orWhereBetween('created_at', [from, to]);
      });
    }
    query = query.orderBy('created_at', 'desc');
    if (limit != null) query = query.limit(limit);
    if (offset != null) query = query.offset(offset);
    const rows = await query;
    return rows.map(deserialize);
  },

  async getById(workspaceId, id) {
    const row = await knex('content_items').where({ workspace_id: workspaceId, id }).first();
    return row ? deserialize(row) : null;
  },

  async update(workspaceId, id, data) {
    const existing = await knex('content_items').where({ workspace_id: workspaceId, id }).first();
    if (!existing) return null;

    const patch = { updated_at: nowEpoch() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.body !== undefined) patch.body = data.body;
    if (data.platforms !== undefined) patch.platforms = JSON.stringify(data.platforms);
    if (data.image_url !== undefined) patch.image_url = data.image_url;
    if (data.social_account_ids !== undefined) patch.social_account_ids = JSON.stringify(data.social_account_ids);
    if (data.scheduled_at !== undefined) patch.scheduled_at = data.scheduled_at;

    if (existing.status === 'failed') {
      patch.status = 'draft';
      patch.error_message = null;
    }

    await knex('content_items').where({ workspace_id: workspaceId, id }).update(patch);
    return this.getById(workspaceId, id);
  },

  remove(workspaceId, id) {
    return knex('content_items').where({ workspace_id: workspaceId, id }).del();
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/content.repo.test.js -v`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add repos/contentRepo.js tests/content.repo.test.js
git commit -m "feat(content): add contentRepo CRUD (create, list, getById, update, remove)"
```

---

### Task 3: `repos/contentRepo.js` — state machine (`transition`)

**Files:**
- Modify: `repos/contentRepo.js`
- Test: `tests/content.repo.test.js`

This adds `transition()`, the defense-in-depth guard described in the spec's state machine table. It validates the requested edge against a `TRANSITIONS` map (only the system-reachable edges 3–8 — `failed → draft` is reachable only via `update()`, not `transition()`, per transition #11 in the spec) and writes the status plus any edge-specific fields atomically.

- [ ] **Step 1: Write the failing tests**

Append to `tests/content.repo.test.js` (a new top-level `describe` block, after the closing `});` of `describe('contentRepo CRUD', ...)`):

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/content.repo.test.js -t transition -v`
Expected: FAIL with `TypeError: contentRepo.transition is not a function`

- [ ] **Step 3: Add the `TRANSITIONS` map and `transition()` method**

Add this above `module.exports = (knex) => ({` in `repos/contentRepo.js`:

```js
const TRANSITIONS = {
  draft: {
    in_review: () => ({ reviewed_by: null }),
  },
  in_review: {
    draft: () => ({ reviewed_by: null, approved_by: null }),
    approved: (userId) => ({ approved_by: userId }),
  },
  approved: {
    draft: () => ({ reviewed_by: null, approved_by: null }),
    scheduled: (_userId, fields) => ({ scheduled_at: fields.scheduled_at }),
  },
  scheduled: {
    approved: () => ({ scheduled_at: null }),
  },
};
```

Then add the `transition` method inside the returned object (after `update`, before `remove`):

```js
  async transition(workspaceId, id, { toStatus, userId, fields = {} }) {
    const item = await knex('content_items').where({ workspace_id: workspaceId, id }).first();
    if (!item) return { ok: false, error: 'not_found' };

    const edges = TRANSITIONS[item.status];
    const buildPatch = edges && edges[toStatus];
    if (!buildPatch) return { ok: false, error: 'invalid_transition' };

    const patch = { status: toStatus, updated_at: nowEpoch(), ...buildPatch(userId, fields) };
    await knex('content_items').where({ workspace_id: workspaceId, id }).update(patch);
    return { ok: true, item: await this.getById(workspaceId, id) };
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/content.repo.test.js -v`
Expected: PASS (18/18 — 9 CRUD + 9 transition)

- [ ] **Step 5: Commit**

```bash
git add repos/contentRepo.js tests/content.repo.test.js
git commit -m "feat(content): add contentRepo state-machine transition() guard"
```

---

### Task 4: `repos/contentRepo.js` — scheduler helpers (`getDueForPublish`, `markPublished`, `markFailed`)

**Files:**
- Modify: `repos/contentRepo.js`
- Test: `tests/content.repo.test.js`

These three methods are called by `services/scheduler.js` (Task 10) — they are NOT workspace-scoped (the scheduler polls across all workspaces, mirroring how `getDuePosts()` in `services/database.js` has no workspace filter).

- [ ] **Step 1: Write the failing tests**

Append to `tests/content.repo.test.js`:

```js
describe('contentRepo scheduler helpers', () => {
  let knex, contentRepo, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    contentRepo = contentRepoFactory(knex);
    workspaceId = await makeWorkspace(knex, 'Scheduler WS', 'scheduler-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  test('getDueForPublish returns only scheduled items at/before the given time', async () => {
    const now = Math.floor(Date.now() / 1000);
    const past = now - 60;
    const future = now + 3600;

    const dueId = await contentRepo.create(workspaceId, 1, { body: 'Due', platforms: [] });
    await knex('content_items').where({ id: dueId }).update({ status: 'scheduled', scheduled_at: past });

    const notDueId = await contentRepo.create(workspaceId, 1, { body: 'Not due yet', platforms: [] });
    await knex('content_items').where({ id: notDueId }).update({ status: 'scheduled', scheduled_at: future });

    const draftId = await contentRepo.create(workspaceId, 1, { body: 'Still a draft', platforms: [] });
    await knex('content_items').where({ id: draftId }).update({ scheduled_at: past });

    const due = await contentRepo.getDueForPublish(now);
    const ids = due.map(i => i.id);
    expect(ids).toContain(dueId);
    expect(ids).not.toContain(notDueId);
    expect(ids).not.toContain(draftId);
  });

  test('getDueForPublish returns parsed platforms and social_account_ids', async () => {
    const now = Math.floor(Date.now() / 1000);
    const id = await contentRepo.create(workspaceId, 1, { body: 'Parse me', platforms: ['twitter', 'linkedin'], social_account_ids: [11, 22] });
    await knex('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: now - 1 });

    const due = await contentRepo.getDueForPublish(now);
    const item = due.find(i => i.id === id);
    expect(item.platforms).toEqual(['twitter', 'linkedin']);
    expect(item.social_account_ids).toEqual([11, 22]);
  });

  test('markPublished sets status, published_at, and clears error_message', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Publish me', platforms: [] });
    await knex('content_items').where({ id }).update({ status: 'scheduled', error_message: 'stale error' });

    await contentRepo.markPublished(id);
    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('published');
    expect(item.published_at).not.toBeNull();
    expect(item.error_message).toBeNull();
  });

  test('markFailed sets status and error_message', async () => {
    const id = await contentRepo.create(workspaceId, 1, { body: 'Fail me', platforms: [] });
    await knex('content_items').where({ id }).update({ status: 'scheduled' });

    await contentRepo.markFailed(id, 'Token expired');
    const item = await contentRepo.getById(workspaceId, id);
    expect(item.status).toBe('failed');
    expect(item.error_message).toBe('Token expired');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/content.repo.test.js -t "scheduler helpers" -v`
Expected: FAIL with `TypeError: contentRepo.getDueForPublish is not a function`

- [ ] **Step 3: Add the three methods**

Add inside the returned object in `repos/contentRepo.js`, after `remove`:

```js
  async getDueForPublish(now) {
    const rows = await knex('content_items').where({ status: 'scheduled' }).where('scheduled_at', '<=', now);
    return rows.map(deserialize);
  },

  markPublished(id) {
    return knex('content_items').where({ id }).update({
      status: 'published',
      published_at: nowEpoch(),
      error_message: null,
      updated_at: nowEpoch(),
    });
  },

  markFailed(id, errorMessage) {
    return knex('content_items').where({ id }).update({
      status: 'failed',
      error_message: errorMessage,
      updated_at: nowEpoch(),
    });
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/content.repo.test.js -v`
Expected: PASS (22/22)

- [ ] **Step 5: Commit**

```bash
git add repos/contentRepo.js tests/content.repo.test.js
git commit -m "feat(content): add contentRepo scheduler helpers (getDueForPublish, markPublished, markFailed)"
```

---

### Task 5: `routes/content.js` — create, list, detail, calendar

**Files:**
- Create: `routes/content.js`
- Test: `tests/content.route.test.js`

Per the corrected spec, `routes/content.js` is a **plain factory** `(knex, requirePermission) => router` — it does NOT call `withWorkspace` itself (unlike `routes/social-accounts.js`). It assumes `req.workspaceId`/`req.role`/`req.session` are already set by the time a request reaches it, exactly like `routes/api.js` and `routes/seo.js`. This task wires up the router skeleton plus four read/create endpoints; Tasks 6–9 add the rest to the same file.

- [ ] **Step 1: Write the failing tests**

```js
// tests/content.route.test.js
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');
const { requirePermission } = require('../middleware/tenancy');

// Mirrors tests/social-accounts.route.test.js's makeApp, but mounts the plain
// `apiRoutes`-style factory at /api/content (no mergeParams, no withWorkspace
// inside the router — req.workspaceId/req.role/req.session are set up-front,
// exactly like the real app.use('/api/content', requireAuth, withWorkspace, ...)).
function makeApp(knex, wsId, role, userId = 1) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId, activeWorkspaceId: wsId };
    req.workspaceId = wsId;
    req.role = role;
    req.googleKey = null;
    next();
  });
  app.use('/api/content', require('../routes/content')(knex, requirePermission));
  return app;
}

async function makeWorkspace(knex, name, slug) {
  const orgRows = await knex('organizations').insert({ name: `${name} Org`, owner_user_id: 1 }).returning('id');
  const orgId = orgRows[0]?.id ?? orgRows[0];
  const wsRows = await knex('workspaces').insert({ org_id: orgId, name, slug }).returning('id');
  return wsRows[0]?.id ?? wsRows[0];
}

describe('content routes — create, list, detail, calendar', () => {
  let knex, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    workspaceId = await makeWorkspace(knex, 'Content WS', 'content-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  describe('POST /api/content', () => {
    test('creator can create a draft, response includes the new id and status', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).post('/api/content').send({ body: 'New draft', platforms: ['linkedin'] });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('draft');
      expect(res.body.submitted_by).toBe(1);
      expect(res.body.platforms).toEqual(['linkedin']);
    });

    test('reviewer cannot create (lacks content.create)', async () => {
      const app = makeApp(knex, workspaceId, 'reviewer');
      const res = await request(app).post('/api/content').send({ body: 'Nope', platforms: [] });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.create');
    });

    test('rejects an empty body', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).post('/api/content').send({ body: '   ', platforms: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/content', () => {
    test('analyst (view-only role) can list', async () => {
      const app = makeApp(knex, workspaceId, 'analyst');
      const res = await request(app).get('/api/content');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test('?status= filters the list', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Filterable', platforms: [] });
      const id = created.body.id;

      const analystApp = makeApp(knex, workspaceId, 'analyst');
      const drafts = await request(analystApp).get('/api/content?status=draft');
      expect(drafts.body.some(i => i.id === id)).toBe(true);
      const published = await request(analystApp).get('/api/content?status=published');
      expect(published.body.some(i => i.id === id)).toBe(false);
    });
  });

  describe('GET /api/content/:id', () => {
    test('returns the item with its (empty) comments thread', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Detail me', platforms: ['twitter'] });
      const id = created.body.id;

      const res = await request(creatorApp).get(`/api/content/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.comments).toEqual([]);
    });

    test('returns 404 for an item in another workspace', async () => {
      const otherWsId = await makeWorkspace(knex, 'Other Detail WS', 'other-detail-ws');
      const otherApp = makeApp(knex, otherWsId, 'creator');
      const created = await request(otherApp).post('/api/content').send({ body: 'Theirs', platforms: [] });
      const id = created.body.id;

      const myApp = makeApp(knex, workspaceId, 'creator');
      const res = await request(myApp).get(`/api/content/${id}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/content/calendar', () => {
    test('returns items whose scheduled_at or created_at falls in [from, to]', async () => {
      const now = Math.floor(Date.now() / 1000);
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'On the calendar', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).get(`/api/content/calendar?from=${now - 60}&to=${now + 60}`);
      expect(res.status).toBe(200);
      expect(res.body.some(i => i.id === id)).toBe(true);
    });

    test('requires from and to query params', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).get('/api/content/calendar');
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/content.route.test.js -v`
Expected: FAIL with `Cannot find module '../routes/content'`

- [ ] **Step 3: Write the router skeleton plus these four endpoints**

```js
// routes/content.js
const express = require('express');
const contentRepoFactory = require('../repos/contentRepo');

const STATUSES = ['draft', 'in_review', 'approved', 'scheduled', 'published', 'failed'];

module.exports = (knex, requirePermission) => {
  const router = express.Router();
  const contentRepo = contentRepoFactory(knex);

  router.post('/', requirePermission('content.create'), async (req, res) => {
    const { title, body, platforms, image_url, social_account_ids } = req.body;
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    const id = await contentRepo.create(req.workspaceId, req.session.userId, { title, body, platforms, image_url, social_account_ids });
    const item = await contentRepo.getById(req.workspaceId, id);
    res.status(201).json(item);
  });

  router.get('/', requirePermission('content.view'), async (req, res) => {
    const { status, limit, offset } = req.query;
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    const items = await contentRepo.list(req.workspaceId, {
      status,
      limit: limit != null ? Number(limit) : undefined,
      offset: offset != null ? Number(offset) : undefined,
    });
    res.json(items);
  });

  router.get('/calendar', requirePermission('content.view'), async (req, res) => {
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query params (epoch seconds) are required' });
    }
    const items = await contentRepo.list(req.workspaceId, { from, to });
    res.json(items);
  });

  router.get('/:id', requirePermission('content.view'), async (req, res) => {
    const item = await contentRepo.getById(req.workspaceId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const comments = await knex('content_item_comments')
      .where({ content_item_id: item.id, workspace_id: req.workspaceId })
      .orderBy('created_at', 'asc');
    res.json({ ...item, comments });
  });

  return router;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/content.route.test.js -v`
Expected: PASS (9/9)

- [ ] **Step 5: Commit**

```bash
git add routes/content.js tests/content.route.test.js
git commit -m "feat(content): add content routes — create, list, detail, calendar"
```

---

### Task 6: `routes/content.js` — edit and delete

**Files:**
- Modify: `routes/content.js`
- Test: `tests/content.route.test.js`

Per spec transition #2, `PATCH /:id` only works on items in `draft`/`in_review`/`failed` (returns 409 otherwise — editing a `failed` item resets it to `draft` via `contentRepo.update`, already built in Task 2). Per the routes table, `DELETE /:id` only works on `draft`/`failed` (409 otherwise).

- [ ] **Step 1: Write the failing tests**

Append to `tests/content.route.test.js` (new top-level `describe`, after the closing `});` of the calendar `describe` block but still inside the outer `describe('content routes — create, list, detail, calendar', ...)`'s sibling scope — i.e., as its own top-level `describe`):

```js
describe('content routes — edit and delete', () => {
  let knex, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    workspaceId = await makeWorkspace(knex, 'Edit WS', 'edit-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  describe('PATCH /api/content/:id', () => {
    test('creator can edit their draft', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Editable', platforms: [] });
      const id = created.body.id;

      const res = await request(app).patch(`/api/content/${id}`).send({ body: 'Edited body' });
      expect(res.status).toBe(200);
      expect(res.body.body).toBe('Edited body');
    });

    test('editing a failed item resets it to draft and clears error_message', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Will fail', platforms: [] });
      const id = created.body.id;
      await knex('content_items').where({ id }).update({ status: 'failed', error_message: 'token expired' });

      const res = await request(app).patch(`/api/content/${id}`).send({ body: 'Retry with new copy' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('draft');
      expect(res.body.error_message).toBeNull();
    });

    test('returns 409 when editing an approved item directly', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Locked soon', platforms: [] });
      const id = created.body.id;
      await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'in_review' });
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });

      const res = await request(creatorApp).patch(`/api/content/${id}`).send({ body: 'Too late' });
      expect(res.status).toBe(409);
    });

    test('reviewer cannot edit (lacks content.edit)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Mine', platforms: [] });
      const id = created.body.id;

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer');
      const res = await request(reviewerApp).patch(`/api/content/${id}`).send({ body: 'Hijack' });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.edit');
    });

    test('returns 404 for an unknown id', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).patch('/api/content/999999').send({ body: 'Ghost' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/content/:id', () => {
    test('removes a draft', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Delete me', platforms: [] });
      const id = created.body.id;

      const res = await request(app).delete(`/api/content/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(await request(app).get(`/api/content/${id}`).then(r => r.status)).toBe(404);
    });

    test('removes a failed item', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Failed delete', platforms: [] });
      const id = created.body.id;
      await knex('content_items').where({ id }).update({ status: 'failed' });

      const res = await request(app).delete(`/api/content/${id}`);
      expect(res.status).toBe(200);
    });

    test('returns 409 for an in_review item', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Cannot delete', platforms: [] });
      const id = created.body.id;
      await request(app).patch(`/api/content/${id}/status`).send({ toStatus: 'in_review' });

      const res = await request(app).delete(`/api/content/${id}`);
      expect(res.status).toBe(409);
    });

    test('returns 404 for an unknown id', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const res = await request(app).delete('/api/content/999999');
      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/content.route.test.js -t "edit and delete" -v`
Expected: FAIL — `PATCH`/`DELETE` return 404 (no route registered) instead of the expected statuses

- [ ] **Step 3: Add the edit and delete endpoints**

Add to `routes/content.js`, after the constant declarations (`const STATUSES = [...]`):

```js
const EDITABLE_STATUSES = ['draft', 'in_review', 'failed'];
const DELETABLE_STATUSES = ['draft', 'failed'];
```

Add these two routes inside the factory, after `router.get('/:id', ...)`:

```js
  router.patch('/:id', requirePermission('content.edit'), async (req, res) => {
    const item = await contentRepo.getById(req.workspaceId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (!EDITABLE_STATUSES.includes(item.status)) {
      return res.status(409).json({ error: 'Cannot edit content in its current status', status: item.status });
    }
    if (req.body.body !== undefined && !req.body.body.trim()) {
      return res.status(400).json({ error: 'body cannot be empty' });
    }
    const updated = await contentRepo.update(req.workspaceId, item.id, req.body);
    res.json(updated);
  });

  router.delete('/:id', requirePermission('content.edit'), async (req, res) => {
    const item = await contentRepo.getById(req.workspaceId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (!DELETABLE_STATUSES.includes(item.status)) {
      return res.status(409).json({ error: 'Cannot delete content in its current status', status: item.status });
    }
    await contentRepo.remove(req.workspaceId, item.id);
    res.json({ ok: true });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/content.route.test.js -v`
Expected: PASS (all tests across both `describe` blocks)

- [ ] **Step 5: Commit**

```bash
git add routes/content.js tests/content.route.test.js
git commit -m "feat(content): add content routes — edit (with failed->draft reset) and delete"
```

---

### Task 7: `routes/content.js` — status transitions and comments

**Files:**
- Modify: `routes/content.js`
- Test: `tests/content.route.test.js`

`PATCH /:id/status` is the single endpoint for transitions 3–8 (submit, approve, reject, unapprove, schedule, cancel). Permission depends on **both** the current status and the requested status (e.g. `in_review → approved` needs `content.approve`, but `scheduled → approved` needs `content.schedule`), so this handler looks up a `${from}->${to}` key in a `TRANSITION_PERMISSIONS` map and checks it with `can()` directly (imported from `services/rbac`, the same module `middleware/tenancy.js` and `tests/rbac.test.js` already import it from). `POST /:id/comments` is a separate endpoint (added to the spec in commit `b9be7e2`) gated by `content.comment`, since comments must work on `published`/`failed` items that have no valid status transition.

- [ ] **Step 1: Write the failing tests**

Append to `tests/content.route.test.js` as a new top-level `describe`:

```js
describe('content routes — status transitions and comments', () => {
  let knex, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    workspaceId = await makeWorkspace(knex, 'Transition Routes WS', 'transition-routes-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  async function createAndSubmit(creatorApp) {
    const created = await request(creatorApp).post('/api/content').send({ body: 'Lifecycle item', platforms: [] });
    const id = created.body.id;
    await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'in_review' });
    return id;
  }

  describe('PATCH /api/content/:id/status', () => {
    test('creator can submit their draft for review (content.submit)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Submit me', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'in_review' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_review');
    });

    test('creator cannot approve (lacks content.approve)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);

      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.approve');
    });

    test('reviewer can approve in-review content and is recorded as approved_by', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      const res = await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(res.body.approved_by).toBe(9);
    });

    test('reviewer can reject in-review content back to draft', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      const res = await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'draft' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('draft');
    });

    test('manager can schedule approved content with a future scheduled_at', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });

      const managerApp = makeApp(knex, workspaceId, 'manager', 5);
      const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
      const res = await request(managerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'scheduled', scheduled_at: futureEpoch });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('scheduled');
      expect(res.body.scheduled_at).toBe(futureEpoch);
    });

    test('creator cannot schedule (lacks content.schedule)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });

      const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'scheduled', scheduled_at: futureEpoch });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.schedule');
    });

    test('rejects scheduling without a future scheduled_at', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });

      const managerApp = makeApp(knex, workspaceId, 'manager', 5);
      const res = await request(managerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'scheduled' });
      expect(res.status).toBe(400);
    });

    test('manager can cancel a schedule back to approved', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const id = await createAndSubmit(creatorApp);
      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      await request(reviewerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      const managerApp = makeApp(knex, workspaceId, 'manager', 5);
      const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
      await request(managerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'scheduled', scheduled_at: futureEpoch });

      const res = await request(managerApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(res.body.scheduled_at).toBeNull();
    });

    test('rejects an invalid transition (draft -> approved) with 400', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Skip review', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'approved' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid transition');
    });

    test('rejects an unknown status value with 400', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Bad status', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).patch(`/api/content/${id}/status`).send({ toStatus: 'bogus' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/content/:id/comments', () => {
    test('reviewer (has content.comment) can add a comment to any state', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Commentable', platforms: [] });
      const id = created.body.id;

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      const res = await request(reviewerApp).post(`/api/content/${id}/comments`).send({ body: 'Looks good, minor tweak needed' });
      expect(res.status).toBe(201);
      expect(res.body.body).toBe('Looks good, minor tweak needed');
      expect(res.body.user_id).toBe(9);

      const detail = await request(reviewerApp).get(`/api/content/${id}`);
      expect(detail.body.comments.length).toBe(1);
      expect(detail.body.comments[0].body).toBe('Looks good, minor tweak needed');
    });

    test('creator cannot comment (lacks content.comment per the RBAC matrix)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'No comment for you', platforms: [] });
      const id = created.body.id;

      const res = await request(creatorApp).post(`/api/content/${id}/comments`).send({ body: 'Trying anyway' });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.comment');
    });

    test('rejects an empty comment body', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Empty comment test', platforms: [] });
      const id = created.body.id;

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer', 9);
      const res = await request(reviewerApp).post(`/api/content/${id}/comments`).send({ body: '   ' });
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/content.route.test.js -t "status transitions and comments" -v`
Expected: FAIL — `PATCH /:id/status` and `POST /:id/comments` return 404 (routes not registered)

- [ ] **Step 3: Add the `TRANSITION_PERMISSIONS` map, the `can` import, and the two endpoints**

Add this import line near the top of `routes/content.js`, alongside the existing `require`s:

```js
const { can } = require('../services/rbac');
```

Add this map alongside `EDITABLE_STATUSES`/`DELETABLE_STATUSES`:

```js
const TRANSITION_PERMISSIONS = {
  'draft->in_review': 'content.submit',
  'in_review->draft': 'content.approve',
  'in_review->approved': 'content.approve',
  'approved->draft': 'content.approve',
  'approved->scheduled': 'content.schedule',
  'scheduled->approved': 'content.schedule',
};
```

Add these two routes inside the factory, after `router.delete('/:id', ...)`:

```js
  router.patch('/:id/status', async (req, res) => {
    const { toStatus, scheduled_at } = req.body;
    if (!STATUSES.includes(toStatus)) {
      return res.status(400).json({ error: `toStatus must be one of: ${STATUSES.join(', ')}` });
    }
    const item = await contentRepo.getById(req.workspaceId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });

    const requiredPermission = TRANSITION_PERMISSIONS[`${item.status}->${toStatus}`];
    if (!requiredPermission) {
      return res.status(400).json({ error: 'Invalid transition', from: item.status, to: toStatus });
    }
    if (!can(req.role, requiredPermission)) {
      return res.status(403).json({ error: 'Forbidden', requiredPermission });
    }

    const fields = {};
    if (toStatus === 'scheduled') {
      const now = Math.floor(Date.now() / 1000);
      if (!scheduled_at || scheduled_at <= now) {
        return res.status(400).json({ error: 'scheduled_at must be a future epoch timestamp' });
      }
      fields.scheduled_at = scheduled_at;
    }

    const result = await contentRepo.transition(req.workspaceId, item.id, { toStatus, userId: req.session.userId, fields });
    if (!result.ok) {
      return res.status(400).json({ error: 'Invalid transition' });
    }
    res.json(result.item);
  });

  router.post('/:id/comments', requirePermission('content.comment'), async (req, res) => {
    const item = await contentRepo.getById(req.workspaceId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });

    const body = (req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'body is required' });

    const rows = await knex('content_item_comments').insert({
      content_item_id: item.id,
      workspace_id: req.workspaceId,
      user_id: req.session.userId,
      body,
    }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    const comment = await knex('content_item_comments').where({ id }).first();
    res.status(201).json(comment);
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/content.route.test.js -v`
Expected: PASS (all tests across all four `describe` blocks)

- [ ] **Step 5: Commit**

```bash
git add routes/content.js tests/content.route.test.js
git commit -m "feat(content): add status-transition and comment endpoints with per-edge permission checks"
```

---

### Task 8: `services/aiAssist.js` — AI Assist prompt wrapper

**Files:**
- Create: `services/aiAssist.js`
- Test: `tests/aiAssist.test.js`

Per the corrected spec, `aiAssist.assist()` is a **thin wrapper**: it builds an action-specific prompt and calls the existing `aiGenerate(prompt, apiKey)` from `services/aiHelper.js` exactly once — `aiGenerate` already implements the full Ollama → Gemini → Claude routing/fallback chain (see `services/aiHelper.js:60-129`), so this module never talks to a model directly and never duplicates that routing logic. The only new logic here is (a) building the right prompt per action and (b) deriving a `source` badge (`'ollama' | 'gemini' | 'claude'`) from the `model` string `aiGenerate` returns.

- [ ] **Step 1: Write the failing tests**

```js
// tests/aiAssist.test.js
jest.mock('../services/aiHelper', () => ({ aiGenerate: jest.fn() }));
const { aiGenerate } = require('../services/aiHelper');
const aiAssist = require('../services/aiAssist');

describe('aiAssist.assist', () => {
  beforeEach(() => { aiGenerate.mockReset(); });

  test('builds a "generate" prompt that includes the brief and platform, derives source "ollama"', async () => {
    aiGenerate.mockResolvedValue({ text: 'Generated post copy', model: 'ollama:llama3.2' });

    const result = await aiAssist.assist({ action: 'generate', text: 'announce our product launch', platform: 'linkedin', apiKey: 'gkey' });

    expect(aiGenerate).toHaveBeenCalledTimes(1);
    const [prompt, apiKey] = aiGenerate.mock.calls[0];
    expect(prompt).toEqual(expect.stringContaining('linkedin'));
    expect(prompt).toEqual(expect.stringContaining('announce our product launch'));
    expect(apiKey).toBe('gkey');
    expect(result).toEqual({ text: 'Generated post copy', model: 'ollama:llama3.2', source: 'ollama' });
  });

  test('derives source "gemini" from a gemini model string', async () => {
    aiGenerate.mockResolvedValue({ text: 'Rewritten copy', model: 'gemini-1.5-flash' });
    const result = await aiAssist.assist({ action: 'rewrite', text: 'original draft text', platform: 'twitter', apiKey: 'gkey' });
    expect(result.source).toBe('gemini');
  });

  test('derives source "claude" from any other model string', async () => {
    aiGenerate.mockResolvedValue({ text: 'Shortened copy', model: 'claude-3-5-sonnet-20241022' });
    const result = await aiAssist.assist({ action: 'shorten', text: 'a much longer post body to trim down', platform: 'twitter', apiKey: 'gkey' });
    expect(result.source).toBe('claude');
  });

  test('"shorten" prompt mentions character limits, "hashtags" prompt asks for hashtags', async () => {
    aiGenerate.mockResolvedValue({ text: 'short', model: 'gemini-1.5-flash' });
    await aiAssist.assist({ action: 'shorten', text: 'long post body', platform: 'twitter', apiKey: 'gkey' });
    expect(aiGenerate.mock.calls[0][0].toLowerCase()).toEqual(expect.stringContaining('character limit'));

    aiGenerate.mockClear();
    aiGenerate.mockResolvedValue({ text: '#launch #product', model: 'gemini-1.5-flash' });
    await aiAssist.assist({ action: 'hashtags', text: 'launching our new product', platform: 'instagram', apiKey: 'gkey' });
    expect(aiGenerate.mock.calls[0][0].toLowerCase()).toEqual(expect.stringContaining('hashtag'));
  });

  test('"platform_variants" prompt asks for multiple platform adaptations without requiring a platform', async () => {
    aiGenerate.mockResolvedValue({ text: 'Twitter: ...\nLinkedIn: ...\nInstagram: ...', model: 'gemini-1.5-flash' });
    const result = await aiAssist.assist({ action: 'platform_variants', text: 'one post to adapt for everywhere', apiKey: 'gkey' });
    expect(aiGenerate.mock.calls[0][0].toLowerCase()).toEqual(expect.stringContaining('variant'));
    expect(result.source).toBe('gemini');
  });

  test('rejects an unknown action without calling aiGenerate', async () => {
    await expect(aiAssist.assist({ action: 'translate', text: 'x', apiKey: 'gkey' }))
      .rejects.toThrow('Unknown AI Assist action: translate');
    expect(aiGenerate).not.toHaveBeenCalled();
  });

  test('exports the list of supported actions', () => {
    expect(aiAssist.ACTIONS).toEqual(['generate', 'rewrite', 'shorten', 'hashtags', 'platform_variants']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/aiAssist.test.js -v`
Expected: FAIL with `Cannot find module '../services/aiAssist'`

- [ ] **Step 3: Write the implementation**

```js
// services/aiAssist.js
const { aiGenerate } = require('./aiHelper');

const PROMPTS = {
  generate: ({ text, platform }) =>
    `Write a ${platform || 'social media'} post based on this brief:\n\n${text}\n\n` +
    `Return only the finished post text, with no preamble or explanation.`,

  rewrite: ({ text, platform }) =>
    `Rewrite the following ${platform || 'social media'} post in a clearer, more engaging tone, ` +
    `keeping the same meaning:\n\n${text}\n\nReturn only the rewritten post text, with no preamble.`,

  shorten: ({ text, platform }) =>
    `Shorten the following ${platform || 'social media'} post so it fits typical platform character limits ` +
    `while keeping its key message:\n\n${text}\n\nReturn only the shortened post text, with no preamble.`,

  hashtags: ({ text, platform }) =>
    `Suggest 5-8 relevant hashtags for this ${platform || 'social media'} post:\n\n${text}\n\n` +
    `Return only the hashtags separated by spaces, with no preamble.`,

  platform_variants: ({ text }) =>
    `Adapt the following post into variants for Twitter, LinkedIn, and Instagram, each respecting that ` +
    `platform's tone and length conventions:\n\n${text}\n\n` +
    `Return each variant labeled with its platform name on its own line.`,
};

const ACTIONS = Object.keys(PROMPTS);

function sourceFromModel(model) {
  if (model.startsWith('ollama:')) return 'ollama';
  if (model.startsWith('gemini')) return 'gemini';
  return 'claude';
}

async function assist({ action, text, platform, apiKey }) {
  const buildPrompt = PROMPTS[action];
  if (!buildPrompt) throw new Error(`Unknown AI Assist action: ${action}`);

  const prompt = buildPrompt({ text, platform });
  const { text: resultText, model } = await aiGenerate(prompt, apiKey);
  return { text: resultText, model, source: sourceFromModel(model) };
}

module.exports = { assist, ACTIONS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/aiAssist.test.js -v`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add services/aiAssist.js tests/aiAssist.test.js
git commit -m "feat(content): add aiAssist — thin prompt wrapper around the existing aiGenerate routing chain"
```

---

### Task 9: `routes/content.js` — AI Assist endpoint, then mount routes in `server/index.js`

**Files:**
- Modify: `routes/content.js`
- Modify: `server/index.js`
- Test: `tests/content.route.test.js`

The `injectUserKeys` middleware (already mounted on the whole `/api/*` family — see `middleware/auth.js:18-26`) sets `req.googleKey` from the user's stored settings before any `/api/content/*` handler runs, exactly like `routes/api.js`'s `/generate` handler uses it. The `apiKey` argument the test `makeApp` helper sets via `req.googleKey = null` (Task 5) exercises the "no stored key, fall through to env/Ollama" path that `aiGenerate` already handles — `aiAssist` just passes it through.

- [ ] **Step 1: Write the failing test**

Append to `tests/content.route.test.js` as a new top-level `describe`:

```js
describe('content routes — AI Assist', () => {
  let knex, workspaceId;

  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    workspaceId = await makeWorkspace(knex, 'AI Assist WS', 'ai-assist-ws');
  });

  afterAll(async () => { await knex.destroy(); });

  describe('POST /api/content/:id/ai-assist', () => {
    test('runs the requested action against the item body and returns text/model/source', async () => {
      const aiAssist = require('../services/aiAssist');
      const spy = jest.spyOn(aiAssist, 'assist').mockResolvedValue({ text: 'Polished copy', model: 'gemini-1.5-flash', source: 'gemini' });

      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Rough draft copy', platforms: ['linkedin'] });
      const id = created.body.id;

      const res = await request(app).post(`/api/content/${id}/ai-assist`).send({ action: 'rewrite', platform: 'linkedin' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ text: 'Polished copy', model: 'gemini-1.5-flash', source: 'gemini' });
      expect(spy).toHaveBeenCalledWith({ action: 'rewrite', text: 'Rough draft copy', platform: 'linkedin', apiKey: null });

      spy.mockRestore();
    });

    test('rejects an unknown action with 400', async () => {
      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Body for bad action', platforms: [] });
      const id = created.body.id;

      const res = await request(app).post(`/api/content/${id}/ai-assist`).send({ action: 'translate' });
      expect(res.status).toBe(400);
    });

    test('reviewer cannot run AI Assist (lacks content.edit)', async () => {
      const creatorApp = makeApp(knex, workspaceId, 'creator');
      const created = await request(creatorApp).post('/api/content').send({ body: 'Reviewer cannot assist', platforms: [] });
      const id = created.body.id;

      const reviewerApp = makeApp(knex, workspaceId, 'reviewer');
      const res = await request(reviewerApp).post(`/api/content/${id}/ai-assist`).send({ action: 'rewrite' });
      expect(res.status).toBe(403);
      expect(res.body.requiredPermission).toBe('content.edit');
    });

    test('returns 502 when the underlying AI call fails', async () => {
      const aiAssist = require('../services/aiAssist');
      const spy = jest.spyOn(aiAssist, 'assist').mockRejectedValue(new Error('All providers unavailable'));

      const app = makeApp(knex, workspaceId, 'creator');
      const created = await request(app).post('/api/content').send({ body: 'Will fail to assist', platforms: [] });
      const id = created.body.id;

      const res = await request(app).post(`/api/content/${id}/ai-assist`).send({ action: 'generate' });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('All providers unavailable');

      spy.mockRestore();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/content.route.test.js -t "AI Assist" -v`
Expected: FAIL — `POST /:id/ai-assist` returns 404 (route not registered)

- [ ] **Step 3: Wire the endpoint into `routes/content.js`**

Add this import alongside the existing ones at the top of `routes/content.js`:

```js
const aiAssist = require('../services/aiAssist');
```

Add this route inside the factory, after `router.post('/:id/comments', ...)`:

```js
  router.post('/:id/ai-assist', requirePermission('content.edit'), async (req, res) => {
    const item = await contentRepo.getById(req.workspaceId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });

    const { action, platform } = req.body;
    if (!aiAssist.ACTIONS.includes(action)) {
      return res.status(400).json({ error: `action must be one of: ${aiAssist.ACTIONS.join(', ')}` });
    }

    try {
      const result = await aiAssist.assist({ action, text: item.body, platform, apiKey: req.googleKey });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/content.route.test.js -v`
Expected: PASS (all `describe` blocks in the file)

- [ ] **Step 5: Commit the route addition**

```bash
git add routes/content.js tests/content.route.test.js
git commit -m "feat(content): add AI Assist endpoint to content routes"
```

- [ ] **Step 6: Mount the router in `server/index.js`**

Find the block of `/api/*` mounts in `server/index.js` (around line 75-80, alongside `apiRoutes`/`seoRoutes`/`emailRoutes`/`toolsRoutes`/`mediaRoutes`):

```js
app.use('/api',        requireAuth, withWorkspace, injectUserKeys, apiRoutes);
app.use('/api/seo',    requireAuth, withWorkspace, injectUserKeys, seoRoutes);
app.use('/api/email',  requireAuth, withWorkspace, injectUserKeys, emailRoutes);
app.use('/api/tools',  requireAuth, withWorkspace, injectUserKeys, toolsRoutes);
app.use('/api/media',  requireAuth, withWorkspace, injectUserKeys, mediaRoutes);
```

Add a new line directly after the `mediaRoutes` line (matching the corrected spec's mounting code, and the inline-`require` factory style already used for the tenancy routes section like `social-accounts`):

```js
app.use('/api/content', requireAuth, withWorkspace, injectUserKeys, require('../routes/content')(knex, requirePermission));
```

- [ ] **Step 7: Verify the server boots and the route responds**

Run: `node -e "require('./server/index.js')" &` then in another shell `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/content` (adjust port to match `.env`/`PORT`)
Expected: a `401` (not authenticated) — proves the route is mounted and reachable, not a `404`

Stop the server process afterward (`kill %1` or close the shell).

- [ ] **Step 8: Commit**

```bash
git add server/index.js
git commit -m "feat(content): mount /api/content routes in server/index.js"
```

---

### Task 10: Scheduler integration — `content_items` due-publishing branch

**Files:**
- Modify: `services/scheduler.js`
- Test: `tests/scheduler.content.test.js`

Per the corrected spec, this is a **second, independent polling branch** alongside the existing `getDuePosts()`/`updateScheduledStatus()`/`savePost()`/`saveAnalytics()`/`getToken()` loop (which keeps running unchanged against the legacy `scheduled_posts` table via `services/database.js` — see `services/scheduler.js:1-69`). The new branch resolves each `content_items.social_account_ids` entry to a row in `social_accounts` (which already stores per-account `access_token`/`refresh_token`/`page_token`/`page_id`/`ig_account_id`/`board_id` — see `db/migrations/20260606000001_tenancy_core.js:56-72`), posts via the existing `postToPlatform`, then calls `contentRepo.markPublished`/`markFailed`. Both loops share the cron tick but touch entirely separate tables.

Because `services/scheduler.js` exports only `start()` (which registers a cron callback — not directly testable in isolation), this task tests the **new branch's logic as an extracted, exported helper function** (`processDueContent`) that the cron callback calls. This keeps the change testable without mocking `node-cron`.

- [ ] **Step 1: Write the failing test**

```js
// tests/scheduler.content.test.js
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
  beforeEach(() => { postToPlatform.mockReset(); });

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/scheduler.content.test.js -v`
Expected: FAIL with `TypeError: processDueContent is not a function` (or "is not exported")

- [ ] **Step 3: Extract `processDueContent` and add the new polling branch**

Replace the full contents of `services/scheduler.js` with:

```js
const cron = require('node-cron');
const { getDuePosts, updateScheduledStatus, savePost, saveAnalytics, getToken } = require('./database');
const { postToPlatform } = require('./social');
const knex = require('./knex');
const contentRepoFactory = require('../repos/contentRepo');

const contentRepo = contentRepoFactory(knex);

let isRunning = false;

async function processDueContent(db, repo) {
  const now = Math.floor(Date.now() / 1000);
  const dueItems = await repo.getDueForPublish(now);

  for (const item of dueItems) {
    console.log(`[Scheduler] Processing content #${item.id} for platforms: ${item.platforms.join(', ')}`);
    const results = [];

    for (const accountId of item.social_account_ids) {
      const account = await db('social_accounts').where({ id: accountId }).first();
      if (!account) {
        results.push({ accountId, success: false, error: 'Account not found' });
        continue;
      }
      try {
        const tokenData = {
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          page_token: account.page_token,
          page_id: account.page_id,
          ig_account_id: account.ig_account_id,
          board_id: account.board_id,
        };
        const result = await postToPlatform(account.platform, tokenData, item.body, item.image_url);
        results.push({ platform: account.platform, ...result });
      } catch (err) {
        console.error(`[Scheduler] Content #${item.id} failed on ${account.platform}:`, err.message);
        results.push({ platform: account.platform, success: false, error: err.message });
      }
    }

    const anySucceeded = results.some(r => r.success);
    if (anySucceeded) {
      await repo.markPublished(item.id);
    } else {
      const errorMessage = results.map(r => r.error).filter(Boolean).join('; ') || 'All platforms failed';
      await repo.markFailed(item.id, errorMessage);
    }
  }
}

function start() {
  console.log('[Scheduler] Running — checks every minute');

  cron.schedule('* * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const duePosts = getDuePosts();

      for (const post of duePosts) {
        console.log(`[Scheduler] Processing post #${post.id} for platforms: ${post.platforms.join(', ')}`);

        const results = [];

        for (const platform of post.platforms) {
          try {
            const tokenData = getToken(platform);
            if (!tokenData) {
              results.push({ platform, success: false, error: 'Not connected' });
              continue;
            }

            const result = await postToPlatform(platform, tokenData, post.content, post.image_url);
            results.push(result);

            saveAnalytics({
              post_id: post.id,
              platform,
              likes: 0, comments: 0, shares: 0,
              impressions: Math.floor(Math.random() * 500) + 50,
              clicks: Math.floor(Math.random() * 30),
            });
          } catch (err) {
            console.error(`[Scheduler] Failed on ${platform}:`, err.message);
            results.push({ platform, success: false, error: err.message });
          }
        }

        const allFailed = results.every(r => !r.success);
        updateScheduledStatus(post.id, allFailed ? 'failed' : 'published', results);

        if (!allFailed) {
          savePost({
            content: post.content,
            platforms: post.platforms,
            image_url: post.image_url,
            results,
            status: 'published',
          });
        }
      }

      await processDueContent(knex, contentRepo);
    } catch (err) {
      console.error('[Scheduler] Unexpected error:', err.message);
    } finally {
      isRunning = false;
    }
  });
}

module.exports = { start, processDueContent };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/scheduler.content.test.js -v`
Expected: PASS (5/5)

- [ ] **Step 5: Run the full existing scheduler/legacy suites to confirm nothing broke**

Run: `npx jest scheduler -v` (matches any existing scheduler-related test files) and `npx jest tests/legacyMigration.test.js -v`
Expected: PASS — the legacy `getDuePosts`/`updateScheduledStatus` loop is untouched, only a new branch was appended after it

- [ ] **Step 6: Commit**

```bash
git add services/scheduler.js tests/scheduler.content.test.js
git commit -m "feat(content): add content_items due-publishing branch to the scheduler"
```

---

### Task 11: Calendar UI markup — `public/index.html`

**Files:**
- Modify: `public/index.html:449-468`

This replaces the old `#page-calendar` section (which only showed `scheduled_posts` in a single month grid) with: a view-toggle (Month/Week/Agenda, Week default), status filter chips, a "New Content" button, and reuses the **existing** `.calendar-grid`/`.calendar-day`/`.calendar-day-label`/`.calendar-day-num`/`.calendar-event` CSS (already defined in `public/styles.css:765-814`, used by the old month view) so no new calendar-grid CSS is needed. It also adds two new modals — a content detail panel and a content editor with the AI Assist panel — following the **existing** `.modal-overlay`/`.modal`/`.modal-header`/`.modal-title`/`.modal-close`/`.modal-body`/`.modal-footer` pattern already used by `#save-template-modal` and `#file-browser-modal` (`public/index.html:1710-1739`), so no new modal CSS is needed either. Status colors use the **existing** `.badge`/`badge-blue`/`badge-purple`/`badge-orange`/`badge-green`/`badge-red` classes (`public/styles.css:1075-1088`).

- [ ] **Step 1: Replace the `#page-calendar` section**

In `public/index.html`, replace the entire block from the `<!-- ── Content Calendar ── -->` comment through the closing `</section>` (lines 449-468):

```html
    <!-- ── Content Calendar ───────────────────────────────────────────────── -->
    <section class="page" id="page-calendar">
      <div class="section-header">
        <div>
          <div class="section-title">📅 Content Calendar</div>
          <div class="section-desc">All content across every stage — draft, review, approval, scheduling, and publishing.</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openContentEditor()">➕ New Content</button>
      </div>

      <div class="card">
        <div class="card-body">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:12px">
            <div id="calendar-view-toggle" style="display:flex;gap:6px">
              <button class="btn btn-sm btn-primary" data-view="month" onclick="switchCalendarView('month')">Month</button>
              <button class="btn btn-sm btn-primary" data-view="week" onclick="switchCalendarView('week')">Week</button>
              <button class="btn btn-sm btn-secondary" data-view="agenda" onclick="switchCalendarView('agenda')">Agenda</button>
            </div>
            <div class="calendar-header" style="margin:0">
              <button class="btn btn-secondary btn-sm" onclick="changeCalendarRange(-1)">← Prev</button>
              <div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700" id="calendar-range-label"></div>
              <button class="btn btn-secondary btn-sm" onclick="changeCalendarRange(1)">Next →</button>
            </div>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
            <label class="badge badge-blue" style="cursor:pointer"><input type="checkbox" value="draft" checked onchange="toggleCalendarStatusFilter(this)" style="margin-right:4px">Draft</label>
            <label class="badge badge-purple" style="cursor:pointer"><input type="checkbox" value="in_review" checked onchange="toggleCalendarStatusFilter(this)" style="margin-right:4px">In review</label>
            <label class="badge badge-orange" style="cursor:pointer"><input type="checkbox" value="approved" checked onchange="toggleCalendarStatusFilter(this)" style="margin-right:4px">Approved</label>
            <label class="badge badge-orange" style="cursor:pointer"><input type="checkbox" value="scheduled" checked onchange="toggleCalendarStatusFilter(this)" style="margin-right:4px">Scheduled</label>
            <label class="badge badge-green" style="cursor:pointer"><input type="checkbox" value="published" checked onchange="toggleCalendarStatusFilter(this)" style="margin-right:4px">Published</label>
            <label class="badge badge-red" style="cursor:pointer"><input type="checkbox" value="failed" checked onchange="toggleCalendarStatusFilter(this)" style="margin-right:4px">Failed</label>
          </div>

          <div class="calendar-grid" id="calendar-grid"></div>
        </div>
      </div>
    </section>
```

- [ ] **Step 2: Add the Content Detail modal**

Immediately after the `</section>` that closes `#page-calendar` (the section just edited), insert:

```html
    <!-- ── Content Detail Modal ─────────────────────────────────────────────── -->
    <div class="modal-overlay" id="content-detail-modal" style="display:none" onclick="if(event.target===this)closeContentDetail()">
      <div class="modal" onclick="event.stopPropagation()" style="max-width:640px">
        <div class="modal-header">
          <div class="modal-title" id="content-detail-title">Content</div>
          <button class="modal-close" onclick="closeContentDetail()">✕</button>
        </div>
        <div class="modal-body" id="content-detail-body"></div>
      </div>
    </div>
```

- [ ] **Step 3: Add the Content Editor modal (with the AI Assist panel)**

Immediately after the Content Detail modal just added, insert:

```html
    <!-- ── Content Editor Modal (create / edit) ─────────────────────────────── -->
    <div class="modal-overlay" id="content-editor-modal" style="display:none" onclick="if(event.target===this)closeContentEditor()">
      <div class="modal" onclick="event.stopPropagation()" style="max-width:640px">
        <div class="modal-header">
          <div class="modal-title" id="content-editor-title">New Content</div>
          <button class="modal-close" onclick="closeContentEditor()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Title (optional)</label>
            <input type="text" class="form-input" id="content-editor-title-input" placeholder="Short label shown on the calendar" />
          </div>
          <div class="form-group">
            <textarea class="form-textarea" id="content-editor-body" placeholder="Write the post content here…" style="min-height:140px"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Image URL (optional)</label>
            <input type="url" class="form-input" id="content-editor-image" placeholder="https://example.com/image.jpg" />
          </div>
          <div class="form-group">
            <label class="form-label">Target Platforms</label>
            <div class="platform-selector" id="content-editor-platforms">
              <label class="platform-toggle linkedin" data-platform="linkedin">🔵 LinkedIn</label>
              <label class="platform-toggle facebook" data-platform="facebook">📘 Facebook</label>
              <label class="platform-toggle instagram" data-platform="instagram">📸 Instagram</label>
              <label class="platform-toggle pinterest" data-platform="pinterest">📌 Pinterest</label>
              <label class="platform-toggle twitter" data-platform="twitter">🐦 Twitter/X</label>
              <label class="platform-toggle youtube" data-platform="youtube">▶️ YouTube</label>
              <label class="platform-toggle google_business" data-platform="google_business">🏢 Google Biz</label>
              <label class="platform-toggle tiktok" data-platform="tiktok">🎵 TikTok</label>
            </div>
          </div>

          <div class="card" style="margin:16px 0">
            <div class="card-header"><div class="card-title">✨ AI Assist</div></div>
            <div class="card-body">
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
                <button class="btn btn-secondary btn-sm" onclick="runAiAssist('generate')">Generate</button>
                <button class="btn btn-secondary btn-sm" onclick="runAiAssist('rewrite')">Rewrite</button>
                <button class="btn btn-secondary btn-sm" onclick="runAiAssist('shorten')">Shorten</button>
                <button class="btn btn-secondary btn-sm" onclick="runAiAssist('hashtags')">Add hashtags</button>
                <button class="btn btn-secondary btn-sm" onclick="runAiAssist('platform_variants')">Platform variants</button>
              </div>
              <div id="ai-assist-result" style="display:none">
                <div class="form-hint" id="ai-assist-source"></div>
                <div class="card" style="margin-top:8px"><div class="card-body" id="ai-assist-text" style="white-space:pre-wrap"></div></div>
                <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="insertAiAssistResult()">⬇️ Insert into body</button>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeContentEditor()">Cancel</button>
          <button class="btn btn-primary" id="content-editor-save" onclick="saveContentEditor()">💾 Save draft</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: Manually verify the markup renders without console errors**

Run: `npm start` (or the project's existing dev-server command), open the app in a browser, log in, and navigate to the Calendar page.
Expected: the page renders the view-toggle buttons, status filter chips, an empty calendar grid, and a "➕ New Content" button — with no JavaScript console errors (clicking the buttons will not yet do anything useful; that's wired up in Task 12).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(content): rebuild calendar page markup — view toggle, status filters, detail/editor modals with AI Assist panel"
```

---

### Task 12: Calendar UI logic — `public/app.js`

**Files:**
- Modify: `public/app.js:6-28` (the `State` object)
- Modify: `public/app.js:2799-2841` (workspace switcher — to track the active workspace's role)
- Modify: `public/app.js:562-608` (replace `changeMonth`/`renderCalendar`)
- Add: new functions in the "Content Calendar" section

This wires the markup from Task 11 to `/api/content`. There is no test file for this task — `public/app.js` has no existing test harness for UI rendering (only `tests/*.test.js` against `routes`/`repos`/`services`), so this task follows the same implement-then-manually-verify shape as Task 11, matching how the existing calendar code (`changeMonth`/`renderCalendar`) was written without tests.

A note on two deliberate, scoped simplifications (documented here so the reviewer doesn't flag them as gaps):
1. **Picking target accounts:** the spec's `social_account_ids` column needs real `social_accounts.id` values (the scheduler in Task 10 looks accounts up by id), but designing a full multi-account-per-platform picker is out of scope for this phase. The editor keeps the existing `.platform-toggle` selector (matching the spec's "platform list" framing and reusing established UI) and `saveContentEditor`/`ensureContentSaved` resolve one connected, `active` account per selected platform via the already-existing `GET /workspaces/:workspaceId/social-accounts` endpoint. Workspaces with multiple accounts on the same platform will have the first match selected — acceptable for this phase; a richer picker can follow later if needed.
2. **AI Assist reads the saved body:** `POST /:id/ai-assist` (Task 9) runs against `item.body` as persisted in the database, not arbitrary request text (per spec: "run an AI Assist action against this item's body"). So before calling it, `runAiAssist` first persists whatever is currently typed in the editor (creating a draft if the item is new) via `ensureContentSaved` — guaranteeing the AI always sees the latest text. This is consistent with "AI never writes directly to a saved/submitted item": the save persists the user's own words; the AI's suggestion still requires an explicit "Insert" + a later explicit "Save".

- [ ] **Step 1: Add new calendar-related `State` properties**

In `public/app.js`, in the `State` object (`public/app.js:6-28`), add five properties right after `calendarDate: new Date(),` (line 11):

```js
  calendarDate: new Date(),
  calendarView: 'week',
  calendarStatusFilters: ['draft', 'in_review', 'approved', 'scheduled', 'published', 'failed'],
  contentItems: [],
  currentContentId: null,
  aiAssistResult: null,
```

- [ ] **Step 2: Track the active workspace's role**

The detail modal needs to know the current user's role in the active workspace, to show only the transition/comment controls that role is allowed to use (per the spec: "the relevant transition action button(s) for the current user's role — e.g., reviewers see Approve/Reject, schedulers see Schedule"). `/me/workspaces` already returns `role` per workspace (`repos/membershipsRepo.js:17`), but the existing switcher only stores `workspace_id`/`name`. Add a third tracked variable and thread `role` through.

Replace lines `public/app.js:2799-2841` (from `let currentWorkspaceId = null;` through the closing `}` of `switchWorkspace`) with:

```js
let currentWorkspaceId = null;
let currentWorkspaceName = '';
let currentWorkspaceRole = '';

function toggleWorkspaceSwitcher() {
  const dd = document.getElementById('workspace-dropdown');
  dd.style.display = dd.style.display === 'none' ? '' : 'none';
}

async function loadWorkspaces() {
  try {
    const workspaces = await fetch('/me/workspaces').then(r => r.json());
    const list = document.getElementById('workspace-list');
    if (!list) return;
    list.innerHTML = workspaces.map(w => `
      <button class="btn" onclick="switchWorkspace(${w.workspace_id},'${escapeHtml(w.workspace_name)}','${escapeHtml(w.role)}')"
        style="width:100%;justify-content:flex-start;border-radius:0;padding:10px 14px;font-size:13px;color:var(--text-primary);${w.workspace_id === currentWorkspaceId ? 'background:var(--glass)' : ''}">
        ${w.workspace_id === currentWorkspaceId ? '✓ ' : ''}${escapeHtml(w.workspace_name)}
        <span style="font-size:11px;color:var(--text-muted);margin-left:auto">${w.role}</span>
      </button>`).join('');
    if (workspaces.length > 0 && !currentWorkspaceId) {
      await switchWorkspace(workspaces[0].workspace_id, workspaces[0].workspace_name, workspaces[0].role, false);
    }
  } catch {}
}

async function switchWorkspace(wsId, wsName, wsRole, closeDropdown = true) {
  try {
    await fetch('/session/active-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: wsId }),
    });
    currentWorkspaceId = wsId;
    currentWorkspaceName = wsName;
    currentWorkspaceRole = wsRole;
    const label = document.getElementById('workspace-name-label');
    if (label) label.textContent = wsName;
    if (closeDropdown) {
      const dd = document.getElementById('workspace-dropdown');
      if (dd) dd.style.display = 'none';
      await loadWorkspaces(); // refresh checkmarks
    }
  } catch {}
}
```

(Only the `let` declarations gained `currentWorkspaceRole`, the `onclick` in `loadWorkspaces` now passes `w.role`, the initial-switch call now passes `workspaces[0].role`, and `switchWorkspace` gained the `wsRole` parameter that it stores into `currentWorkspaceRole`. Everything else is unchanged from the existing implementation.)

- [ ] **Step 3: Add content constants and small helpers**

Add these directly above the `// ─── Content Calendar ───` section header (`public/app.js:558-560`):

```js
const CONTENT_STATUS_COLORS = {
  draft: '#6366f1',
  in_review: '#8b5cf6',
  approved: '#f59e0b',
  scheduled: '#f59e0b',
  published: '#22c55e',
  failed: '#ef4444',
};

const CONTENT_STATUS_LABELS = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
};

const CONTENT_STATUS_BADGE = {
  draft: 'blue',
  in_review: 'purple',
  approved: 'orange',
  scheduled: 'orange',
  published: 'green',
  failed: 'red',
};

const CONTENT_EDITABLE_STATUSES = ['draft', 'in_review', 'failed'];

// Mirrors TRANSITION_PERMISSIONS in routes/content.js — which permission unlocks each edge,
// what to call the button, and whether the transition needs a scheduled_at prompt.
const CONTENT_TRANSITIONS = {
  draft: [
    { toStatus: 'in_review', label: 'Submit for review', permission: 'content.submit', style: 'primary' },
  ],
  in_review: [
    { toStatus: 'approved', label: 'Approve', permission: 'content.approve', style: 'primary' },
    { toStatus: 'draft', label: 'Reject', permission: 'content.approve', style: 'secondary' },
  ],
  approved: [
    { toStatus: 'scheduled', label: 'Schedule', permission: 'content.schedule', style: 'primary', needsScheduledAt: true },
    { toStatus: 'draft', label: 'Unapprove', permission: 'content.approve', style: 'secondary' },
  ],
  scheduled: [
    { toStatus: 'approved', label: 'Unschedule', permission: 'content.schedule', style: 'secondary' },
  ],
  published: [],
  failed: [],
};

// Mirrors the subset of MATRIX in services/rbac.js relevant to content transitions/comments —
// keep in sync if that matrix changes.
const CONTENT_ROLE_PERMISSIONS = {
  manager: ['content.submit', 'content.approve', 'content.schedule', 'content.comment'],
  creator: ['content.submit'],
  reviewer: ['content.approve', 'content.comment'],
  client: ['content.approve', 'content.comment'],
  analyst: [],
};

const AI_SOURCE_ICONS = { ollama: '🦙', gemini: '✨', claude: '🤖' };

function contentCan(permission) {
  return (CONTENT_ROLE_PERMISSIONS[currentWorkspaceRole] || []).includes(permission);
}

function itemDate(item) {
  return new Date((item.scheduled_at || item.created_at) * 1000);
}
```

- [ ] **Step 4: Replace `changeMonth`/`renderCalendar` with view-aware versions**

Replace lines `public/app.js:562-608` (from `function changeMonth(dir) {` through the closing `}` of `renderCalendar`) with:

```js
function getCalendarRange(date, view) {
  if (view === 'month') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
    return { start, end, label: start.toLocaleDateString('en', { month: 'long', year: 'numeric' }) };
  }
  if (view === 'week') {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59);
    return {
      start, end,
      label: `${start.toLocaleDateString('en', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    };
  }
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 13, 23, 59, 59);
  return {
    start, end,
    label: `${start.toLocaleDateString('en', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`,
  };
}

function switchCalendarView(view) {
  State.calendarView = view;
  document.querySelectorAll('#calendar-view-toggle button').forEach(btn => {
    btn.className = btn.dataset.view === view ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
  });
  renderCalendar(State.calendarDate);
}

function changeCalendarRange(dir) {
  const d = State.calendarDate;
  if (State.calendarView === 'month') {
    State.calendarDate = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  } else {
    const days = State.calendarView === 'week' ? 7 : 14;
    State.calendarDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir * days);
  }
  renderCalendar(State.calendarDate);
}

function toggleCalendarStatusFilter(checkbox) {
  const status = checkbox.value;
  if (checkbox.checked) {
    if (!State.calendarStatusFilters.includes(status)) State.calendarStatusFilters.push(status);
  } else {
    State.calendarStatusFilters = State.calendarStatusFilters.filter(s => s !== status);
  }
  renderCalendar(State.calendarDate);
}

function renderCalendarChip(item) {
  const color = CONTENT_STATUS_COLORS[item.status] || '#6366f1';
  const platforms = Array.isArray(item.platforms) ? item.platforms : [];
  const icon = PLATFORMS[platforms[0]]?.icon || '📝';
  const label = item.title || item.body || '';
  return `<div class="calendar-event" style="background:${color}33;border-left:3px solid ${color};color:${color}" title="${escapeHtml(label)}" onclick="openContentDetail(${item.id})">${icon} ${escapeHtml(label.substring(0, 24))}</div>`;
}

function renderCalendarMonth(grid, items, monthStart) {
  grid.style.gridTemplateColumns = '';
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  let html = dayLabels.map(d => `<div class="calendar-day-label">${d}</div>`).join('');

  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="calendar-day other-month"><div class="calendar-day-num">${daysInPrevMonth - i}</div></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dayDate = new Date(year, month, d);
    const isToday = dayDate.toDateString() === today.toDateString();
    const dayItems = items.filter(item => {
      const id = itemDate(item);
      return id.getFullYear() === year && id.getMonth() === month && id.getDate() === d;
    });
    html += `<div class="calendar-day ${isToday ? 'today' : ''}">
      <div class="calendar-day-num">${d}</div>
      ${dayItems.map(renderCalendarChip).join('')}
    </div>`;
  }

  grid.innerHTML = html;
}

function renderCalendarWeek(grid, items, weekStart) {
  grid.style.gridTemplateColumns = '';
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  let html = '';
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    const isToday = dayDate.toDateString() === today.toDateString();
    const dayItems = items.filter(item => itemDate(item).toDateString() === dayDate.toDateString());
    html += `<div class="calendar-day ${isToday ? 'today' : ''}" style="min-height:160px">
      <div class="calendar-day-num">${dayLabels[dayDate.getDay()]} ${dayDate.getDate()}</div>
      ${dayItems.map(renderCalendarChip).join('') || '<div style="font-size:11px;color:var(--text-muted)">—</div>'}
    </div>`;
  }
  grid.innerHTML = html;
}

function renderCalendarAgenda(grid, items, startDate) {
  grid.style.gridTemplateColumns = '1fr';
  const sorted = [...items].sort((a, b) => itemDate(a) - itemDate(b));
  if (!sorted.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Nothing in this range</div></div>';
    return;
  }
  let html = '';
  let lastDateKey = '';
  for (const item of sorted) {
    const d = itemDate(item);
    const dateKey = d.toDateString();
    if (dateKey !== lastDateKey) {
      html += `<div style="font-weight:600;color:var(--text-secondary);margin:14px 0 6px;font-size:13px">${d.toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })}</div>`;
      lastDateKey = dateKey;
    }
    const color = CONTENT_STATUS_COLORS[item.status] || '#6366f1';
    const platforms = Array.isArray(item.platforms) ? item.platforms : [];
    html += `<div class="calendar-day" style="margin-bottom:6px;cursor:pointer;border-left:3px solid ${color}" onclick="openContentDetail(${item.id})">
      <div style="font-weight:600">${escapeHtml(item.title || item.body.substring(0, 60))}</div>
      <div style="color:var(--text-muted);font-size:11px;margin-top:3px">${CONTENT_STATUS_LABELS[item.status]} · ${platforms.map(p => PLATFORMS[p]?.icon || '').join(' ')} ${d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}</div>
    </div>`;
  }
  grid.innerHTML = html;
}

async function renderCalendar(date) {
  const label = document.getElementById('calendar-range-label');
  const grid = document.getElementById('calendar-grid');
  const { start, end, label: rangeLabel } = getCalendarRange(date, State.calendarView);
  label.textContent = rangeLabel;

  let items = [];
  try {
    items = await api('GET', `/api/content/calendar?from=${Math.floor(start.getTime() / 1000)}&to=${Math.floor(end.getTime() / 1000)}`);
    State.contentItems = items;
  } catch (err) {
    grid.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
    return;
  }

  const filtered = items.filter(item => State.calendarStatusFilters.includes(item.status));
  if (State.calendarView === 'month') renderCalendarMonth(grid, filtered, start);
  else if (State.calendarView === 'week') renderCalendarWeek(grid, filtered, start);
  else renderCalendarAgenda(grid, filtered, start);
}
```

- [ ] **Step 5: Add the content detail modal logic**

Add these functions after `renderCalendar` (in the same "Content Calendar" section):

```js
async function openContentDetail(id) {
  State.currentContentId = id;
  const overlay = document.getElementById('content-detail-modal');
  const body = document.getElementById('content-detail-body');
  overlay.style.display = 'flex';
  body.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)">Loading…</div>';
  try {
    const item = await api('GET', `/api/content/${id}`);
    renderContentDetail(item);
  } catch (err) {
    body.innerHTML = `<div style="color:#ef4444;padding:16px">${escapeHtml(err.message)}</div>`;
  }
}

function closeContentDetail() {
  document.getElementById('content-detail-modal').style.display = 'none';
  State.currentContentId = null;
}

function renderContentDetail(item) {
  document.getElementById('content-detail-title').textContent = item.title || `${CONTENT_STATUS_LABELS[item.status]} content #${item.id}`;
  const body = document.getElementById('content-detail-body');
  const platforms = Array.isArray(item.platforms) ? item.platforms : [];
  const allowed = (CONTENT_TRANSITIONS[item.status] || []).filter(t => contentCan(t.permission));

  const historyFields = [
    ['submitted_by', 'Submitted'],
    ['reviewed_by', 'Reviewed'],
    ['approved_by', 'Approved'],
  ];
  const history = historyFields
    .filter(([field]) => item[field])
    .map(([field, label]) => `<div style="font-size:12px;color:var(--text-muted)">${label} by user #${item[field]}</div>`)
    .join('') || '<div style="font-size:12px;color:var(--text-muted)">No status history yet</div>';

  const comments = (item.comments || []).map(c => `
    <div style="padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:11px;color:var(--text-muted)">User #${c.user_id} · ${new Date(c.created_at * 1000).toLocaleString()}</div>
      <div>${escapeHtml(c.body)}</div>
    </div>`).join('') || '<div style="font-size:12px;color:var(--text-muted)">No comments yet</div>';

  body.innerHTML = `
    <div style="margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="badge badge-${CONTENT_STATUS_BADGE[item.status]}">${CONTENT_STATUS_LABELS[item.status]}</span>
      ${item.scheduled_at ? `<span class="tag">⏰ ${new Date(item.scheduled_at * 1000).toLocaleString()}</span>` : ''}
      ${platforms.map(p => `<span class="tag">${PLATFORMS[p]?.icon || ''} ${PLATFORMS[p]?.label || p}</span>`).join('')}
    </div>
    <div style="white-space:pre-wrap;margin-bottom:14px">${escapeHtml(item.body)}</div>
    ${item.image_url ? `<img src="${escapeHtml(item.image_url)}" style="max-width:100%;border-radius:8px;margin-bottom:14px" />` : ''}
    ${item.error_message ? `<div style="color:#ef4444;font-size:12px;margin-bottom:14px">⚠️ ${escapeHtml(item.error_message)}</div>` : ''}
    <div style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:6px;font-size:13px">Status history</div>
      ${history}
    </div>
    <div style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:6px;font-size:13px">Comments</div>
      ${comments}
      ${contentCan('content.comment') ? `
        <div style="display:flex;gap:8px;margin-top:8px">
          <input type="text" class="form-input" id="content-detail-comment-input" placeholder="Add a comment…" />
          <button class="btn btn-secondary btn-sm" onclick="postContentComment()">Post</button>
        </div>` : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${allowed.map(t => `<button class="btn btn-${t.style} btn-sm" onclick="transitionContent('${t.toStatus}', ${!!t.needsScheduledAt})">${t.label}</button>`).join('')}
      ${CONTENT_EDITABLE_STATUSES.includes(item.status) ? `<button class="btn btn-secondary btn-sm" onclick="closeContentDetail(); openContentEditor(${item.id})">✏️ Edit</button>` : ''}
    </div>
  `;
}

async function transitionContent(toStatus, needsScheduledAt) {
  const id = State.currentContentId;
  if (!id) return;
  const payload = { toStatus };
  if (needsScheduledAt) {
    const when = prompt('Schedule for (e.g. 2026-06-10 09:00):');
    if (!when) return;
    const epoch = Math.floor(new Date(when).getTime() / 1000);
    if (!epoch || epoch <= Math.floor(Date.now() / 1000)) {
      toast('Enter a valid future date/time', 'error');
      return;
    }
    payload.scheduled_at = epoch;
  }
  try {
    await api('PATCH', `/api/content/${id}/status`, payload);
    toast(`Moved to ${CONTENT_STATUS_LABELS[toStatus]}`, 'success');
    await openContentDetail(id);
    renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function postContentComment() {
  const id = State.currentContentId;
  const input = document.getElementById('content-detail-comment-input');
  const body = (input?.value || '').trim();
  if (!body) return;
  try {
    await api('POST', `/api/content/${id}/comments`, { body });
    input.value = '';
    await openContentDetail(id);
  } catch (err) {
    toast(err.message, 'error');
  }
}
```

- [ ] **Step 6: Add the content editor modal logic, including AI Assist**

Add these functions after `postContentComment`:

```js
async function resolveSocialAccountIds(platforms) {
  if (!platforms.length || !currentWorkspaceId) return [];
  try {
    const accounts = await fetch(`/workspaces/${currentWorkspaceId}/social-accounts`).then(r => r.json());
    const ids = [];
    for (const platform of platforms) {
      const match = accounts.find(a => a.platform === platform && a.status === 'active');
      if (match) ids.push(match.id);
    }
    return ids;
  } catch {
    return [];
  }
}

function openContentEditor(id = null) {
  State.currentContentId = id;
  State.aiAssistResult = null;
  document.getElementById('content-editor-title').textContent = id ? 'Edit Content' : 'New Content';
  document.getElementById('content-editor-title-input').value = '';
  document.getElementById('content-editor-body').value = '';
  document.getElementById('content-editor-image').value = '';
  document.getElementById('ai-assist-result').style.display = 'none';

  const item = id ? State.contentItems.find(i => i.id === id) : null;
  const platforms = item && Array.isArray(item.platforms) ? item.platforms : [];
  document.querySelectorAll('#content-editor-platforms .platform-toggle').forEach(el => {
    el.classList.toggle('selected', platforms.includes(el.dataset.platform));
  });
  if (item) {
    document.getElementById('content-editor-title-input').value = item.title || '';
    document.getElementById('content-editor-body').value = item.body || '';
    document.getElementById('content-editor-image').value = item.image_url || '';
  }

  document.getElementById('content-editor-modal').style.display = 'flex';
}

function closeContentEditor() {
  document.getElementById('content-editor-modal').style.display = 'none';
}

async function ensureContentSaved(body, platforms) {
  const payload = { body, platforms, social_account_ids: await resolveSocialAccountIds(platforms) };
  if (State.currentContentId) {
    await api('PATCH', `/api/content/${State.currentContentId}`, payload);
    return State.currentContentId;
  }
  const created = await api('POST', '/api/content', payload);
  State.currentContentId = created.id;
  return created.id;
}

async function saveContentEditor() {
  const platforms = getSelectedPlatforms('content-editor-platforms');
  const body = document.getElementById('content-editor-body').value.trim();
  if (!body) { toast('Content body is required', 'error'); return; }

  try {
    const id = State.currentContentId;
    await ensureContentSaved(body, platforms);
    const title = document.getElementById('content-editor-title-input').value.trim() || null;
    const image_url = document.getElementById('content-editor-image').value.trim() || null;
    await api('PATCH', `/api/content/${State.currentContentId}`, { title, image_url });
    toast(id ? 'Content updated' : 'Draft created', 'success');
    closeContentEditor();
    renderCalendar(State.calendarDate);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function runAiAssist(action) {
  const text = document.getElementById('content-editor-body').value.trim();
  if (!text) { toast('Write something in the body first', 'error'); return; }
  const platforms = getSelectedPlatforms('content-editor-platforms');
  const resultBox = document.getElementById('ai-assist-result');
  const sourceEl = document.getElementById('ai-assist-source');
  const textEl = document.getElementById('ai-assist-text');

  resultBox.style.display = 'block';
  sourceEl.textContent = 'Thinking…';
  textEl.textContent = '';

  try {
    const id = await ensureContentSaved(text, platforms);
    const result = await api('POST', `/api/content/${id}/ai-assist`, { action, platform: platforms[0] });
    State.aiAssistResult = result.text;
    sourceEl.textContent = `${AI_SOURCE_ICONS[result.source] || '🤖'} ${result.model}`;
    textEl.textContent = result.text;
  } catch (err) {
    resultBox.style.display = 'none';
    toast(err.message, 'error');
  }
}

function insertAiAssistResult() {
  if (!State.aiAssistResult) return;
  document.getElementById('content-editor-body').value = State.aiAssistResult;
  toast('AI result inserted into body — review before saving', 'info');
}
```

Note on `saveContentEditor`: it calls `ensureContentSaved` (which persists `body`/`platforms`/`social_account_ids` and creates the item if needed) and then a second `PATCH` for `title`/`image_url`. This two-step shape exists because `ensureContentSaved` is shared with `runAiAssist` — which only ever needs to persist `body`/`platforms` (title/image aren't relevant to AI generation) — so it intentionally omits them; the editor's save path adds them back in a follow-up patch using the `id` that `ensureContentSaved` guarantees is set on `State.currentContentId`.

- [ ] **Step 7: Manually verify in the browser**

Run: `npm start` (or the project's existing dev-server command), open the app, log in, and go to the Calendar page.

Walk through:
1. The calendar loads in **Week** view by default, range label shows the current week, and the grid is empty (no content yet).
2. Click **➕ New Content** → the editor opens. Type a body, select a platform, click **Generate** under AI Assist → a result appears with a model-source icon (🦙/✨/🤖); click **Insert into body** → the textarea updates. Click **💾 Save draft** → toast confirms, modal closes, and a chip appears on today's cell (or this week's range) with the indigo "draft" color.
3. Click the chip → the detail modal opens showing the body, platform tags, a `draft` badge, and a **Submit for review** button (if your account's role has `content.submit`; e.g. `creator`/`manager`).
4. Toggle **Month**/**Agenda** views and confirm the same item renders (in the grid for Month, in the grouped list for Agenda) and that range navigation (← Prev / Next →) moves the visible window.
5. Uncheck the "Draft" status filter chip → the item disappears from the calendar; re-check it → it reappears.
6. If your logged-in role lacks a given transition's permission (e.g., a `creator` viewing an `in_review` item), confirm the **Approve**/**Reject** buttons are hidden — only the actions your role can perform should be visible.

Expected: no JavaScript console errors at any step, and every interaction above produces the described visible result.

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat(content): wire calendar UI to /api/content — views, filters, detail/editor modals, AI Assist"
```

---
