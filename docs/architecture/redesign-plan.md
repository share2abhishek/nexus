# NEXUS Redesign Plan

Goals: one dashboard ("one port") where an **individual** can manage all their social media, with an **agency mode** for marketing teams managing clients. The plan also covers **multiple AI tools working together**, with Ollama as a first-class provider and the user able to switch providers at any time. **Scheduling and email** are configured entirely in the UI.

Status: proposal · Date: 2026-10-23 · Based on branch `feature/phase-1b-content-model-calendar` (including uncommitted changes)

---

## 0. Critical findings (fix first)

| # | Finding | Evidence |
|---|---|---|
| C1 | Legacy global tokens are auto-copied into any empty workspace, so one user's accounts leak into another user's workspace. The copied rows also have `access_token` = null. | `routes/config.js` `/platforms`, `routes/auth.js` `/refresh/:platform`, `services/database.js` `getAllTokens` |
| C2 | The legacy cron scheduler publishes using the global `getToken(platform)`, so it can publish to the wrong tenant's account. | `services/scheduler.js:2,69` |
| C3 | The packaged exe doesn't ship `repos/**`, `db/**` or `knexfile.js`. | `package.json` → `build.files` |
| C4 | There are two databases: `services/database.js` ignores `NEXUS_DATA_DIR`, and no Knex migration creates `users`, `user_settings`, `invite_codes` or `platform_config`. | `services/database.js:5`, `config/db.js` |
| C5 | The OAuth `state` is a fixed string, so there is no CSRF protection and no way to bind the callback to a workspace. | `routes/auth.js:79,140,224…` |
| C6 | `/ollama/*` is mounted without auth and writes `.env`. `routes/config.js` writes `.env` inside the read-only asar. | `server/index.js:71` |
| C7 | The Facebook scope dropped `instagram_content_publish`. The code also auto-picks `pages[0]` and falls back to the deprecated `/me/feed`. | `routes/auth.js:139`, `services/social.js:44` |
| C8 | Composer AI (`services/aiAssist.js`) ignores the user's keys and Ollama settings. | `assist()` → `aiGenerate(prompt, apiKey)` |
| C9 | The `getSettings` / `brandKitRepo.get` `|| {}` operator-precedence bug, Math.random invite codes, the first-admin race, async middleware without error handling, migration errors being swallowed, and fake random analytics. | various |

---

## 1. Target architecture

```
Electron shell ──spawns──> Node process (server/index.js)  — ONE port serves everything
                              │
 public/ SPA (vanilla ES modules) ──HTTP/SSE──┤ Express API (routes/* thin controllers)
 public/portal.html (client approvals)        │  middleware: session, csrf, auth, tenancy, rateLimit, asyncHandler
                                              │ services/
                                              │  ├─ ai/         AI Gateway: registry, resolver, fallback, pipelines, usage
                                              │  ├─ publish/    per-platform adapters + token refresher
                                              │  ├─ scheduler/  jobs table + worker (inline on desktop, separate in cloud)
                                              │  ├─ email/      provider adapters + batch sender (via jobs)
                                              │  ├─ secrets/    AES-256-GCM envelope encryption
                                              │  ├─ calendar/   DB-backed holidays/events, tz-aware
                                              │  └─ audit/
                                              │ repos/* — Knex only, every method scoped by workspaceId
                                              └ Knex → SQLite (desktop, NEXUS_DATA_DIR) | Postgres (cloud)
```

| Keep (refactor) | Replace | Remove |
|---|---|---|
| Knex, `config/db.js`, `repos/*` factory pattern | `services/database.js` → one-time `services/legacyImport.js` | Legacy cron path in `scheduler.start()` |
| `middleware/tenancy.js`, `services/rbac.js` (extend) | `aiHelper.aiGenerate` if-chain → `services/ai/*` (keep `withOllamaQueue`) | `scheduled_posts` writes (migrated into content) |
| `contentRepo` `TRANSITIONS` state machine | `services/scheduler.js` → jobs worker | Runtime `.env` writes from routes |
| `routes/content.js`, comments | `services/social.js` switch → `services/publish/<platform>.js` | Auto-copy of legacy tokens |
| `electron/main.js` spawn + `DATA_DIR` | Blocking email send loop → `services/email/*` + jobs | In-memory `recurringDb`, random analytics |
| | `services/indianHolidays.js` static list → `calendar_events` table | |

---

## 2. Tenancy & roles: one product, two modes

- **Personal mode** (`organizations.kind='personal'`): one org and one workspace, and the user is the owner. The UI hides Clients, Team, Approvals and Portal. "Upgrade to agency" flips `kind`, and no data moves.
- **Agency mode** (`kind='agency'`): each **client is a workspace**. Org owners and admins have admin rights on every workspace. All other roles are per workspace.
- The SPA sends `X-Workspace-Id` on every request, and `withWorkspace` validates membership. The session value is only the default, so two tabs can work on two different clients.

| Permission | org owner | org admin | ws admin | editor | approver | viewer | client_approver |
|---|---|---|---|---|---|---|---|
| billing / delete org | ✓ | | | | | | |
| org members / create workspaces | ✓ | ✓ | | | | | |
| workspace settings (AI, email, scheduling) | ✓ | ✓ | ✓ | | | | |
| connect / disconnect social | ✓ | ✓ | ✓ | | | | |
| manage workspace members | ✓ | ✓ | ✓ | | | | |
| create / edit / submit content | ✓ | ✓ | ✓ | ✓ | | | |
| internal approve | ✓ | ✓ | ✓ | | ✓ | | |
| client approve | | | | | | | ✓ (portal) |
| schedule / publish | ✓ | ✓ | ✓ | if `editors_can_schedule` | | | |
| comment | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| view analytics | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | own ws |
| use AI | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| send email campaigns | ✓ | ✓ | ✓ | | | | |

Role migration: manager→admin, creator→editor, reviewer→approver, analyst→viewer, client→client_approver.

**Approval flow:** `draft → in_review → approved | changes_requested → [client_review → client_approved] → scheduled → publishing → published | partially_published | failed`. Each workspace sets `approval_policy`: `none` (the personal default), `internal`, or `internal+client`.

**Client portal:** a magic link (`portal_links` with a hashed token and an expiry) opens `/portal/:token`. It shows per-platform previews, Approve / Request changes, and comments.

---

## 3. Data model (single Knex schema)

Conventions: epoch `bigint` timestamps; every tenant table has `workspace_id` with an index; columns ending in `*_enc` hold envelope-encrypted values.

| Table | Key columns |
|---|---|
| users | email (unique), password_hash, name, is_super_admin, status, last_active_at |
| user_settings | user_id PK, ui_prefs, language_pref, timezone (Asia/Kolkata). AI keys move out of this table. |
| organizations | name, kind (personal/agency), owner_user_id, plan, settings |
| org_members | org_id, user_id, role |
| workspaces | org_id, name, slug, timezone, locale, approval_policy, settings, archived_at |
| memberships | user_id, workspace_id, role, status |
| invitations / invite_codes | token/code **hashed**, generated with `crypto.randomBytes` |
| app_config | replaces platform_config (registration_mode, app_name, first_admin_claimed, flags) |
| portal_links | workspace_id, token_hash, content_item_id, expires_at |
| oauth_apps | scope (global/org), platform, client_id, client_secret_enc, redirect_uri. Replaces the `.env` client IDs. |
| oauth_states | state, user_id, workspace_id, platform, code_verifier_enc, expires_at |
| social_accounts | workspace_id, platform, external_id, kind (profile/page/ig_business/board/channel), parent_account_id, tokens_enc, expires_at, scopes, status (active/needs_reauth/revoked) |
| content_items | workspace_id, title, base_body, media, status, campaign_id, created_by, approved_by, client_approved_by, version |
| content_variants | content_item_id, social_account_id, platform, body, media, first_comment, options, status, scheduled_at (UTC), published_at, external_post_id, permalink, error |
| content_revisions / content_item_comments | snapshots; comments with variant_id and is_client |
| media_assets | workspace_id, path, mime, size, source (upload/ai) |
| queue_slots | workspace_id, social_account_id?, weekday, local_time HH:MM, enabled |
| schedule_settings | workspace_id PK, timezone, max_retries, backoff_base_sec, failure_policy, blackout_dates, min_gap_minutes |
| recurring_rules | workspace_id, template content_item_id, rrule, tz, next_run_at |
| jobs | type (publish/token_refresh/email_batch/analytics_pull/ai_pipeline/recurring_expand), workspace_id, payload, run_at, priority, status, attempts, max_attempts, locked_by, locked_until, **idempotency_key unique**, last_error |
| publish_attempts | variant_id, job_id, attempt_no, ok, http_status, error, response |
| ai_providers | seeded registry: key, modality, default base_url |
| ai_credentials | scope_type (user/workspace/org), scope_id, provider_key, secret_enc, base_url, enabled, last_health |
| ai_preferences | scope_type, scope_id, task (default/caption/hashtags/translate/image/video), provider, model, params, fallback_chain |
| ai_pipelines | workspace_id (null = built-in), name, steps json |
| ai_runs | workspace_id, user_id, provider, model, tokens, latency_ms, cost_est, status, fallback_from (replaces `history`) |
| ai_model_prices | provider, model, in_per_1k, out_per_1k |
| email_providers | workspace_id/org_id, kind (smtp/gmail/sendgrid/resend/ses), config_enc, from_name, from_email, reply_to, verified_at, daily_limit |
| email_lists / email_list_members | lists with a double_opt_in flag |
| email_subscribers | workspace_id, email, attrs, status, unsub_token; **unique(ws,email)** |
| email_campaigns / email_sends | campaign, plus a per-recipient send row with unique(campaign,subscriber) |
| calendar_events | scope, region (IN, IN-MH…), local date, name, type, emoji, source, year |
| analytics_snapshots | variant_id, fetched_at, metrics (real API data only) |
| audit_log, notifications | |

**Migration strategy**

1. `20261101000001_baseline.js` creates every table if it doesn't already exist, including users and the related tables, so a fresh SQLite or Postgres database never depends on `database.js`.
2. `20261101000002_reshape.js`:
   - adds the new columns and renames the roles
   - turns `content_items.platforms` into `content_variants`
   - turns pending `scheduled_posts` into variants
   - moves `user_settings.*_key` into encrypted `ai_credentials`
3. `services/legacyImport.js` runs once (guarded by `app_config.legacy_import_v2`).
   - It imports the old `data/nexus.db` read-only.
   - Tokens go **only** into the first admin's personal workspace.
   - When it finishes, it renames the old file to `.bak`.
4. Before migrating, make an automatic backup to `DATA_DIR/backups/`. `bootstrap()` **fails hard** if a migration fails.

---

## 4. AI Gateway: multiple tools working together, Ollama first

**Files**
- `services/ai/{index,registry,resolve,pipelines,usage}.js`
- `services/ai/providers/{ollama,gemini,anthropic,openai,openaiCompatible(groq|openrouter|mistral),stability,dalle,luma,runway}.js`

**Provider interface**

```
{ key, modality, needsKey,
  listModels(cred), health(cred),
  generate(cred, {messages, system, model, maxTokens, temperature, json}) -> {text, usage, model},
  stream(cred, req) -> AsyncIterable<{delta}|{done, usage}> }
```

**Which provider and model are used.** The first match wins:

1. Per-request override from the composer switcher (`body.ai = {provider, model}` or a pipelineId)
2. The workspace preference for the task, then the workspace default
3. The user preference for the task, then the user default
4. The org default
5. Built-in: Ollama if it's healthy, otherwise the first provider that has a credential

**Which key is used.** Keys are looked up workspace → org → user → env, where env is the dev fallback only. In agency mode, a client's work bills the client's key. `allow_personal_keys` is off by default.

**Fallback chain.** Each scope has its own chain, which the user can reorder by drag-and-drop.

- **Triggers:** a network error, 429, 5xx, timeout, or Ollama being offline. Validation errors (4xx) don't trigger it.
- **Response:** `{text, provider, model, fellBackFrom: [...]}`, so the UI can say "Ollama offline → used Groq".

**Pipelines.** Steps run in sequence, or in parallel when they share the same input.

| Built-in pipeline | Steps |
|---|---|
| Draft local → polish cloud | Ollama draft → Claude/Gemini polish |
| Caption + hashtags | model A writes the caption, model B writes hashtags, in parallel |
| Translate | base text → Hindi / Marathi / Tamil / … |
| Per-platform variants | one step per selected account, writing into `content_variants` |
| Compare | 2–3 models side by side, with a "Use this" button |

Prompt templates use `{{brand_voice}}`, `{{platform}}` and `{{input}}`, filled from the brand kit. The `PROMPTS` in `aiAssist.js` become the built-in templates.

**Ollama specifics**
- **Models:** `/api/tags` lists models, `/api/version` reports health, `/api/pull` pulls a model (streamed to the UI as SSE with a progress bar), and `/api/delete` removes one.
- **Generation:** streaming `/api/chat`, with configurable `keep_alive` (default 30m; 0 unloads the model) and `num_ctx` / `num_predict`.
- **Queue:** `withOllamaQueue` runs per base URL with configurable concurrency (1–2). The queue depth appears in health ("2 waiting").
- **Setup:** the default URL is `http://127.0.0.1:11434`, stored per credential. In the cloud the URL is allow-listed to prevent SSRF. `recommendModel()` drives the first-run wizard.

**Usage:** every call writes an `ai_runs` row. Cost is tokens × price, and Ollama is always $0. An optional monthly budget per workspace acts as a soft block.

**API**
- `GET /api/ai/providers` (health and models)
- `POST /api/ai/credentials`
- `PUT /api/ai/preferences`
- `POST /api/ai/generate`, `POST /api/ai/stream` (SSE), `POST /api/ai/compare`
- `GET|POST /api/ai/pipelines`, `POST /api/ai/pipelines/:id/run`
- `GET /api/ai/usage`

All existing generators (api, seo, tools, email, media) switch to `ai.run(req.aiCtx, {task, prompt, override})`. `injectUserKeys` is replaced by an `aiContext` middleware. `aiHelper.aiGenerate` stays as a shim during the transition.

---

## 5. Scheduler & publishing

- **Enqueue:** scheduling a variant inserts `jobs(type='publish', run_at, idempotency_key='publish:<variant>:v<version>')`. Rescheduling updates or cancels the job in the same transaction.
- **Worker** (`services/scheduler/worker.js`): polls every 15 s.
  - Postgres: `FOR UPDATE SKIP LOCKED`, so multiple instances are safe.
  - SQLite: `BEGIN IMMEDIATE` plus `UPDATE … RETURNING`.
  - A reaper requeues jobs whose lock has expired.
- **Publish handler:**
  1. Load the variant and its account, scoped by workspace.
  2. Refresh the token if it expires within 10 minutes. If refresh fails, mark the account `needs_reauth`, fail without retrying, and notify.
  3. Publish and record a `publish_attempts` row.
  4. Never republish when an `external_post_id` already exists.
  5. Use exponential backoff with jitter up to `max_retries`, then mark the job `dead` and the variant `failed`, and apply `failure_policy`.
- **Other job types:** `token_refresh` (daily), `email_batch`, `analytics_pull` (24 h / 72 h / 7 d), `recurring_expand` (materialises posts 14 days ahead).
- **Timezones:** everything is stored as UTC epoch. The UI sends local time plus the workspace timezone, and **Luxon** converts it. Queue slots are stored as local weekday + HH:MM. The default is Asia/Kolkata.
- **Holidays:** the `calendar_events` seed for 2026–2027 must be **verified against an official gazetted list**. Users can edit it, import ICS, and toggle regions. "Today" is calculated in the workspace timezone.
- **Best time:** a heuristic based on real engagement once there are 10 or more data points per account; before that, India defaults. It replaces the LLM-only `/tools/best-times`.
- **Publishers** (`services/publish/*.js`): each implements `{connect, refresh, publish, validate, findRecent?}`.
  - Facebook: restore `instagram_content_publish`, add a **page picker**, and remove the `pages[0]` and `/me/feed` fallbacks. The Graph version is set in one constant.
  - LinkedIn: move to OpenID plus the `/rest/posts` API.
  - X: OAuth2 with PKCE.

---

## 6. Email (configured in the UI)

- **Providers** (`services/email/providers/{smtp,sendgrid,resend,ses}.js`), each implementing `send`, `verify` and `limits`.
  - SMTP uses nodemailer (already a dependency).
  - Gmail uses SMTP with an App Password; Gmail OAuth comes later.
  - SendGrid and Resend use their HTTPS APIs.
  - SES uses SMTP first.
- **Settings:** encrypted `config_enc`, a sender identity (name, from, reply-to) per workspace with an org fallback, and a daily limit.
- **Test send:** `POST /api/email/providers/:id/test` runs `verify()` and then sends one message. The result is shown inline and `verified_at` is set.
- **Campaign send:** creates `email_sends` rows (idempotent) and queues `email_batch` jobs of about 50 each, throttled by the daily limit. A send interrupted by a restart resumes without duplicates.
- **Compliance:** `List-Unsubscribe` header, a public `/e/unsub/:token` route, a physical-address footer, double opt-in per list, and DPDP consent capture.
- **Removed:** `/api/config/smtp` and the `.env` SMTP variables. `.env` stays as a dev fallback only.

---

## 7. UI information architecture

**Keep vanilla JS, with no framework migration.** Split the 4,363-line `public/app.js` into native ES modules (`<script type="module">`, no build step):
- `public/js/core/` for api (adds `X-Workspace-Id`, CSRF and SSE handling), state, router and dom helpers
- `public/js/pages/*` with one file per page
- `public/js/components/*` for modelSwitcher, accountPicker, calendarGrid, slotEditor and toast

Migrate one page per PR, and write all new screens as modules from the start.

```
[Client switcher ▾]        (personal mode: shows brand name only)
Home       – today's queue, failures, approvals waiting, account health, AI health
Compose    – composer
Calendar   – month/week/list, drag to reschedule, holiday overlay, filters
Queue      – per-account time slots, paused accounts, failed posts (retry/edit)
Approvals  – (agency) internal + client review board
Analytics
Email      – campaigns, lists, subscribers
Toolkit ▸  – SEO, ASO, Ad copy, Hashtags, UTM, Media studio, Templates, Brand kit
Clients    – (agency) workspaces, create client, portal links
Settings ▸ – Profile · Workspace · Social accounts · AI providers · Email · Scheduling · Team & roles · Usage · Admin
```

**Composer:** base text with a tab per account (character counter and warnings from `adapter.validate`) and a media tray.

The **AI panel** contains:
- a model switcher chip such as `Ollama · llama3.2:3b ▾`, listing providers grouped with a health dot
- actions: Generate, Rewrite, Shorten, Hashtags, Translate, Variants
- a pipeline picker and a Compare toggle
- streaming output, with the provider used, any fallback notice, and the cost

Footer: Save draft / Submit for review / Schedule (next free slot and best-time hints) / Post now.

**Settings → AI providers:** one card per provider with key status, a Test button, its models, and a scope selector (this workspace / me / whole org). Also a drag-sortable fallback chain and per-task defaults.

The **Ollama card** adds:
- the URL and health
- installed models with their sizes
- Pull (with a progress bar) and Delete
- keep_alive and concurrency settings

**Settings → Scheduling:** timezone, a weekly slot grid per account, minimum gap, retries and backoff, failure policy, blackout dates, holiday regions.

**Settings → Email:** provider picker with a dynamic form, sender identity, Test send, daily limit.

---

## 8. Security

- **Encryption at rest** (`services/secrets/crypto.js`): AES-256-GCM envelope encryption, stored as `v1:kid:iv:tag:ct`.
  - Desktop: a master key generated on first run and protected with Electron `safeStorage` (Windows DPAPI).
  - Cloud: the `NEXUS_MASTER_KEY` env variable or a secret manager.
  - Rotation via `kid` and a `scripts/rotate-key.js` script.
  - The API never returns secrets, only masked values.
- **OAuth:** a random, single-use `state` with a 10-minute TTL, bound to user, workspace and platform, plus PKCE. OAuth app secrets are stored encrypted in the DB.
- **Sessions:**
  - `SESSION_SECRET` is required in production.
  - `session.regenerate` on login.
  - Cookies use `httpOnly` and `sameSite=lax`, plus `secure` behind HTTPS.
  - Desktop binds to `127.0.0.1`, and CORS uses an allow-list.
- **CSRF:** a double-submit token. **Rate limits** (`express-rate-limit`): login 10 per 15 min, AI 60 per min, test-send 5 per min.
- **Error handling:** `express-async-errors`, and no `err.message` leaks in production.
- **Tokens and first admin:** `crypto.randomBytes` for invite codes and tokens, stored hashed. The first-admin claim is transactional.
- **Lockdown:** `/ollama/*` requires auth, routes no longer write `.env` at runtime, and URLs are SSRF-guarded in the cloud.
- **Audit log:** logins, role changes, credential changes, connects and disconnects, approvals, publishes, and campaign sends.

---

## 9. Phased roadmap

| Phase | Scope | Acceptance criteria |
|---|---|---|
| **0. Stabilise** (~1 wk, 2.0.x patch) | Fix C1–C9:<br>• add `repos/** db/** knexfile.js` to `build.files`<br>• delete the auto-copy of legacy tokens<br>• remove the legacy cron publish<br>• `media.js` history → `historyRepo`<br>• FB scope, page picker, remove the fallbacks<br>• auth on `/ollama`<br>• `ENV_PATH` → `DOTENV_CONFIG_PATH`<br>• `aiAssist` passes user options<br>• express-async-errors<br>• crypto invite codes and transactional first admin<br>• random OAuth state<br>• hard-fail migrations<br>• stop the fake analytics<br>• IST "today" and corrected holidays | User B never sees A's tokens (isolation test). The exe boots on an empty `NEXUS_DATA_DIR`. FB connect asks which page to use. Jest passes. |
| **1. Single schema** (1–2 wk) | Baseline and reshape migrations, `legacyImport.js`, delete `services/database.js`, `platform_config` → `app_config`, pg test target | `DB_CLIENT=pg` works on an empty DB. An old DB imports exactly once. better-sqlite3 is only used in the importer. |
| **2. Security + tenancy v2** (1–2 wk) | Secrets encryption, safeStorage, `oauth_states` + PKCE, CSRF, rate limits, CORS, `X-Workspace-Id`, the new RBAC matrix, personal/agency modes, audit log | No plaintext secrets in the DB. A forged OAuth callback is rejected. RBAC tests pass. Personal mode hides agency navigation. |
| **3. AI Gateway** (~2 wk) | `services/ai/**`, `routes/ai.js` (absorbs the Ollama routes), credentials, preferences and runs repos, aiHelper shim, `aiContext` middleware, UI for AI Providers + model switcher + streaming | Provider can be switched globally, per workspace and per request. Ollama down → falls back and the UI says so. Model pull shows progress. Usage is recorded. Compare shows 2 models. |
| **4. Variants + scheduler** (2–3 wk) | `content_variants`, jobs, attempts, queue slots, schedule settings, recurring rules; worker and handlers; `services/publish/*`; retire `/api/post/*` and `/tools/recurring`; Luxon; UI for Queue, Scheduling settings, calendar drag-and-drop, failed-post retry; `calendar_events` | 10:00 IST publishes at 04:30 UTC. A killed worker causes no double post. Two pg workers never take the same job. An expired token is refreshed first or marked needs_reauth. Retries follow the configured backoff. |
| **5. Agency workflow** (1–2 wk) | Extended transitions, portal links + `portal.html`, revisions, notifications, Approvals board, Clients page | `internal+client` blocks scheduling until the client approves via the magic link. Every decision is audited. |
| **6. Email** (1–2 wk) | `services/email/**`, providers and lists migrations, `email_batch` jobs, unsubscribe, Settings → Email + lists | Test send works for Gmail SMTP, SendGrid, Resend and SES. A 500-recipient campaign sends in throttled batches and resumes after a restart without duplicates. Unsubscribe works. |
| **7. Ongoing** | Real analytics pulls, data-driven best time, pipeline editor, image/video providers under the gateway, finish the SPA module split, unified inbox | — |

---

## 10. Risks & open questions

**Risks**
1. **Platform app review.** Meta (`instagram_content_publish`), LinkedIn Community Management, TikTok and X paid tiers can take longer to approve than the code takes to build.
2. **Migrating real user databases.** Mitigated by backups, an importer dry-run mode and idempotency.
3. **SQLite contention** between the worker and the API. Mitigated by WAL, short transactions and `busy_timeout`.
4. **Desktop and cloud drifting apart.** Mitigated by a single `config/runtime.js` with `NEXUS_MODE=desktop|cloud`.
5. **Holiday date accuracy.** Lunar dates must be sourced, not guessed.
6. **The 4k-line SPA slows every phase.** Start the module split early.

**Decided (2026-10-23)**
- **Desktop first.** Local Electron install. SQLite is the primary target; Postgres and multi-worker support are deferred (keep the code portable, but don't prioritise it).
- **Local users.** Anyone with access to the machine can create an account and log in.
- **Users pay for their own AI keys.** Key resolution is user → workspace → env, and `allow_personal_keys` defaults to on.
- **Ollama is not bundled.** NEXUS detects it, and when it's missing shows install instructions with a link to ollama.com.
- **OAuth developer apps:** each install enters its own app credentials in Settings, stored encrypted in `oauth_apps`. No central secret ships inside the exe. *(This is my reading of "any user who can login"; confirm.)*

**Still open**
3. Can client approvers edit content, or only approve and comment?
6. What email volume is expected? Thousands per day means bounce and complaint webhooks are needed in v1. DPDP consent also needs handling.
7. Should the super-admin `/admin` stay in the desktop build?
8. Are these new dependencies OK: Luxon, express-rate-limit, express-async-errors?
