# Workspaces, RBAC & Multi-Account Tenancy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an org → workspace → member tenancy model with role-based permissions and per-workspace multi social accounts to NEXUS, on a dual-backend (SQLite + PostgreSQL) async data layer.

**Architecture:** Introduce Knex as the single query/migration layer, backend chosen by config. Convert the synchronous `better-sqlite3` data access into async `repos/*` modules. Add tenancy tables + a `can(role, action)` RBAC matrix + `withWorkspace`/`requirePermission` middleware. Re-architect social `tokens` into per-workspace `social_accounts`. Migrate existing desktop data once at startup.

**Tech Stack:** Node.js, Express, Knex.js (`sqlite3` + `pg` drivers), Jest, existing Electron shell.

**Spec:** `docs/superpowers/specs/2026-06-06-workspaces-rbac-tenancy-design.md`

---

## File Structure

**New files**
- `config/db.js` — resolves edition config (`DB_CLIENT`, paths/URL) into a Knex config object.
- `knexfile.js` — Knex CLI config (migrations dir, both clients) for running migrations.
- `services/knex.js` — singleton Knex instance built from `config/db.js`.
- `db/migrations/20260606000001_tenancy_core.js` — schema migration (new tables + `workspace_id` columns).
- `services/rbac.js` — role→permission matrix + `can(role, action)`.
- `middleware/tenancy.js` — `withWorkspace`, `requirePermission`.
- `repos/usersRepo.js`, `repos/orgsRepo.js`, `repos/workspacesRepo.js`, `repos/membershipsRepo.js`, `repos/invitationsRepo.js`, `repos/socialAccountsRepo.js`, `repos/postsRepo.js`, `repos/scheduledRepo.js`, `repos/settingsRepo.js`, `repos/configRepo.js` — async data access (one responsibility each).
- `services/legacyMigration.js` — one-time desktop data migration into the default org/workspace.
- `routes/workspaces.js`, `routes/orgs.js`, `routes/members.js`, `routes/invitations.js` — tenancy REST.
- `public/setup-workspace.js` + edits to dashboard — workspace switcher + members UI.
- `tests/rbac.test.js`, `tests/tenancy.middleware.test.js`, `tests/repos.isolation.test.js`, `tests/legacyMigration.test.js`, `tests/invitations.integration.test.js`, `tests/helpers/db.js`.

**Modified files**
- `package.json` — add deps + test/migrate scripts.
- `server/index.js` — async startup (run migrations, mount new routes, session store by edition).
- `routes/api.js`, `routes/media.js`, `routes/seo.js`, `routes/email.js`, `routes/tools.js`, `routes/config.js`, `routes/auth.js` — `await` async repos, add `withWorkspace`/`requirePermission`, OAuth attaches to active workspace.
- `middleware/auth.js` — `injectUserKeys` becomes async.
- `services/database.js` — retired in stages (replaced by `repos/*` + `services/knex.js`).

---

## Task 1: Add dependencies and dual-backend Knex config

**Files:**
- Modify: `package.json`
- Create: `config/db.js`, `services/knex.js`, `knexfile.js`
- Test: `tests/helpers/db.js`, `tests/db.config.test.js`

- [ ] **Step 1: Add dependencies and scripts**

In `package.json` `dependencies` add:
```json
"knex": "^3.1.0",
"sqlite3": "^5.1.7",
"pg": "^8.13.1",
"connect-pg-simple": "^10.0.0"
```
In `devDependencies` add:
```json
"jest": "^29.7.0"
```
In `scripts` add:
```json
"test": "jest --runInBand",
"migrate": "knex migrate:latest",
"migrate:make": "knex migrate:make"
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: installs without errors; `node_modules/knex` and `node_modules/sqlite3` exist.

- [ ] **Step 3: Write `config/db.js`**

```js
// Resolves the active edition's database config. DB_CLIENT=sqlite (desktop) or pg (cloud).
const path = require('path');

function dbConfig() {
  const client = process.env.DB_CLIENT || 'sqlite';
  if (client === 'pg') {
    return {
      client: 'pg',
      connection: process.env.DATABASE_URL,
      pool: { min: 2, max: 10 },
      migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
    };
  }
  const dataDir = process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', 'data');
  return {
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: { filename: path.join(dataDir, 'nexus.db') },
    pool: {
      // SQLite: enable WAL + FK on every connection
      afterCreate: (conn, done) => {
        conn.run('PRAGMA journal_mode = WAL;', () =>
          conn.run('PRAGMA foreign_keys = ON;', done));
      },
    },
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  };
}

module.exports = { dbConfig };
```

- [ ] **Step 4: Write `services/knex.js`**

```js
const knexLib = require('knex');
const { dbConfig } = require('../config/db');

const knex = knexLib(dbConfig());

module.exports = knex;
```

- [ ] **Step 5: Write `knexfile.js`** (for the Knex CLI)

```js
const { dbConfig } = require('./config/db');
module.exports = dbConfig();
```

- [ ] **Step 6: Write `tests/helpers/db.js`** (in-memory/throwaway DB per test file, both backends)

```js
const knexLib = require('knex');
const path = require('path');

// PG_TEST_URL set in CI for the postgres matrix leg; otherwise tests run on sqlite memory.
function makeTestKnex() {
  if (process.env.PG_TEST_URL) {
    return knexLib({ client: 'pg', connection: process.env.PG_TEST_URL, pool: { min: 1, max: 2 } });
  }
  return knexLib({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' },
    pool: {
      min: 1, max: 1,
      afterCreate: (c, done) => c.run('PRAGMA foreign_keys = ON;', done),
    },
    migrations: { directory: path.join(__dirname, '..', '..', 'db', 'migrations') },
  });
}

module.exports = { makeTestKnex };
```

- [ ] **Step 7: Write `tests/db.config.test.js`**

```js
const { dbConfig } = require('../config/db');

describe('dbConfig', () => {
  afterEach(() => { delete process.env.DB_CLIENT; delete process.env.DATABASE_URL; });

  test('defaults to sqlite3', () => {
    expect(dbConfig().client).toBe('sqlite3');
  });

  test('uses pg when DB_CLIENT=pg', () => {
    process.env.DB_CLIENT = 'pg';
    process.env.DATABASE_URL = 'postgres://u:p@localhost/db';
    const c = dbConfig();
    expect(c.client).toBe('pg');
    expect(c.connection).toBe('postgres://u:p@localhost/db');
  });
});
```

- [ ] **Step 8: Run the test**

Run: `npx jest tests/db.config.test.js -i`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json config/db.js services/knex.js knexfile.js tests/helpers/db.js tests/db.config.test.js
git commit -m "feat(db): add Knex dual-backend config (sqlite/pg)"
```

---

## Task 2: Tenancy schema migration (portable)

**Files:**
- Create: `db/migrations/20260606000001_tenancy_core.js`
- Test: `tests/migration.schema.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { makeTestKnex } = require('./helpers/db');

describe('tenancy_core migration', () => {
  let knex;
  beforeAll(async () => { knex = makeTestKnex(); await knex.migrate.latest(); });
  afterAll(async () => { await knex.destroy(); });

  test('creates core tenancy tables', async () => {
    expect(await knex.schema.hasTable('organizations')).toBe(true);
    expect(await knex.schema.hasTable('workspaces')).toBe(true);
    expect(await knex.schema.hasTable('memberships')).toBe(true);
    expect(await knex.schema.hasTable('org_members')).toBe(true);
    expect(await knex.schema.hasTable('invitations')).toBe(true);
    expect(await knex.schema.hasTable('social_accounts')).toBe(true);
  });

  test('posts has workspace_id', async () => {
    expect(await knex.schema.hasColumn('posts', 'workspace_id')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/migration.schema.test.js -i`
Expected: FAIL (no migration file / tables missing).

- [ ] **Step 3: Write the migration**

```js
// db/migrations/20260606000001_tenancy_core.js
exports.up = async function (knex) {
  const ts = (t, name) => t.integer(name).defaultTo(knex.raw("(strftime('%s','now'))")).nullable();
  // NOTE: for pg, the raw default is replaced below per-client.
  const epochDefault = knex.client.config.client === 'pg'
    ? knex.raw('extract(epoch from now())')
    : knex.raw("(strftime('%s','now'))");

  await knex.schema.createTable('organizations', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.integer('owner_user_id').notNullable();
    t.string('plan').defaultTo('free');
    t.integer('created_at').defaultTo(epochDefault);
  });

  await knex.schema.createTable('org_members', (t) => {
    t.increments('id').primary();
    t.integer('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.integer('user_id').notNullable();
    t.string('role').notNullable(); // owner | admin
    t.unique(['org_id', 'user_id']);
  });

  await knex.schema.createTable('workspaces', (t) => {
    t.increments('id').primary();
    t.integer('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('slug').notNullable();
    t.string('timezone').defaultTo('UTC');
    t.integer('created_at').defaultTo(epochDefault);
    t.unique(['org_id', 'slug']);
  });

  await knex.schema.createTable('memberships', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('role').notNullable(); // manager|creator|reviewer|client|analyst
    t.string('status').defaultTo('active');
    t.integer('created_at').defaultTo(epochDefault);
    t.unique(['user_id', 'workspace_id']);
  });

  await knex.schema.createTable('invitations', (t) => {
    t.increments('id').primary();
    t.integer('org_id').notNullable();
    t.integer('workspace_id');
    t.string('email').notNullable();
    t.string('role').notNullable();
    t.string('token').notNullable().unique();
    t.integer('invited_by');
    t.integer('expires_at');
    t.integer('accepted_at');
    t.integer('created_at').defaultTo(epochDefault);
  });

  await knex.schema.createTable('social_accounts', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('platform').notNullable();
    t.string('account_label');
    t.string('external_id');
    t.text('access_token');
    t.text('refresh_token');
    t.integer('expires_at');
    t.text('profile_json');
    t.string('page_id');
    t.text('page_token');
    t.string('ig_account_id');
    t.string('board_id');
    t.string('status').defaultTo('active');
    t.integer('created_at').defaultTo(epochDefault);
    t.unique(['workspace_id', 'platform', 'external_id']);
  });

  // Add workspace_id to existing data tables (create them if a fresh cloud DB).
  const dataTables = ['posts','scheduled_posts','history','analytics','seo_keywords',
    'utm_links','templates','email_subscribers','email_campaigns','apps','brand_kit','user_settings'];
  for (const tbl of dataTables) {
    if (await knex.schema.hasTable(tbl)) {
      if (!(await knex.schema.hasColumn(tbl, 'workspace_id'))) {
        await knex.schema.alterTable(tbl, (t) => t.integer('workspace_id').index());
      }
    }
  }
};

exports.down = async function (knex) {
  for (const tbl of ['social_accounts','invitations','memberships','workspaces','org_members','organizations']) {
    await knex.schema.dropTableIfExists(tbl);
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/migration.schema.test.js -i`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add db/migrations/20260606000001_tenancy_core.js tests/migration.schema.test.js
git commit -m "feat(db): add portable tenancy_core schema migration"
```

---

## Task 3: RBAC permission matrix

**Files:**
- Create: `services/rbac.js`
- Test: `tests/rbac.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { can, ROLES, ACTIONS } = require('../services/rbac');

describe('rbac can()', () => {
  test('manager can publish, creator cannot', () => {
    expect(can('manager', 'content.publish')).toBe(true);
    expect(can('creator', 'content.publish')).toBe(false);
  });
  test('creator can create+submit, not approve', () => {
    expect(can('creator', 'content.create')).toBe(true);
    expect(can('creator', 'content.submit')).toBe(true);
    expect(can('creator', 'content.approve')).toBe(false);
  });
  test('reviewer and client can approve, client cannot edit', () => {
    expect(can('reviewer', 'content.approve')).toBe(true);
    expect(can('client', 'content.approve')).toBe(true);
    expect(can('client', 'content.edit')).toBe(false);
  });
  test('analyst is read-only', () => {
    expect(can('analyst', 'content.view')).toBe(true);
    expect(can('analyst', 'content.create')).toBe(false);
  });
  test('manager can manage social + members', () => {
    expect(can('manager', 'social.manage')).toBe(true);
    expect(can('manager', 'members.manage')).toBe(true);
  });
  test('unknown role denies everything', () => {
    expect(can('ghost', 'content.view')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/rbac.test.js -i`
Expected: FAIL ("Cannot find module '../services/rbac'").

- [ ] **Step 3: Write `services/rbac.js`**

```js
// Single source of truth for per-workspace permissions.
const MATRIX = {
  manager:  ['social.manage','members.manage','content.create','content.edit','content.submit',
             'content.approve','content.comment','content.publish','content.schedule',
             'content.view','analytics.view'],
  creator:  ['content.create','content.edit','content.submit','content.view','analytics.view'],
  reviewer: ['content.approve','content.comment','content.view','analytics.view'],
  client:   ['content.approve','content.comment','content.view','analytics.view'],
  analyst:  ['content.view','analytics.view'],
};

const ROLES = Object.keys(MATRIX);
const ACTIONS = [...new Set(Object.values(MATRIX).flat())];

function can(role, action) {
  const perms = MATRIX[role];
  return Array.isArray(perms) && perms.includes(action);
}

module.exports = { can, ROLES, ACTIONS, MATRIX };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/rbac.test.js -i`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/rbac.js tests/rbac.test.js
git commit -m "feat(rbac): add role->permission matrix and can()"
```

---

## Task 4: Repos — workspaces, memberships, social accounts (worked example pattern)

**Files:**
- Create: `repos/workspacesRepo.js`, `repos/membershipsRepo.js`, `repos/socialAccountsRepo.js`
- Test: `tests/repos.isolation.test.js`

- [ ] **Step 1: Write the failing isolation test**

```js
const { makeTestKnex } = require('./helpers/db');

describe('repos workspace isolation', () => {
  let knex, social, ws;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    ws = require('../repos/workspacesRepo')(knex);
    social = require('../repos/socialAccountsRepo')(knex);
  });
  afterAll(async () => { await knex.destroy(); });

  test('social accounts are isolated per workspace', async () => {
    const org = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const orgId = org[0].id ?? org[0];
    const a = await ws.create({ orgId, name: 'A', slug: 'a' });
    const b = await ws.create({ orgId, name: 'B', slug: 'b' });
    await social.add(a.id, { platform: 'x', external_id: '1', account_label: 'A-x', access_token: 't' });
    await social.add(b.id, { platform: 'x', external_id: '2', account_label: 'B-x', access_token: 't' });

    const aAccts = await social.list(a.id);
    const bAccts = await social.list(b.id);
    expect(aAccts).toHaveLength(1);
    expect(aAccts[0].account_label).toBe('A-x');
    expect(bAccts).toHaveLength(1);
    expect(bAccts.find(x => x.account_label === 'A-x')).toBeUndefined();
  });

  test('multiple accounts per platform per workspace', async () => {
    const org = await knex('organizations').insert({ name: 'O2', owner_user_id: 1 }).returning('id');
    const orgId = org[0].id ?? org[0];
    const c = await ws.create({ orgId, name: 'C', slug: 'c' });
    await social.add(c.id, { platform: 'fb', external_id: '10', account_label: 'Main', access_token: 't' });
    await social.add(c.id, { platform: 'fb', external_id: '11', account_label: 'Support', access_token: 't' });
    expect(await social.list(c.id)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/repos.isolation.test.js -i`
Expected: FAIL ("Cannot find module '../repos/workspacesRepo'").

- [ ] **Step 3: Write `repos/workspacesRepo.js`**

```js
// Factory: pass a knex instance, get async data methods. (Enables test injection.)
module.exports = (knex) => ({
  async create({ orgId, name, slug, timezone = 'UTC' }) {
    const rows = await knex('workspaces')
      .insert({ org_id: orgId, name, slug, timezone })
      .returning(['id', 'org_id', 'name', 'slug', 'timezone']);
    const row = rows[0];
    // sqlite returning may yield only id on older drivers; normalise
    if (typeof row === 'number' || row.id === undefined) {
      const id = typeof row === 'number' ? row : row;
      return knex('workspaces').where({ id }).first();
    }
    return row;
  },
  list(orgId)   { return knex('workspaces').where({ org_id: orgId }).orderBy('name'); },
  get(id)       { return knex('workspaces').where({ id }).first(); },
  update(id, p) { return knex('workspaces').where({ id }).update(p); },
  remove(id)    { return knex('workspaces').where({ id }).del(); },
});
```

- [ ] **Step 4: Write `repos/membershipsRepo.js`**

```js
module.exports = (knex) => ({
  add({ userId, workspaceId, role }) {
    return knex('memberships')
      .insert({ user_id: userId, workspace_id: workspaceId, role })
      .onConflict(['user_id', 'workspace_id']).merge({ role });
  },
  roleFor(userId, workspaceId) {
    return knex('memberships')
      .where({ user_id: userId, workspace_id: workspaceId, status: 'active' })
      .first('role')
      .then(r => (r ? r.role : null));
  },
  listForUser(userId) {
    return knex('memberships as m')
      .join('workspaces as w', 'w.id', 'm.workspace_id')
      .where('m.user_id', userId)
      .select('w.id as workspace_id', 'w.name', 'w.org_id', 'm.role');
  },
  listMembers(workspaceId) {
    return knex('memberships').where({ workspace_id: workspaceId });
  },
  remove(userId, workspaceId) {
    return knex('memberships').where({ user_id: userId, workspace_id: workspaceId }).del();
  },
});
```

- [ ] **Step 5: Write `repos/socialAccountsRepo.js`**

```js
module.exports = (knex) => ({
  add(workspaceId, data) {
    return knex('social_accounts').insert({
      workspace_id: workspaceId,
      platform: data.platform,
      account_label: data.account_label || null,
      external_id: data.external_id || null,
      access_token: data.access_token || null,
      refresh_token: data.refresh_token || null,
      expires_at: data.expires_at || null,
      profile_json: data.profile ? JSON.stringify(data.profile) : null,
      page_id: data.page_id || null,
      page_token: data.page_token || null,
      ig_account_id: data.ig_account_id || null,
      board_id: data.board_id || null,
    }).onConflict(['workspace_id', 'platform', 'external_id']).merge();
  },
  async list(workspaceId) {
    const rows = await knex('social_accounts').where({ workspace_id: workspaceId });
    return rows.map(r => { if (r.profile_json) { try { r.profile = JSON.parse(r.profile_json); } catch {} } return r; });
  },
  getByPlatform(workspaceId, platform) {
    return knex('social_accounts').where({ workspace_id: workspaceId, platform }).first();
  },
  remove(workspaceId, id) {
    return knex('social_accounts').where({ workspace_id: workspaceId, id }).del();
  },
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest tests/repos.isolation.test.js -i`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add repos/workspacesRepo.js repos/membershipsRepo.js repos/socialAccountsRepo.js tests/repos.isolation.test.js
git commit -m "feat(repos): workspaces, memberships, social accounts (async, isolated)"
```

> **Pattern for the remaining repos** (`postsRepo`, `scheduledRepo`, `settingsRepo`, `configRepo`, `usersRepo`, `orgsRepo`, `invitationsRepo`): each is a `module.exports = (knex) => ({ ... })` factory whose read/write methods take `workspaceId` as the first arg and add `.where({ workspace_id })`. Port each method body 1:1 from the matching function in `services/database.js`, converting `db.prepare(...).get/all/run` to the awaited Knex equivalent (`.first()`, the array result, `.insert()/.update()/.del()`). Each gets a focused test asserting workspace filtering, following Task 4's shape.

---

## Task 5: Tenancy middleware

**Files:**
- Create: `middleware/tenancy.js`
- Test: `tests/tenancy.middleware.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { makeWithWorkspace, requirePermission } = require('../middleware/tenancy');

function mockRes() {
  return { code: null, body: null, status(c){ this.code=c; return this; }, json(b){ this.body=b; return this; } };
}

describe('tenancy middleware', () => {
  const memberships = { roleFor: async (u, w) => (u === 1 && w === 5 ? 'creator' : null) };
  const withWorkspace = makeWithWorkspace(memberships);

  test('attaches role for a member', async () => {
    const req = { session: { userId: 1, activeWorkspaceId: 5 } }; const res = mockRes();
    let called = false;
    await withWorkspace(req, res, () => { called = true; });
    expect(called).toBe(true);
    expect(req.workspaceId).toBe(5);
    expect(req.role).toBe('creator');
  });

  test('403 for non-member', async () => {
    const req = { session: { userId: 2, activeWorkspaceId: 5 } }; const res = mockRes();
    await withWorkspace(req, res, () => { throw new Error('should not call next'); });
    expect(res.code).toBe(403);
  });

  test('requirePermission gates by role', () => {
    const guard = requirePermission('content.publish');
    const res1 = mockRes();
    guard({ role: 'creator' }, res1, () => { throw new Error('no'); });
    expect(res1.code).toBe(403);
    let ok = false;
    guard({ role: 'manager' }, mockRes(), () => { ok = true; });
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/tenancy.middleware.test.js -i`
Expected: FAIL ("Cannot find module '../middleware/tenancy'").

- [ ] **Step 3: Write `middleware/tenancy.js`**

```js
const { can } = require('../services/rbac');

// Factory takes a memberships repo so it's testable without a DB.
function makeWithWorkspace(membershipsRepo) {
  return async function withWorkspace(req, res, next) {
    const userId = req.session?.userId;
    const workspaceId = req.session?.activeWorkspaceId
      || Number(req.headers['x-workspace-id'])
      || Number(req.params.workspaceId);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    if (!workspaceId) return res.status(400).json({ error: 'No active workspace' });
    const role = await membershipsRepo.roleFor(userId, workspaceId);
    if (!role) return res.status(403).json({ error: 'Not a member of this workspace' });
    req.workspaceId = workspaceId;
    req.role = role;
    next();
  };
}

function requirePermission(action) {
  return function (req, res, next) {
    if (!can(req.role, action)) {
      return res.status(403).json({ error: 'Forbidden', requiredPermission: action });
    }
    next();
  };
}

module.exports = { makeWithWorkspace, requirePermission };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/tenancy.middleware.test.js -i`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add middleware/tenancy.js tests/tenancy.middleware.test.js
git commit -m "feat(tenancy): withWorkspace + requirePermission middleware"
```

---

## Task 6: Legacy desktop data migration

**Files:**
- Create: `services/legacyMigration.js`, `repos/configRepo.js`, `repos/orgsRepo.js`
- Test: `tests/legacyMigration.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { makeTestKnex } = require('./helpers/db');
const runLegacyMigration = require('../services/legacyMigration');

async function seedLegacy(knex) {
  // emulate pre-tenancy data
  await knex('platform_config').insert({ key: 'x', value: '1' }).catch(()=>{});
  await knex('users').insert({ id: 1, email: 'a@b.c', password_hash: 'h', name: 'Admin', role: 'admin' });
  await knex('tokens').insert({ platform: 'x', access_token: 'tok', external_id: null });
  await knex('posts').insert({ content: 'hi', platforms: '["x"]', status: 'published' });
}

describe('legacy migration', () => {
  let knex;
  beforeAll(async () => {
    knex = makeTestKnex();
    // create legacy tables the app already had
    await knex.schema.createTable('users', t => { t.increments('id'); t.string('email'); t.string('password_hash'); t.string('name'); t.string('role'); });
    await knex.schema.createTable('platform_config', t => { t.string('key').primary(); t.string('value'); });
    await knex.schema.createTable('tokens', t => { t.string('platform'); t.string('access_token'); t.string('external_id'); });
    await knex.schema.createTable('posts', t => { t.increments('id'); t.text('content'); t.text('platforms'); t.string('status'); });
    await knex.migrate.latest(); // adds tenancy tables + workspace_id columns
    await seedLegacy(knex);
  });
  afterAll(async () => { await knex.destroy(); });

  test('creates org/workspace/membership, migrates tokens, stamps rows, idempotent', async () => {
    await runLegacyMigration(knex);
    const org = await knex('organizations').first();
    const wsp = await knex('workspaces').first();
    expect(org).toBeTruthy();
    expect(wsp.org_id).toBe(org.id);
    expect(await knex('memberships').where({ user_id: 1, workspace_id: wsp.id }).first()).toBeTruthy();
    expect((await knex('social_accounts').where({ workspace_id: wsp.id })).length).toBe(1);
    const post = await knex('posts').first();
    expect(post.workspace_id).toBe(wsp.id);
    const flag = await knex('platform_config').where({ key: 'tenancy_migrated' }).first();
    expect(flag.value).toBe('1');

    // idempotent: second run creates nothing new
    await runLegacyMigration(knex);
    expect((await knex('organizations')).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/legacyMigration.test.js -i`
Expected: FAIL ("Cannot find module '../services/legacyMigration'").

- [ ] **Step 3: Write `repos/configRepo.js`**

```js
module.exports = (knex) => ({
  async get(key, def = null) {
    const row = await knex('platform_config').where({ key }).first();
    return row ? row.value : def;
  },
  set(key, value) {
    return knex('platform_config').insert({ key, value: String(value) })
      .onConflict('key').merge({ value: String(value) });
  },
});
```

- [ ] **Step 4: Write `repos/orgsRepo.js`**

```js
module.exports = (knex) => ({
  async create({ name, ownerUserId, plan = 'free' }) {
    const rows = await knex('organizations').insert({ name, owner_user_id: ownerUserId, plan }).returning('id');
    const id = rows[0]?.id ?? rows[0];
    await knex('org_members').insert({ org_id: id, user_id: ownerUserId, role: 'owner' }).catch(() => {});
    return knex('organizations').where({ id }).first();
  },
  list(userId) {
    return knex('organizations as o')
      .join('org_members as m', 'm.org_id', 'o.id')
      .where('m.user_id', userId)
      .select('o.*', 'm.role as org_role');
  },
});
```

- [ ] **Step 5: Write `services/legacyMigration.js`**

```js
// One-time, idempotent migration of pre-tenancy desktop data into a default org/workspace.
const STAMP_TABLES = ['posts','scheduled_posts','history','analytics','seo_keywords',
  'utm_links','templates','email_subscribers','email_campaigns','apps','brand_kit','user_settings'];

module.exports = async function runLegacyMigration(knex) {
  const cfg = require('../repos/configRepo')(knex);
  if (await cfg.get('tenancy_migrated') === '1') return;

  await knex.transaction(async (trx) => {
    const admin = await trx('users').orderBy('id').first();
    if (!admin) { await cfg.set('tenancy_migrated', '1'); return; } // fresh install, nothing to migrate

    const orgName = 'My Organization';
    const orgRows = await trx('organizations').insert({ name: orgName, owner_user_id: admin.id, plan: 'free' }).returning('id');
    const orgId = orgRows[0]?.id ?? orgRows[0];
    await trx('org_members').insert({ org_id: orgId, user_id: admin.id, role: 'owner' });

    const wsRows = await trx('workspaces').insert({ org_id: orgId, name: 'My Workspace', slug: 'my-workspace', timezone: 'UTC' }).returning('id');
    const wsId = wsRows[0]?.id ?? wsRows[0];

    const users = await trx('users');
    for (const u of users) {
      await trx('memberships').insert({ user_id: u.id, workspace_id: wsId, role: 'manager' }).onConflict(['user_id','workspace_id']).ignore();
    }

    if (await trx.schema.hasTable('tokens')) {
      const tokens = await trx('tokens');
      for (const tk of tokens) {
        await trx('social_accounts').insert({
          workspace_id: wsId, platform: tk.platform, external_id: tk.external_id || tk.platform,
          access_token: tk.access_token, refresh_token: tk.refresh_token || null,
          expires_at: tk.expires_at || null, profile_json: tk.profile || null,
          page_id: tk.page_id || null, page_token: tk.page_token || null,
          ig_account_id: tk.ig_account_id || null, board_id: tk.board_id || null,
        }).onConflict(['workspace_id','platform','external_id']).ignore();
      }
    }

    for (const tbl of STAMP_TABLES) {
      if (await trx.schema.hasTable(tbl) && await trx.schema.hasColumn(tbl, 'workspace_id')) {
        await trx(tbl).whereNull('workspace_id').update({ workspace_id: wsId });
      }
    }
    await trx('platform_config').insert({ key: 'tenancy_migrated', value: '1' }).onConflict('key').merge({ value: '1' });
  });
};
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest tests/legacyMigration.test.js -i`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add services/legacyMigration.js repos/configRepo.js repos/orgsRepo.js tests/legacyMigration.test.js
git commit -m "feat(tenancy): idempotent legacy data migration"
```

---

## Task 7: Invitations repo + integration (invite → accept → role-gated action)

**Files:**
- Create: `repos/invitationsRepo.js`
- Test: `tests/invitations.integration.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { makeTestKnex } = require('./helpers/db');
const { can } = require('../services/rbac');

describe('invitations + role-gated actions', () => {
  let knex, invites, members, ws;
  beforeAll(async () => {
    knex = makeTestKnex(); await knex.migrate.latest();
    invites = require('../repos/invitationsRepo')(knex);
    members = require('../repos/membershipsRepo')(knex);
    ws = require('../repos/workspacesRepo')(knex);
  });
  afterAll(async () => { await knex.destroy(); });

  test('invited creator can submit but not publish', async () => {
    const orgRows = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const orgId = orgRows[0]?.id ?? orgRows[0];
    const w = await ws.create({ orgId, name: 'W', slug: 'w' });
    const inv = await invites.create({ orgId, workspaceId: w.id, email: 'c@x.com', role: 'creator', invitedBy: 1 });
    expect(inv.token).toBeTruthy();

    const accepted = await invites.accept(inv.token, 42); // user 42 accepts
    expect(accepted).toBe(true);
    expect(await members.roleFor(42, w.id)).toBe('creator');

    expect(can('creator', 'content.submit')).toBe(true);
    expect(can('creator', 'content.publish')).toBe(false);
  });

  test('expired invite rejected', async () => {
    const inv = await invites.create({ orgId: 1, workspaceId: 1, email: 'e@x.com', role: 'client', invitedBy: 1, expiresInHours: -1 });
    expect(await invites.accept(inv.token, 7)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/invitations.integration.test.js -i`
Expected: FAIL ("Cannot find module '../repos/invitationsRepo'").

- [ ] **Step 3: Write `repos/invitationsRepo.js`**

```js
const crypto = require('crypto');

module.exports = (knex) => ({
  async create({ orgId, workspaceId, email, role, invitedBy, expiresInHours = 168 }) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires_at = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
    await knex('invitations').insert({ org_id: orgId, workspace_id: workspaceId, email, role, token, invited_by: invitedBy, expires_at });
    return { token, email, role };
  },
  get(token) { return knex('invitations').where({ token }).first(); },
  async accept(token, userId) {
    const inv = await knex('invitations').where({ token }).first();
    if (!inv || inv.accepted_at) return false;
    if (inv.expires_at && inv.expires_at < Math.floor(Date.now() / 1000)) return false;
    await knex('memberships')
      .insert({ user_id: userId, workspace_id: inv.workspace_id, role: inv.role })
      .onConflict(['user_id', 'workspace_id']).merge({ role: inv.role });
    await knex('invitations').where({ token }).update({ accepted_at: Math.floor(Date.now() / 1000) });
    return true;
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/invitations.integration.test.js -i`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add repos/invitationsRepo.js tests/invitations.integration.test.js
git commit -m "feat(tenancy): invitations repo with accept + expiry"
```

---

## Task 8: Wire startup — run migrations + legacy migration; session by edition

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Convert startup to async and run migrations**

Replace the top of `server/index.js` server bootstrap so that, before `app.listen`, it runs:
```js
const knex = require('./services/knex');         // adjust relative path: require('../services/knex') from server/
const runLegacyMigration = require('../services/legacyMigration');

async function bootstrap() {
  await knex.migrate.latest();          // schema (both backends)
  await runLegacyMigration(knex);       // desktop legacy data (no-op on fresh/cloud)
  // ... existing app setup ...
  app.listen(PORT, () => console.log(`NEXUS on ${PORT}`));
}
bootstrap().catch(err => { console.error('[Startup] fatal', err); process.exit(1); });
```

- [ ] **Step 2: Switch session store by edition**

Where the session store is created, branch on `DB_CLIENT`:
```js
let store;
if (process.env.DB_CLIENT === 'pg') {
  const pgSession = require('connect-pg-simple')(session);
  store = new pgSession({ conString: process.env.DATABASE_URL, createTableIfMissing: true });
} else {
  const SQLiteStore = require('connect-sqlite3')(session);
  store = new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR });
}
app.use(session({ store, /* existing options */ }));
```

- [ ] **Step 3: Manual smoke test (desktop/sqlite)**

Run: `set DB_CLIENT=sqlite&& set NEXUS_DATA_DIR=%TEMP%\nexustest&& node server/index.js` (PowerShell: `$env:DB_CLIENT='sqlite'; $env:NEXUS_DATA_DIR="$env:TEMP\nexustest"; node server/index.js`)
Expected: logs "NEXUS on 3000"; `%TEMP%\nexustest\nexus.db` is created with tenancy tables.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(server): async startup runs migrations + legacy migration; session store by edition"
```

---

## Task 9: Tenancy REST routes

**Files:**
- Create: `routes/workspaces.js`, `routes/members.js`, `routes/invitations.js`
- Modify: `server/index.js` (mount), `middleware/auth.js`
- Test: `tests/routes.workspaces.test.js`

- [ ] **Step 1: Write the failing route test (supertest)**

Add `supertest` to devDependencies (`npm i -D supertest`). Then:
```js
const request = require('supertest');
const express = require('express');
const { makeTestKnex } = require('./helpers/db');

// Build a tiny app wiring the workspaces router with a fake session.
function appWith(knex, session) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = session; next(); });
  app.use('/workspaces', require('../routes/workspaces')(knex));
  return app;
}

describe('workspaces routes', () => {
  let knex;
  beforeAll(async () => { knex = makeTestKnex(); await knex.migrate.latest();
    const o = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const orgId = o[0]?.id ?? o[0];
    await knex('org_members').insert({ org_id: orgId, user_id: 1, role: 'owner' });
  });
  afterAll(async () => { await knex.destroy(); });

  test('owner can create a workspace', async () => {
    const org = await knex('organizations').first();
    const res = await request(appWith(knex, { userId: 1 }))
      .post('/workspaces').send({ orgId: org.id, name: 'Client A', slug: 'client-a' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Client A');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/routes.workspaces.test.js -i`
Expected: FAIL ("Cannot find module '../routes/workspaces'").

- [ ] **Step 3: Write `routes/workspaces.js`**

```js
const express = require('express');

// Factory so tests can inject a knex; production passes the singleton.
module.exports = (knex) => {
  const router = express.Router();
  const orgs = require('../repos/orgsRepo')(knex);
  const ws = require('../repos/workspacesRepo')(knex);
  const members = require('../repos/membershipsRepo')(knex);

  async function isOrgOwnerOrAdmin(userId, orgId) {
    const row = await knex('org_members').where({ org_id: orgId, user_id: userId }).first();
    return row && (row.role === 'owner' || row.role === 'admin');
  }

  router.get('/', async (req, res) => {
    res.json(await members.listForUser(req.session.userId));
  });

  router.post('/', async (req, res) => {
    const { orgId, name, slug } = req.body;
    if (!(await isOrgOwnerOrAdmin(req.session.userId, orgId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const w = await ws.create({ orgId, name, slug });
    await members.add({ userId: req.session.userId, workspaceId: w.id, role: 'manager' });
    res.status(201).json(w);
  });

  router.patch('/:id', async (req, res) => {
    const w = await ws.get(req.params.id);
    if (!w || !(await isOrgOwnerOrAdmin(req.session.userId, w.org_id))) return res.status(403).json({ error: 'Forbidden' });
    await ws.update(req.params.id, { name: req.body.name, timezone: req.body.timezone });
    res.json(await ws.get(req.params.id));
  });

  return router;
};
```

- [ ] **Step 4: Write `routes/members.js`** (manage members; Manager only)

```js
const express = require('express');
const { ROLES } = require('../services/rbac');

module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router({ mergeParams: true });
  const members = require('../repos/membershipsRepo')(knex);

  router.get('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    res.json(await members.listMembers(req.workspaceId));
  });
  router.post('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    const { userId, role } = req.body;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    await members.add({ userId, workspaceId: req.workspaceId, role });
    res.status(201).json({ ok: true });
  });
  router.delete('/:userId', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    await members.remove(Number(req.params.userId), req.workspaceId);
    res.json({ ok: true });
  });
  return router;
};
```

- [ ] **Step 5: Write `routes/invitations.js`**

```js
const express = require('express');

module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router();
  const invites = require('../repos/invitationsRepo')(knex);

  router.post('/', withWorkspace, requirePermission('members.manage'), async (req, res) => {
    const { email, role } = req.body;
    const inv = await invites.create({
      orgId: req.body.orgId, workspaceId: req.workspaceId, email, role, invitedBy: req.session.userId,
    });
    res.status(201).json(inv); // caller emails the link /invite/<token>
  });

  router.post('/:token/accept', async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Log in to accept' });
    const ok = await invites.accept(req.params.token, req.session.userId);
    res.status(ok ? 200 : 400).json({ ok });
  });
  return router;
};
```

- [ ] **Step 6: Mount in `server/index.js`**

```js
const knex = require('../services/knex');
const { makeWithWorkspace, requirePermission } = require('../middleware/tenancy');
const withWorkspace = makeWithWorkspace(require('../repos/membershipsRepo')(knex));

app.use('/workspaces', require('../routes/workspaces')(knex));
app.use('/workspaces/:workspaceId/members', require('../routes/members')(knex, withWorkspace, requirePermission));
app.use('/invitations', require('../routes/invitations')(knex, withWorkspace, requirePermission));
app.post('/session/active-workspace', (req, res) => {
  req.session.activeWorkspaceId = Number(req.body.workspaceId);
  res.json({ ok: true });
});
app.get('/me/workspaces', async (req, res) => {
  res.json(await require('../repos/membershipsRepo')(knex).listForUser(req.session.userId));
});
```

- [ ] **Step 7: Run the route test**

Run: `npx jest tests/routes.workspaces.test.js -i`
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git add routes/workspaces.js routes/members.js routes/invitations.js server/index.js tests/routes.workspaces.test.js package.json package-lock.json
git commit -m "feat(tenancy): workspace/member/invitation REST + active-workspace session"
```

---

## Task 10: Scope existing /api routes + async data layer

**Files:**
- Modify: `routes/api.js`, `routes/media.js`, `routes/seo.js`, `routes/email.js`, `routes/tools.js`, `routes/config.js`, `middleware/auth.js`
- Create: `repos/postsRepo.js`, `repos/scheduledRepo.js`, `repos/settingsRepo.js` (+ any others referenced by these routes)

- [ ] **Step 1: Add `withWorkspace` to the protected mount**

In `server/index.js`, change the protected mounts so every `/api/*` request resolves a workspace:
```js
app.use('/api', requireAuth, withWorkspace, injectUserKeys, apiRoutes);
```
(Repeat for `/api/seo`, `/api/email`, `/api/tools`, `/api/media`, `/api/config`.)

- [ ] **Step 2: Write `repos/postsRepo.js`** (workspace-scoped; port of `savePost`/`getPostHistory`)

```js
module.exports = (knex) => ({
  async save(workspaceId, userId, data) {
    const rows = await knex('posts').insert({
      workspace_id: workspaceId, user_id: userId, content: data.content,
      platforms: JSON.stringify(data.platforms), image_url: data.image_url || null,
      results: data.results ? JSON.stringify(data.results) : null, status: data.status || 'published',
    }).returning('id');
    return rows[0]?.id ?? rows[0];
  },
  async history(workspaceId, limit = 50) {
    const rows = await knex('posts').where({ workspace_id: workspaceId }).orderBy('created_at', 'desc').limit(limit);
    return rows.map(p => ({ ...p, platforms: safe(p.platforms), results: safe(p.results) }));
  },
});
function safe(v){ if(!v) return v; try { return JSON.parse(v); } catch { return v; } }
```

- [ ] **Step 3: Convert each route handler to async + scoped repo**

In `routes/api.js`, replace `const db = require('../services/database')` usages. For each handler that read/wrote posts/scheduled/etc., change to the repo and add `req.workspaceId`. Example — the post-history endpoint:
```js
const posts = require('../repos/postsRepo')(require('../services/knex'));
router.get('/posts', async (req, res) => {
  res.json(await posts.history(req.workspaceId));
});
```
Apply the same mechanical change to every `db.*` call in `routes/api.js`, `routes/media.js`, `routes/seo.js`, `routes/email.js`, `routes/tools.js`, `routes/config.js`: import the matching repo, `await` it, pass `req.workspaceId`. Make each handler `async`.

- [ ] **Step 4: Make `injectUserKeys` async** in `middleware/auth.js`

```js
const settingsRepo = require('../repos/settingsRepo')(require('../services/knex'));
async function injectUserKeys(req, res, next) {
  if (req.session?.userId) {
    const s = await settingsRepo.get(req.session.userId);
    if (s?.google_ai_key) req.googleKey = s.google_ai_key;
    if (s?.anthropic_key) req.anthropicKey = s.anthropic_key;
    if (s?.ollama_enabled) req.ollamaEnabled = !!s.ollama_enabled;
    if (s?.ollama_model)  req.ollamaModel  = s.ollama_model;
  }
  next();
}
```

- [ ] **Step 5: Manual smoke test**

Run the app (`$env:DB_CLIENT='sqlite'; node server/index.js`), log in, confirm `/api/posts` returns only the active workspace's posts and creating a post stamps `workspace_id`.

- [ ] **Step 6: Commit**

```bash
git add routes/*.js middleware/auth.js repos/postsRepo.js repos/scheduledRepo.js repos/settingsRepo.js server/index.js
git commit -m "refactor(api): scope all /api data to active workspace via async repos"
```

---

## Task 11: Social-account routes + OAuth attaches to active workspace

**Files:**
- Create: `routes/social-accounts.js`
- Modify: `routes/auth.js` (OAuth callbacks), `server/index.js`

- [ ] **Step 1: Write `routes/social-accounts.js`**

```js
const express = require('express');
module.exports = (knex, withWorkspace, requirePermission) => {
  const router = express.Router();
  const social = require('../repos/socialAccountsRepo')(knex);
  router.get('/', withWorkspace, async (req, res) => res.json(await social.list(req.workspaceId)));
  router.delete('/:id', withWorkspace, requirePermission('social.manage'), async (req, res) => {
    await social.remove(req.workspaceId, Number(req.params.id));
    res.json({ ok: true });
  });
  return router;
};
```

- [ ] **Step 2: Update OAuth callbacks in `routes/auth.js`**

Wherever a callback currently calls `db.saveToken(platform, data)`, change to attach to the active workspace:
```js
const social = require('../repos/socialAccountsRepo')(require('../services/knex'));
// inside the callback, after obtaining tokens + profile:
await social.add(req.session.activeWorkspaceId, {
  platform, external_id: profile.id, account_label: profile.name || platform,
  access_token, refresh_token, expires_at, profile, page_id, page_token, ig_account_id, board_id,
});
```

- [ ] **Step 3: Mount the route** in `server/index.js`:
```js
app.use('/social-accounts', require('../routes/social-accounts')(knex, withWorkspace, requirePermission));
```

- [ ] **Step 4: Manual smoke test**

Connect one platform twice with different accounts in the same workspace; confirm `/social-accounts` lists both, and a second workspace lists none.

- [ ] **Step 5: Commit**

```bash
git add routes/social-accounts.js routes/auth.js server/index.js
git commit -m "feat(social): per-workspace multi-account connections via OAuth"
```

---

## Task 12: UI — workspace switcher, members page, invite accept

**Files:**
- Create: `public/setup-workspace.js`, `public/invite.html`
- Modify: `public/index.html` (header switcher + members settings panel), `public/app.js`

- [ ] **Step 1: Add the workspace switcher to the header**

In `public/index.html`, add a `<select id="workspaceSwitcher">` in the header. In `public/app.js`, on load:
```js
async function loadWorkspaces() {
  const list = await (await fetch('/me/workspaces')).json();
  const sel = document.getElementById('workspaceSwitcher');
  sel.innerHTML = list.map(w => `<option value="${w.workspace_id}">${w.name} (${w.role})</option>`).join('');
  sel.onchange = async () => {
    await fetch('/session/active-workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: Number(sel.value) }) });
    location.reload();
  };
}
loadWorkspaces();
```

- [ ] **Step 2: Members panel** — a settings section listing members with role dropdowns and an invite-by-email form that POSTs `/invitations` and shows the returned `/invite/<token>` link.

```js
async function inviteMember(email, role) {
  const r = await fetch('/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role, orgId: currentOrgId }) });
  const inv = await r.json();
  showInviteLink(`${location.origin}/invite.html?token=${inv.token}`);
}
```

- [ ] **Step 3: `public/invite.html`** — reads `?token=`, ensures the user is logged in, then POSTs `/invitations/:token/accept` and redirects to the dashboard.

```html
<script>
  const token = new URLSearchParams(location.search).get('token');
  fetch(`/invitations/${token}/accept`, { method: 'POST' })
    .then(r => r.json()).then(d => { location.href = d.ok ? '/' : '/login.html'; });
</script>
```

- [ ] **Step 4: Manual smoke test**

Create a 2nd workspace, switch via the header, invite a teammate, accept via the link in another browser/profile, confirm role-gated UI (Creator sees no Publish button).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/setup-workspace.js public/invite.html
git commit -m "feat(ui): workspace switcher, members management, invite accept"
```

---

## Task 13: CI test matrix (SQLite + Postgres)

**Files:**
- Create: `.github/workflows/test.yml` (or Bitbucket Pipelines equivalent)

- [ ] **Step 1: Add a CI workflow that runs `npm test` twice**

```yaml
name: tests
on: [push, pull_request]
jobs:
  sqlite:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test
  postgres:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: pw, POSTGRES_DB: nexus_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready" --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      PG_TEST_URL: postgres://postgres:pw@localhost:5432/nexus_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test
```

- [ ] **Step 2: Run the full suite locally (sqlite leg)**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run test suite on sqlite and postgres"
```

---

## Self-Review (completed)

- **Spec coverage:** dual-backend data layer (T1), portable schema (T2), RBAC (T3), repos + isolation (T4, T10), middleware (T5), legacy migration (T6), invitations (T7), startup/sessions (T8), tenancy REST (T9), scoped /api (T10), social re-arch (T11), UI (T12), both-backend tests (T13). All spec sections map to a task.
- **Placeholder scan:** every code step shows real code; the only generalized step is the explicit, enumerated repo/route conversion pattern (Task 4 note, Task 10 Step 3) which states the exact mechanical transformation and lists the files.
- **Type consistency:** repo factories are uniformly `(knex) => ({...})`; `roleFor(userId, workspaceId)`, `social.add(workspaceId, data)`, `ws.create({orgId,...})` used consistently across tasks; `withWorkspace` built once and injected.
- **Note for executor:** run tasks in order — later tasks depend on earlier repos/middleware. Keep `services/database.js` until Task 10 retires its last caller, then delete it in the Task 10 commit.
