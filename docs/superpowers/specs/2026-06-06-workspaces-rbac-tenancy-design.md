# NEXUS — Workspaces, RBAC & Multi-Account Tenancy (Phase 1a)

**Date:** 2026-06-06
**Status:** Approved (ready for implementation plan)
**Part of:** Phase 1 Foundation of the agentic one-stop marketing platform roadmap.
**Next spec (1b):** Unified Content model & Calendar (depends on this).

## Goal

Turn NEXUS's half-wired single-tenant model into a proper multi-tenant foundation
that supports companies/agencies (multiple client brands, teams with roles),
content creators, and individuals — with **real data isolation** and **multiple
social accounts per platform per workspace**. This is the backbone the approval
workflow, scheduler, and agents will build on.

## Problem with today's model

- Most data helpers (`getPostHistory`, `getScheduledPosts`, `getToken`,
  `getAnalytics`) **do not filter by tenant** — data leaks across users.
- The `tokens` table uses `platform` as PRIMARY KEY → only **one social account
  per platform globally**. No per-workspace or multi-account support.
- Roles are only `admin`/`user`; no workspace concept, no granular permissions.

## Scope

**In scope (1a):** Dual-backend data layer (Knex over SQLite/Postgres, async repos);
Organizations, Workspaces, Memberships, Invitations, role→permission RBAC;
per-workspace multi social accounts (replacing `tokens`); tenant data isolation;
migration of existing data; workspace switcher + member-management UI.

**Out of scope (later specs):** Content model & calendar (1b), approval workflow (3),
scheduler (4), MCP connectors (5), agents (6+). Billing beyond a `plan` string.

## Architecture

This phase also adopts a **dual-backend data layer** so the same codebase runs as a
**desktop/self-host edition (SQLite)** and a **cloud multi-tenant edition
(PostgreSQL, for 100+ concurrent users)**. Both are served by one query layer
selected by config; tenancy, RBAC, and routes are written once against that layer.

### Data layer & editions

- **Knex.js** is the single query builder + migration tool. Backend is chosen by
  config: `DB_CLIENT=sqlite` (file in `NEXUS_DATA_DIR`, desktop) or `DB_CLIENT=pg`
  (`DATABASE_URL`, cloud). Connection pooling on Postgres.
- The current synchronous `better-sqlite3` calls are replaced by Knex's **async**
  API. This is the one large change: existing `services/database.js` becomes a set
  of **async repository modules** (`repos/usersRepo`, `workspacesRepo`,
  `socialAccountsRepo`, `postsRepo`, …), and all route handlers that touch data
  become `async/await`. A mechanical but broad refactor.
  - Side benefit: under Knex, SQLite uses the N-API `sqlite3` driver (already a
    dependency via `connect-sqlite3`), removing the native-ABI rebuild fragility
    that `better-sqlite3` caused with Electron.
- **Schema portability:** migrations use Knex's portable types —
  `increments()` for ids (maps to AUTOINCREMENT / SERIAL), integer **epoch
  seconds** for timestamps (avoids `strftime` vs `now()` differences), `text` for
  JSON payloads (parsed in app code). No DB-specific raw SQL in migrations.
- **Sessions / jobs by edition:** sessions use `connect-sqlite3` (desktop) or
  `connect-pg-simple` (cloud) behind one config switch. The in-process `node-cron`
  scheduler stays for desktop; the cloud edition will move scheduling/agents to a
  job queue (pg-boss/BullMQ) in the later Scheduler/Agent phases — noted here so
  the job-trigger interface is abstracted now, implemented later.

Express routes, session auth, and the tenancy middleware are otherwise extended in
place. No ORM or RBAC library — RBAC stays a small in-house matrix.

### Data model (new tables)

```
organizations(id, name, owner_user_id, plan TEXT DEFAULT 'free', created_at)
org_members(id, org_id, user_id, role TEXT)            -- role: owner | admin
workspaces(id, org_id, name, slug, timezone TEXT DEFAULT 'UTC', created_at,
           UNIQUE(org_id, slug))
-- brand kit is workspace-scoped via brand_kit.workspace_id (no FK on workspaces)
memberships(id, user_id, workspace_id, role TEXT, status TEXT DEFAULT 'active',
            created_at, UNIQUE(user_id, workspace_id))
invitations(id, org_id, workspace_id, email, role, token UNIQUE, invited_by,
            expires_at, accepted_at, created_at)
social_accounts(id, workspace_id, platform, account_label, external_id,
                access_token, refresh_token, expires_at, profile_json,
                page_id, page_token, ig_account_id, board_id,
                status TEXT DEFAULT 'active', created_at,
                UNIQUE(workspace_id, platform, external_id))
```

Existing data tables (`posts`, `scheduled_posts`, `history`, `analytics`,
`seo_keywords`, `utm_links`, `templates`, `email_*`, `apps`, `brand_kit`) gain a
`workspace_id INTEGER` column (indexed). The existing `user_id` column is retained
as "created_by".

### Roles → capability matrix

Per-workspace roles: **Manager, Creator, Reviewer, Client, Analyst**.
Org-level roles (in `org_members`): **Owner, Admin** — implicitly Manager on every
workspace in their org.

| Capability (action key)        | Manager | Creator | Reviewer | Client | Analyst |
|--------------------------------|:------:|:------:|:------:|:-----:|:------:|
| social.manage                  | ✅ | – | – | – | – |
| members.manage                 | ✅ | – | – | – | – |
| content.create / content.edit  | ✅ | ✅ | – | – | – |
| content.submit                 | ✅ | ✅ | – | – | – |
| content.approve / .comment     | ✅ | – | ✅ | ✅ | – |
| content.publish / .schedule    | ✅ | – | – | – | – |
| content.view / analytics.view  | ✅ | ✅ | ✅ | ✅ | ✅ |

Implemented as a single pure function `can(role, action) -> boolean` backed by a
static matrix (one source of truth, unit-tested).

### Tenancy enforcement

- Session carries `userId` and `activeWorkspaceId`.
- `withWorkspace` middleware: reads `activeWorkspaceId` (or `X-Workspace-Id`
  header / `:workspaceId` param), loads the caller's membership, sets
  `req.workspaceId`, `req.role`. Returns 403 if not a member.
- `requirePermission(action)` route guard uses `can(req.role, action)`.
- **Scoped data layer** (async `repos/*` over Knex): every data helper takes a
  `workspaceId` first argument and filters by it. This fixes the current leak.
  A mechanical 1:1 refactor of existing helpers + their call sites to `async/await`.

### Social accounts re-architecture

Replace global `tokens` with `social_accounts` keyed by
`(workspace_id, platform, external_id)` → multiple accounts per platform per
workspace. OAuth callbacks attach the newly connected account to the user's
active workspace. Publishing/scheduling select target accounts by workspace.
`saveToken/getToken/getAllTokens/deleteToken` become
`saveSocialAccount/getSocialAccounts/...` (workspace-scoped); old names kept as
thin shims during transition where practical.

### Migration & backward compatibility

Two layers of migration:
- **Schema migrations** are Knex migration files (run on both SQLite and Postgres)
  that create the new tables and add `workspace_id` columns. For a fresh cloud
  (Postgres) install they simply build the schema.
- **Legacy data migration** (desktop upgrades only): a one-time, idempotent step
  runs at startup (guarded by a `platform_config` flag `tenancy_migrated`):
1. Create a default Organization (`name = brand_kit.company_name || 'My Organization'`),
   set `owner_user_id` = the existing admin (lowest-id admin), add an `org_members`
   Owner row.
2. Create a default Workspace "My Workspace" under it.
3. Add Manager `memberships` for all existing users into that workspace.
4. Copy global `tokens` rows → `social_accounts` under the workspace.
5. Stamp all existing data rows' `workspace_id` with the default workspace id.
6. Set `tenancy_migrated = 1`.

Existing single-user installs keep working with zero data loss; the user lands in
their default workspace automatically.

### API surface (new/changed routes)

```
GET  /me/workspaces                 -> orgs + workspaces + my role in each
POST /session/active-workspace      -> { workspaceId } set active in session
GET/POST          /orgs             -> create/list orgs (Owner)
GET/POST/PATCH/DEL /workspaces       -> manage workspaces (Owner/Admin)
GET/POST/PATCH/DEL /workspaces/:id/members  -> manage members (Manager)
POST /invitations  /  POST /invitations/:token/accept
GET/POST/DELETE    /social-accounts  -> per active workspace
```
Existing protected `/api/*` routes gain `withWorkspace` and, where they mutate,
`requirePermission(...)`.

### UI surface

- **Workspace switcher** in the dashboard header (lists my workspaces grouped by
  org; switching calls `/session/active-workspace` and reloads scoped data).
- **Members & roles** settings page (invite by email, assign/change role, remove).
- **Invitation accept** page (`/invite/:token`) — register or log in, then join.
- **Social accounts** settings updated to show per-workspace accounts and allow
  connecting multiple per platform.

## Error handling

- Non-member or wrong role → `403 { error, requiredPermission }`.
- No active workspace in session → resolve to the caller's first workspace; if
  none, prompt to create one.
- Invitation expired/invalid → clear message; resend supported.
- Migration failures are caught, logged, and do not crash startup; flag stays
  unset so it retries next launch.

## Testing

- **Unit:** `can(role, action)` matrix (every cell); scoped-query helpers return
  only the given workspace's rows (no cross-tenant leakage).
- **Migration:** seed a legacy DB (users + global tokens + posts), run migration,
  assert org/workspace/membership created and all rows stamped + tokens copied,
  and that re-running is a no-op.
- **Integration:** invite → accept → role-gated action (Creator can submit but not
  publish; Manager can publish; Client can approve but not edit).
- **Isolation:** two workspaces, confirm one cannot read/mutate the other's data.
- **Both backends:** the unit/integration suite runs against **SQLite and
  Postgres** (CI matrix) so the shared query layer behaves identically on each.

## Success criteria

- A company can create an org, multiple client workspaces, invite teammates with
  distinct roles, and connect multiple social accounts per platform per workspace.
- All `/api/*` data is workspace-scoped; no cross-workspace leakage.
- Existing installs migrate automatically with no data loss.
- Permission checks are centralized and unit-tested.
- The same codebase runs on **SQLite (desktop)** and **PostgreSQL (cloud)** via
  config, with the test suite green on both — the cloud edition can scale out to
  100+ concurrent users (stateless API + Postgres pool; clustering/queue land in
  later phases).
