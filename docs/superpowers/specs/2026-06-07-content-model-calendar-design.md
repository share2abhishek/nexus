# NEXUS — Unified Content Model & Calendar (Phase 1b)

**Date:** 2026-06-07
**Status:** Approved (ready for implementation plan)
**Part of:** Phase 1 Foundation of the agentic one-stop marketing platform roadmap.
**Depends on:** [Phase 1a — Workspaces, RBAC & Multi-Account Tenancy](2026-06-06-workspaces-rbac-tenancy-design.md) (workspaces, memberships, RBAC `can(role, action)`, `social_accounts`).
**Next spec (1c):** Approval workflow automation / scheduler integration refinements.

## Goal

Replace NEXUS's "fire and forget" Quick Post / Scheduled Post split with a single
**content lifecycle** that supports drafting, review, approval, scheduling, and
publishing — the backbone every team workflow (draft → review → approval →
scheduled publish, with `creator`/`reviewer`/`client`/`manager` roles gated by
Phase 1a's RBAC) builds on. Add a **calendar** that shows all content across every stage,
not just what's already scheduled. Add an **AI Assist panel** that can use a local
Ollama model (free, private) with automatic fallback to cloud models.

## Problem with today's model

- `posts` (Quick Post history) and `scheduled_posts` (calendar) are two unrelated
  tables with no shared lifecycle — a post is either "fired immediately" or
  "scheduled," with no draft, review, or approval step in between.
- There is no concept of content ownership beyond `user_id` — no reviewer,
  approver, or audit trail of who changed what.
- The existing calendar (`public/app.js` `renderCalendar()`) only shows
  `scheduled_posts` rows; drafts and in-review content are invisible until they're
  scheduled.
- AI generation (`services/aiHelper.js` `aiGenerate()`) is wired for ad-hoc
  multi-model routing but has no place in the compose/review flow, and no local
  (Ollama) option.

## Scope

**In scope (1b):**
- New `content_items` table + repo + routes implementing a 6-state lifecycle
  (`draft → in_review → approved → scheduled → published`, plus `failed`).
- RBAC-gated state transitions reusing Phase 1a's `can(role, action)`.
- `services/aiAssist.js` — AI Assist actions (generate, rewrite, shorten,
  hashtags, platform variants) with Ollama-first / cloud-fallback model routing.
- AI Assist panel in the content editor UI, available at every lifecycle stage.
- Calendar UI rebuilt to read from `content_items` (all states, color-coded),
  with three toggleable views (month / week / agenda list; week is default).
- Scheduler (`services/scheduler.js`) extended to also process due
  `content_items` rows (status `scheduled` → `published`/`failed`).

**Out of scope (later specs):** Migrating existing `posts`/`scheduled_posts` rows
into `content_items` (explicitly rejected — see "Quick Post stays separate"
below); approval workflow automation/notifications beyond status + RBAC gating;
analytics on published content; MCP connectors; agents.

## Quick Post stays separate (no legacy migration)

Quick Post (the existing "write & post now" flow backed by `posts`) remains a
**separate shortcut** alongside the new content lifecycle — two entry points for
two needs: Quick Post for "post this right now," the content lifecycle for
"plan, review, schedule." Concretely:

- Quick Post continues to write to `posts` and appears in Post History exactly as
  it does today. No changes to `repos/postsRepo.js` or its table.
- Existing rows in `scheduled_posts` are left in place; the existing scheduler
  loop keeps polling and publishing them via `scheduledRepo.getDue()` until that
  table is empty (it will naturally drain as those posts fire or get cancelled).
- All **new** scheduled content is created through `content_items` (status
  `scheduled`), processed by the extended scheduler.
- There is **no migration script** and no `content_migrated` flag — this is a
  fresh start for the new table. This keeps the two flows cleanly separated and
  avoids the complexity of reconciling two different status/result shapes.

## Architecture

### Data model — `content_items` table

New Knex migration `db/migrations/20260607000001_content_items.js`:

| Column | Type | Notes |
|---|---|---|
| `id` | `increments` | PK |
| `workspace_id` | `integer`, FK → `workspaces.id`, indexed, not null | tenant isolation (Phase 1a pattern) |
| `title` | `text` | short label shown on calendar/list cards |
| `body` | `text`, not null | the post content/copy |
| `platforms` | `text` (JSON array, e.g. `["twitter","linkedin"]`) | parsed in app code, mirrors `posts.platforms` |
| `image_url` | `text`, nullable | optional media attachment |
| `social_account_ids` | `text` (JSON array of `social_accounts.id`) | which connected accounts to publish through |
| `status` | `text`, not null, default `'draft'` | one of: `draft`, `in_review`, `approved`, `scheduled`, `published`, `failed` |
| `scheduled_at` | `integer` (epoch seconds), nullable | when to publish; required to enter `scheduled` |
| `published_at` | `integer` (epoch seconds), nullable | set when status becomes `published` |
| `submitted_by` | `integer`, FK → `users.id`, nullable | who created/submitted the draft |
| `reviewed_by` | `integer`, FK → `users.id`, nullable | who moved it to `in_review`/commented |
| `approved_by` | `integer`, FK → `users.id`, nullable | who approved it |
| `error_message` | `text`, nullable | populated when status becomes `failed` |
| `created_at` | `integer` (epoch seconds), not null | |
| `updated_at` | `integer` (epoch seconds), not null | |

This follows the Phase 1a portability rules: `increments()` ids, epoch-second
integer timestamps, `text` for JSON payloads parsed in app code, no DB-specific
raw SQL.

### State machine

Forward (happy) path:

```
draft ──submit──> in_review ──approve──> approved ──schedule──> scheduled ──(scheduler fires)──> published
```

Backward / exception edges (each listed with its destination — see the
transition table below for the exact permission on each edge):

- `in_review` **reject** → `draft`
- `approved` **reject** (unapprove) → `draft`
- `scheduled` **cancel** → `approved` (NOT back to `draft` — scheduling is the
  only edge that "pauses" rather than "rejects"; the approved copy is preserved)
- `scheduled` **publish failure** (automatic) → `failed`
- `failed` **edit & resubmit** → `draft` (manual, by anyone with `content.edit`)


| # | Transition | From → To | Required permission | Notes |
|---|---|---|---|---|
| 1 | Create draft | (none) → `draft` | `content.create` | sets `submitted_by` |
| 2 | Edit | `draft`/`in_review`/`failed` → same | `content.edit` | updates `body`/`platforms`/`scheduled_at`/etc., bumps `updated_at`; editing a `failed` item moves it back to `draft` (see transition 11) |
| 3 | Submit for review | `draft` → `in_review` | `content.submit` | sets `reviewed_by = null` (awaiting reviewer) |
| 4 | Reject (back to draft) | `in_review` → `draft` | `content.approve` | clears `reviewed_by`/`approved_by`; per the `MATRIX` in `services/rbac.js`, only `reviewer`, `client`, and `manager` roles hold `content.approve`, so only they can reject; comment recorded via `content.comment` |
| 5 | Approve | `in_review` → `approved` | `content.approve` | sets `approved_by` |
| 6 | Reject after approval | `approved` → `draft` | `content.approve` | rare "unapprove" path, same permission as approve |
| 7 | Schedule | `approved` → `scheduled` | `content.schedule` | requires `scheduled_at` to be set and in the future |
| 8 | Cancel schedule | `scheduled` → `approved` | `content.schedule` | clears `scheduled_at` |
| 9 | Publish (automatic) | `scheduled` → `published` | system (scheduler) | sets `published_at`, calls existing publish pipeline per platform |
| 10 | Publish failure (automatic) | `scheduled` → `failed` | system (scheduler) | sets `error_message`; item then sits in `failed` until edited (transition 11) |
| 11 | Edit & resubmit a failed item | `failed` → `draft` | `content.edit` | same edit endpoint as transition 2; moving a `failed` item resets `error_message` to `null` and returns it to `draft` so it can re-enter the lifecycle from the top |
| — | Comment | any state | `content.comment` | comments are not a state transition; stored alongside the item (see "Comments" below) |
| — | View | any state | `content.view` | read access gating for list/detail/calendar endpoints |

All transition checks reuse Phase 1a's `can(role, action)` helper and the
`requirePermission(action)` middleware factory — no new RBAC machinery.

**Note on `content.publish`:** the Phase 1a `MATRIX` already grants `manager`
the `content.publish` permission, but this spec's only path to `published` is
the automatic scheduler-driven transition 9 (no user-triggered "publish now").
`content.publish` therefore stays unused by 1b's lifecycle — it remains
reserved in the matrix for a possible future "publish immediately" capability
(out of scope here; Quick Post already serves that need outside the lifecycle).

**Comments:** kept minimal for 1b — a `content_item_comments` table
(`id, content_item_id, workspace_id, user_id, body, created_at`) gated by
`content.comment`/`content.view`. Comments thread on the content item's detail
panel; they don't change `status`.

### Repository — `repos/contentRepo.js`

Factory module `module.exports = (knex) => ({...})` following the
`postsRepo`/`scheduledRepo`/`socialAccountsRepo` pattern, all methods scoped by
`workspace_id`:

- `create(workspaceId, userId, data)` → insert with `status: 'draft'`
- `list(workspaceId, { status, from, to })` → filtered list (calendar queries pass `from`/`to` as epoch ranges over `scheduled_at` OR `created_at` depending on view)
- `getById(workspaceId, id)`
- `update(workspaceId, id, data)` → partial update + `updated_at` bump
- `transition(workspaceId, id, { toStatus, userId, fields })` → validates the
  transition is one of the rules above (defense in depth; routes also check
  permissions) and writes status + relevant `*_by`/`*_at` columns atomically
- `remove(workspaceId, id)`
- `getDueForPublish(now)` → cross-workspace query for the scheduler:
  `status = 'scheduled' AND scheduled_at <= now`, mirrors `scheduledRepo.getDue()`
- `markPublished(id, results)` / `markFailed(id, errorMessage)` → scheduler callbacks

### Routes — `routes/content.js`

Factory `module.exports = (knex, withWorkspace, requirePermission) => router`,
mounted at `/api/content`, mirroring `routes/social-accounts.js`:

| Method & path | Permission | Purpose |
|---|---|---|
| `POST /` | `content.create` | create a draft |
| `GET /` | `content.view` | list items (`?status=`, pagination) |
| `GET /calendar` | `content.view` | items in a date range (`?from=&to=&view=month\|week\|agenda`) for calendar rendering |
| `GET /:id` | `content.view` | full detail incl. comments |
| `PATCH /:id` | `content.edit` | edit body/title/platforms/image/scheduled_at |
| `PATCH /:id/status` | varies by transition (checked in handler against the table above) | drive the state machine (`{ toStatus, scheduled_at?, comment? }`) |
| `DELETE /:id` | `content.edit` | delete an item in `draft` or `failed` status only (returns 409 for any other status — use `PATCH /:id/status` to move it back to `draft` first) |
| `POST /:id/ai-assist` | `content.edit` | run an AI Assist action against this item's body (see below) |

`PATCH /:id/status` is the single endpoint for all transitions 3–8 in the table;
the handler looks up the requested `toStatus`, validates it's reachable from the
current status, checks the specific permission for that edge, then calls
`contentRepo.transition(...)`.

### AI Assist — `services/aiAssist.js`

A focused service module exposing one entry point:

```js
async function assist({ action, text, platform, context }) → { text, model, source }
```

- **Actions:** `generate` (brief → full draft), `rewrite` (tone/style change),
  `shorten` (fit platform character limits), `hashtags` (suggest tags),
  `platform_variants` (adapt one draft for multiple platforms at once).
- **Model routing (priority order):**
  1. **Ollama** (`http://localhost:11434`) — if the existing Ollama status
     detection (from the "Ollama Guided Setup" phase, `routes/ollama.js`) reports
     the server is running and a model is pulled, route there first. Free,
     private, no API cost.
  2. **Gemini** — if Ollama is unavailable and a Gemini key is configured.
  3. **Claude** — final fallback if neither of the above is available.
  - This priority order is implemented as a thin wrapper around the existing
    `services/aiHelper.js` `aiGenerate()` multi-model router: `aiAssist` first
    probes Ollama directly, and if that fails/unavailable, delegates to
    `aiGenerate()` (which already knows how to pick between Gemini/Claude).
- **Response shape** includes `source: 'ollama' | 'gemini' | 'claude'` so the UI
  can show which model produced the result.

### AI Assist panel (UI)

A persistent panel attached to the content editor (draft creation, review, and
pre-publish screens alike — available at **every** lifecycle stage per the
user's choice of full coverage):

- Action buttons: Generate · Rewrite · Shorten · Add hashtags · Platform variants
- Each result shows a small model-source badge: 🦙 (Ollama), ✨ (Gemini), 🤖 (Claude)
- "Insert" replaces/append result into the body editor; user can always edit
  AI output before saving — AI never writes directly to a saved/submitted item
- If Ollama is selected as source but not running, the panel surfaces the same
  "Ollama not detected — start it or use cloud model" messaging already
  established by the Ollama Guided Setup status indicator

### Calendar UI

Rebuilt to query `GET /api/content/calendar` (which returns items across all six
statuses, color-coded) instead of only `scheduled_posts`:

- **Three toggleable views** — Month (grid), Week (7-column board), Agenda
  (chronological list grouped by date). **Week is the default** view.
- **Color-coding by status:** `draft` (indigo #6366f1), `in_review` (purple
  #8b5cf6), `approved`/`scheduled` (amber #f59e0b), `published` (green #22c55e),
  `failed` (red).
- **Status filter chips** above the calendar let users show/hide statuses.
- Clicking any item opens a **slide-in detail panel**: full body, platform list,
  status history (`submitted_by`/`reviewed_by`/`approved_by`), comments thread,
  the AI Assist panel, and the relevant transition action button(s) for the
  current user's role (e.g., reviewers see "Approve"/"Reject", schedulers see
  "Schedule").
- A **"New Content"** button opens the same editor in create mode (`status: draft`).
- Quick Post still has its own separate compose box (unchanged); it does not
  appear on this calendar (it posts immediately and shows in Post History).

### Scheduler integration

`services/scheduler.js` gains a second polling branch alongside the existing
`scheduledRepo.getDue()` loop:

```js
const dueContent = await contentRepo.getDueForPublish(now);
for (const item of dueContent) {
  // existing per-platform publish pipeline, parameterized by item.platforms / item.social_account_ids
  // on success: contentRepo.markPublished(item.id, results)
  // on failure: contentRepo.markFailed(item.id, errorMessage)
}
```

Both loops run side by side until `scheduled_posts` drains naturally (see
"Quick Post stays separate"). No shared table, no shared status enum — they are
independent until the legacy table is empty, at which point a future cleanup
spec can retire the old loop.

## Files

### New files

| File | Purpose |
|---|---|
| `db/migrations/20260607000001_content_items.js` | `content_items` + `content_item_comments` tables |
| `repos/contentRepo.js` | workspace-scoped data access + state machine validation |
| `routes/content.js` | `/api/content` REST + lifecycle endpoints |
| `services/aiAssist.js` | Ollama-first/cloud-fallback AI actions |
| `tests/content.repo.test.js` | repo unit tests incl. transition validation, cross-workspace isolation |
| `tests/content.route.test.js` | route tests incl. permission gating per transition |
| `tests/aiAssist.test.js` | model routing/fallback tests (mocked Ollama/cloud responses) |

### Modified files

| File | Change |
|---|---|
| `server/index.js` | mount `routes/content.js` at `/api/content` (factory pattern, same as `social-accounts`) |
| `services/scheduler.js` | add `content_items` due-polling branch (see above) |
| `public/index.html` | calendar view-toggle controls, status filter chips, slide-in detail panel markup, AI Assist panel markup, "New Content" button |
| `public/app.js` | replace `renderCalendar()`'s `scheduled_posts`-only fetch with `/api/content/calendar`; add view-toggle handlers (`switchCalendarView`), detail panel (`openContentDetail`, `transitionContent`), AI Assist wiring (`runAiAssist`), and content editor create/edit flows |

## Testing

- **`tests/content.repo.test.js`** — TDD per Phase 1a convention: create → list →
  transition happy paths; invalid-transition rejection (e.g., `draft` →
  `published` directly); cross-workspace isolation (item in workspace A invisible
  to workspace B); `getDueForPublish` returns only `scheduled` items at/after `now`.
- **`tests/content.route.test.js`** — permission gating per endpoint and per
  role from the `MATRIX` in `services/rbac.js` (e.g., a `creator` gets 403 on
  `PATCH /:id/status` to `approved` since `creator` lacks `content.approve`; a
  `reviewer` gets 403 on `POST /` since `reviewer` lacks `content.create`; a
  `manager` can perform every transition); `DELETE /:id` returns 409 for
  non-`draft`/`failed` statuses.
- **`tests/aiAssist.test.js`** — routing order (Ollama tried first; falls back to
  `aiGenerate()` when Ollama probe fails/unavailable); response includes correct
  `source` tag.
- Existing suites (`tests/social-accounts.route.test.js`,
  `tests/invitations.*`, etc.) continue to pass unchanged — this phase adds a
  new table and routes without touching Phase 1a's schema or RBAC.
- CI matrix from Phase 1a (`test-sqlite` + `test-postgres`) covers the new
  migration on both backends.

## Out of scope / future work

- Migrating `posts`/`scheduled_posts` history into `content_items` (explicitly
  rejected for 1b — see "Quick Post stays separate").
- Notifications/emails on review state changes (future approval-workflow spec).
- Rich analytics on published `content_items` (future analytics spec).
- Bulk actions (multi-select approve/schedule) on the calendar.
