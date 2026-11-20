# Platform roadmap: access, roles, entitlements, usage limits and billing (one order)

This is the single build order for four documents:

| Document | Owns |
|---|---|
| `docs/billing/REQUIREMENTS.md` | money: plans, price book, subscriptions, invoices, payments, wallet, metering, top-ups |
| `docs/billing/ACCESS-REQUIREMENTS.md` | role catalogue and hierarchy, data scope, AI sales agents, teams and routing, plan designer, support mode |
| `docs/billing/PLAN.md` | the Super Admin plan designer, customer billing page, Nexus decisions N1–N8 |
| `docs/platform/ACCESS-AND-ENTITLEMENTS.md` | production findings and safety fixes, tenancy hardening, the full decision order, staff roles and support sessions, AI, storage and count limits, consistency checker, row-level security |

Phase ids follow `PLAN.md` section 7. The phases this roadmap adds are **S0** (safety), **T1** and **T2** (tenancy), **L1** and **L2** (limits) and **P1** (plan change handling).

**Status:** this is a plan only; nothing is built. Skills for the build are in `.claude/skills/`:
- `access-control`
- `tenant-isolation`
- `usage-limits`
- `billing-core`
- `billing-delivery`
- `billing-money-review`

## Principles of the order
1. **Safety first.** S0 removes the path by which a customer can become a global admin, and adds the tests every later phase relies on.
2. **One decision point before new rules.** A0 routes every check through `access.check` and changes nothing for customers.
3. **Isolation before growth.** T1 puts `org_id` on every table and every query before more roles, scopes and modules add data.
4. **Entitlements before money.** The plan decides features and menus (B0, B1) before anyone pays through the new module.
5. **Count before enforcing.** Storage, AI and messages are counted and shown first. They are enforced only after the counts match reality.
6. **Kill switches ship off.** Lockout, storage enforcement, AI enforcement and the feature gate are never switched on in the release that introduces them.
7. **Seeds change nothing.** Seeded plans have every feature on and today's limits (PLAN N5), and seeded roles keep exactly today's permissions.

## Unified order

| # | Phase | Source | Depends on | Size | Visible change on production |
|---|---|---|---|---|---|
| 1 | **S0** Safety net: verify staff accounts on production, stop `ensureAdmin` on the server edition, super admin only on cross-org `/admin/*`, no workspace id from request body, route inventory test, two-org isolation harness (baseline) | access 16 | none | S | none (security fix) |
| 2 | **A0** Access foundation: feature and permission catalogues, menu registry (data), `access.check` with all steps, `GET /api/me/access`, characterization tests (no behaviour change) | PLAN 7, access 16 | S0 | M | none |
| 3 | **T1** Tenancy hardening: `org_id` on every tenant table, scoped repositories, id resolution with 404, jobs, webhooks, caches, files by org; split per module | access 11, 16 | A0 | L | none |
| 4 | **B0** Catalogue and plan designer: billing tables, pure maths, seeder, staff Plans / Prices / Coupons, import of today's organisations as subscriptions (dry run first) | PLAN 7, billing 12 | none (parallel with T1) | M | staff only |
| 5 | **B1** Feature gate and upgrade prompts: API gate from the registry, engine and job checks, menu rendered from `/api/me/menu`, locked items, upgrade dialog, consistency checker (access B1a and B1b) | PLAN 7, access 16 | A0, B0 | M | none until staff remove a feature from a plan |
| 6 | **R1** Roles v2 and support mode: new system roles, data scope, Team & roles screen, agent inbox tabs, `platform_staff` (super_admin), staff MFA, support sessions replacing the silent bypass, org support log, org suspend | ACCESS-REQ 5–6, access 9 | A0, T1 | L | new roles; support banner and log |
| 7 | **S1** Organisation health and staff console: org list with health and usage badges, Org 360, user directory, audit screens, staff roles support / billing_ops / auditor | PLAN 7, access 9.2 | R1 | M | staff only |
| 8 | **B2** Wallet | billing | B0 | M | staff only |
| 9 | **B3** Invoices and offline payments | billing | B2 | M | staff can bill and activate by bank transfer |
| 10 | **B4** Online payment and customer Billing page; retires the old licence-server client (PLAN N1) | billing, PLAN | B3 | M | customers can pay online |
| 11 | **L1** Limits framework and storage: limit catalogue, count limits, `stored_file` registry and files service, org storage counter, upload checks, trash, reconciliation, Usage screen, 80/100% notices (storage **warn-only** for 2 weeks) | access 10, 16 | T1, B1 | M | Usage screen; storage bar |
| 12 | **B5 + P1** Lifecycle, expiry alerts, lockout (switch off), plus plan change handling: impact preview in the plan designer, downgrade rules (features paused, over-limit archiving) | billing, access 7.5 | B4, L1 | M | upgrade, downgrade and cancel; alerts |
| 13 | **R2** Custom roles and teams, routing rules, agent status | ACCESS-REQ 5.7–5.8 | R1, B1 | M | sellable `custom_roles`, `teams_routing` |
| 14 | **R3** AI sales agents | ACCESS-REQ 5.6 | R2 | M | sellable `ai_agents` |
| 15 | **B6** Usage metering (count only) | billing | L1 | M | usage per channel |
| 16 | **B7 + L2** AI credits, top-ups, every AI call metered (reserve / settle / release), org daily, per-user and platform cost caps, BYOK counted not charged, model tiers; enforcement switch off for a month | billing, access 10.2 | B6, R3 | M | AI credits on the Usage tab; buy more |
| 17 | **B8** Reports and add-ons | billing, PLAN | B7 | M | staff only |
| 18 | **T2** Postgres row-level security (optional), audit mode for 2 weeks, then enforce | access 11.3 | T1 complete | S–M | none |

Two pairs share files, so one owner builds both phases in each pair:
- **B1 with A0's registry.**
- **B7 with L2.**

T1 can run in parallel with B0, B2 and B3, because none of them touches tenant tables.

## Milestones

| Milestone | Phases | What the owner can do at the end |
|---|---|---|
| **M1 Safe foundation** | S0, A0 | Nothing visible. Every check runs through one engine; customers can't become admins; tests guard every route. |
| **M2 Isolation** | T1 | Nothing visible. Every row and file carries its organisation; a guessed id from another organisation always answers 404. |
| **M3 Plans and feature control** | B0, B1 | Design plans in Super Admin → Billing by ticking features, and see menus lock and unlock per organisation within a minute. |
| **M4 Roles and oversight** | R1, S1 | Give people sales, support, bot or viewer roles. See every organisation's health, and open one in an audited support session. |
| **M5 Money** | B2, B3, B4 | Record bank and UPI payments that activate a plan; customers pay online (Razorpay, shared with UrbanSociety). |
| **M6 Limits and lifecycle** | L1, B5 + P1 | Customers see their usage and storage. Expiry alerts go out. Upgrades and downgrades work. Lockout is ready (switch off). |
| **M7 Teams and AI agents** | R2, R3 | Custom roles, teams and routing; AI sales agents that hand over to people. |
| **M8 AI credits** | B6, B7 + L2 | Every AI call metered; monthly credits per plan; top-ups; enforcement after a month of counting. |
| **M9 Reports and hardening** | B8, T2 | Revenue and usage reports, add-ons, Postgres row-level security. |

## Phase cards

Each card adds what the specs leave out:
- the owner-visible outcome;
- the switches;
- the owner check (UAT);
- the rollback plan;
- the review needed.

Scope detail is in the cited sections. "Review" names the skill checklist that the reviewing agent applies. It must be a different agent from the author.

### 1. S0 Safety net
- **Outcome:** a customer can never become a global admin. Every route is inventoried, and an isolation baseline exists.
- **Scope:** access 16 (S0). Production was verified on 19 Nov 2026: no customer holds admin.
- **Key deliverables:**
  - `ensureAdmin` is a no-op on the server edition;
  - `requireSuperAdmin` on every cross-organisation `/admin/*` route;
  - `withWorkspace` stops reading the body;
  - `tests/access/routeInventory.test.js`;
  - `tests/access/isolationHarness.test.js` (two organisations, recorded baseline).
- **Switches:** none (a fix).
- **Done when:** access 16 S0.
- **Owner check:**
  - a second test user with `users.role='admin'` cannot list users;
  - you can still do everything as super admin.
- **Rollback:** revert the commit. There is no migration.
- **Review:** `access-control`, `tenant-isolation`.

### 2. A0 Access foundation
- **Outcome:** one engine answers every check, with identical behaviour to today.
- **Scope:** access 5, 6.2 and 16 (A0); ACCESS-REQUIREMENTS 4.1 and 5.3 (catalogues).
- **Key deliverables:**
  - `modules/access/` with `features.js`, `permissions.js`, `menu.js` and `limits.js` (data only), and `services/accessHost.js`;
  - `access.check / assert / middleware / explain / context`;
  - adapter to today's `services/entitlements.js`;
  - every `requirePermission` replaced;
  - `GET /api/me/access`;
  - characterization tests (every old role × action);
  - latency test;
  - the legacy staff bypass logged as `legacy_staff_bypass`.
- **Switches:** none. Behaviour must not change.
- **Owner check:** use the app as owner, a creator and a client of Avinash Group (test users). Everything works as before.
- **Rollback:** revert. A0 adds no tables except the `organizations.status` column (all `active`).
- **Review:** `access-control`.

### 3. T1 Tenancy hardening (one release per module)
- **Outcome:** isolation enforced in data, not just remembered in queries.
- **Scope:** access 11 and 16 (T1).
- **Key deliverables, per module:**
  - an `org_id` migration with backfill, then `NOT NULL` and indexes;
  - `forCtx` repositories;
  - id resolution answering 404;
  - jobs and webhooks on a system ctx;
  - the module's caches keyed by organisation;
  - files moved under `{org_id}/{workspace_id}/`, with a resumable script and a recount.
- **Order:** content, media, leads/CRM/Sellbird, inbox, SEO, e-mail, bio/tools, legacy user tables.
- **Switches:** none per module. The raw-knex lint test is tightened module by module.
- **Owner check:** the isolation harness report shows the baseline shrinking to zero. Decide what to do with the orphan rows the migration lists.
- **Rollback:** each module's migration adds columns only; reverting the code is safe. The `NOT NULL` step is a separate migration after a week.
- **Review:** `tenant-isolation` (mandatory for every module).

### 4. B0 Catalogue and plan designer (parallel with T1)
- **Outcome:** Super Admin → Billing exists, with plans, prices, tax and coupons; plans are data.
- **Scope:** billing 12 (B0); ACCESS-REQUIREMENTS 4.2 (designer, revisions, private plans); PLAN 5.1.
- **Key deliverables:**
  - `db/migrations/*_billing_b0_catalogue.js` (the draft exists, uncommitted; extend it with `bill_plan_revision` and `bill_plan.owner_org_id`);
  - `modules/billing/` domain (the price calculator), repos, services and admin routes;
  - `services/billingHost.js` ports;
  - seeder (every feature on, today's limits, new limits -1);
  - staff screens;
  - `import-subscriptions` script (dry run by default).
- **Switches:** `BILLING_ENABLED` off by default. Switch it on for staff when the owner wants to see the screens; customers see nothing.
- **Owner check:**
  - create a test plan "Ads only", clone it, deactivate it, view its revisions;
  - run the import dry run and compare it with the organisation list.
- **Rollback:** the migration `down` drops only `bill_*` tables.
- **Review:** `billing-money-review` (pricing maths), `access-control`.

### 5. B1 Feature gate and menu
- **Outcome:** plans control features and menus within a minute; upgrade prompts appear.
- **Scope:** access 7, 8 and 16 (B1a, B1b); PLAN 4.1.
- **Key deliverables:**
  - steps 5 and 6 read billing;
  - the overrides screen;
  - `feature_flag` and kill switches;
  - the consistency checker plus the nightly jobs (access 7.4);
  - `GET /api/me/menu`;
  - the sidebar rendered from it, with a cached fallback;
  - the `navigateTo` guard and locked pages;
  - the upgrade sheet;
  - engine checks: bot and AI per channel, website chat, broadcasts, sequences, autopilot, feeds, publishing re-checked at send time;
  - `entitlements.js` as a wrapper with the same shape.
- **Switches:** `FEATURE_GATING_ENABLED` off at release. It is turned on after a week, once the seeded plans are confirmed to keep everything on.
- **Owner check:**
  - on a copy plan, untick `whatsapp_bot_ai` and confirm a test organisation's bot stops AI answers on WhatsApp but not on the website chat;
  - confirm the menu shows a lock and the upgrade sheet.
- **Rollback:** switch off.
- **Review:** `access-control`, `tenant-isolation`.

### 6. R1 Roles v2 and support mode
- **Outcome:** sales, support, bot-designer and viewer roles; data scope; staff in a table with MFA; support sessions instead of silent access.
- **Scope:** ACCESS-REQUIREMENTS 5.1–5.5 and 13; access 6, 9.1, 9.3 and 16 (R1).
- **Key deliverables:**
  - `access_role` and `access_role_permission` (with scope), seeded;
  - `org_members.role_key` and `memberships.role_id`;
  - the scope filters in chats, leads and contacts lists;
  - the Team & roles screen;
  - the agent inbox tabs;
  - `chat_assignment` (migrated from `assigned_to`);
  - `platform_staff` with bootstrap from `PLATFORM_ADMIN_EMAILS`;
  - TOTP for staff;
  - `support_session` with banner, log and owner e-mail;
  - organisation suspend and resume;
  - the Creator compatibility grant (A9).
- **Switches:** `SUPPORT_MODE_REQUIRED` off for one release (the silent bypass still works, logged), then on.
- **Owner check:**
  - invite a Sales agent to Avinash Group's workspace and confirm they see only assigned chats;
  - open Avinash Group in support mode, confirm read-only, then allow changes and confirm the audit entries.
- **Rollback:** switch off. The new tables are additive, and the old `role` columns are kept for one release.
- **Review:** `access-control`, `tenant-isolation`.

### 7. S1 Staff console and organisation health
- **Outcome:** one console over all organisations, with a health badge each.
- **Scope:** access 9.2 (including Org health), 9.4 and 15; staff roles `support`, `billing_ops` and `auditor`.
- **Key deliverables:**
  - dashboard;
  - organisations list;
  - Org 360 with the Health tab;
  - user directory;
  - audit screens;
  - jobs screen;
  - daily digest e-mail to staff;
  - `org_id` tags in logs (if not done in T1).
- **Switches:** none (staff only).
- **Owner check:** break a test organisation's WhatsApp token and confirm the badge goes red with the reason.
- **Rollback:** revert. There are no customer effects.
- **Review:** `access-control`.

### 8–10. B2 Wallet, B3 Invoices and offline payments, B4 Online payment and Billing page
- **Outcome:**
  - staff record bank, UPI, cheque and cash payments, which issue numbered invoices and activate the plan;
  - customers pay online through Razorpay (shared account with UrbanSociety, PLAN 6) on one Billing page.
- **Scope:** billing 5.6–5.8 and 12 (B2–B4); PLAN 5.2 and 6.
- **Before B3 goes live:** seller details (PLAN Q5).
- **Before B4 goes live:**
  - copy the Razorpay keys server to server (PLAN Q6);
  - add the Nexus webhook in the Razorpay dashboard (the owner does this);
  - the old licence-server client is removed in B4 (PLAN N1).
- **Switches:** without Razorpay keys, checkout answers 503 `NOT_CONFIGURED`.
- **Owner check:**
  - record a ₹1 bank payment for a test organisation and check the invoice PDF (rupee sign, Hindi name);
  - pay ₹1 online in Razorpay test mode;
  - replay the webhook and confirm there is one payment.
- **Rollback:** additive tables. Each phase is reverted by switch or code revert; money tables are never dropped once used.
- **Review:** `billing-money-review` (mandatory), `tenant-isolation`.

### 11. L1 Limits framework and storage
- **Outcome:** customers see seats, workspaces, contacts and storage used against the plan; storage is counted exactly.
- **Scope:** access 10.1, 10.3, 10.4 and 16 (L1).
- **Key deliverables:**
  - limit catalogue;
  - `usage_counter`;
  - `stored_file` and the files service (every module moved to it);
  - `org_storage`;
  - upload checks;
  - trash;
  - reconciliation;
  - the Usage screen;
  - 80% and 100% notices.
- **Switches:** `ACCESS_STORAGE_ENFORCE` off for 2 weeks (warn only).
- **Owner check:**
  - set a test plan's storage to 50 MB, upload past it and see the warning;
  - after enforcement is on, see 413 `storagefull` with the cleanup list.
- **Rollback:** switch off. The registry is additive.
- **Review:** `usage-limits`, `tenant-isolation`.

### 12. B5 + P1 Lifecycle, expiry alerts, lockout, plan change handling
- **Outcome:**
  - expiry and overdue e-mails and banners;
  - upgrade (pay the difference), downgrade at period end, cancel and undo;
  - the impact preview and keep-for-current in the designer;
  - downgrade behaviour (access 7.5);
  - lockout ready.
- **Scope:** billing 5.4, 5.10, 5.11 and 12 (B5); access 7.5 and 16 (P1); ACCESS-REQUIREMENTS 4.2.
- **Switches:** `BILLING_LOCKOUT_ENABLED` off. It is turned on only after a month, one organisation at a time (Radixile first, then Avinash Group with agreement).
- **Owner check:** run the downgrade scenario script (Agency to Individual, with 6 workspaces, 3 GB, custom roles and autopilot) and read its report.
- **Rollback:** switch off.
- **Review:** `billing-money-review`, `access-control`.

### 13. R2 Custom roles, teams and routing
- **Outcome:** organisations make their own roles from templates; teams and routing rules; agent status.
- **Scope:** ACCESS-REQUIREMENTS 5.7–5.8; access 6.3–6.4 and 16 (R2).
- **Switches:** sellable features `custom_roles` and `teams_routing`, off in seeded plans until the owner ticks them.
- **Owner check:**
  - create a "Site-visit coordinator" template and copy it into Avinash Group;
  - confirm an Admin cannot grant more than they hold.
- **Review:** `access-control`.

### 14. R3 AI sales agents
- **Outcome:** AI agents per workspace with restricted rights. Routing goes bot, then AI agent, then person. Today's "Let AI answer" becomes the default agent unchanged.
- **Scope:** ACCESS-REQUIREMENTS 5.6.
- **Switches:** sellable feature `ai_agents`. The migration of today's fallback keeps behaviour identical (characterization on recorded bot conversations).
- **Owner check:** an AI agent for Ask Avi qualifies a test lead and hands over on "talk to a person"; an export attempt by the agent is refused.
- **Review:** `access-control`, `tenant-isolation` (prompt contains only own workspace data), `usage-limits`.

### 15–16. B6 Metering, B7 + L2 AI credits and enforcement
- **Outcome:**
  - every AI call metered: reserve, settle, release;
  - credits per plan, top-ups, daily, user and platform cost caps;
  - BYOK counted but not charged;
  - message counts.
- **Scope:** billing 5.9 and 12 (B6, B7); access 10.2 and 16 (L2).
- **Switches:**
  - `BILLING_AI_ENABLED` metering on and enforcement off for a month;
  - `BILLING_ENFORCEMENT_ENABLED` off;
  - then one organisation at a time.
- **Owner check:**
  - compare a month of counted credits with the AI provider bills;
  - set the credit prices and allowances in the designer.
- **Review:** `usage-limits`, `billing-money-review`.

### 17. B8 Reports and add-ons
- **Outcome:** MRR, ARR, ageing, collections, AI margin; paid add-ons on top of plans (ACCESS-REQUIREMENTS 4.4).
- **Review:** `billing-money-review`.

### 18. T2 Postgres row-level security (optional)
- **Outcome:** the database itself refuses cross-organisation reads on the server edition.
- **Scope:** access 11.3.
- **Switches:** `ACCESS_RLS_ENABLED` in audit mode for 2 weeks, then enforce.
- **Review:** `tenant-isolation`.

## Decisions needed before each phase

| Before | Decide | Default if not decided |
|---|---|---|
| S0 | nothing | go |
| A0 | feature list grouping (ACCESS-REQUIREMENTS 4.1); permission keys (5.3) | as written |
| B0 | yearly price rule (PLAN Q4); keep the draft migration | percentage annual discount; keep |
| B1 | locked vs hidden menu items (A3 / Q6); which features each plan should **not** have | locked; all on until the owner edits |
| R1 | role list and matrix (5.2); Creator bot change (A9); staff MFA (Q5); support consent (A2 / Q4) | as written |
| B3 | seller details on invoices (PLAN Q5) | **blocks go-live**, not the build |
| B4 | Razorpay keys copy and Nexus webhook (PLAN Q6) | **blocks go-live**, not the build |
| L1 | storage quotas per plan (access 7.3), trash counts (Q9) | unlimited seeded; warn only |
| B5 | grace days, reminder schedule | 3 days; D-30/15/5/2/1 |
| R2 / R3 | custom roles and AI agents per plan (Q12, A6) | Agency and Full |
| B7 | credit prices and allowances (access 10.2, 7.3) | count only until set |

## How to use Claude models for this build
- **Author:** the strongest model (Opus 5.5) for S0, A0, T1, B3, B4, B7 and L2, which cover security, isolation and money. Sonnet 5.5 for screens, routes and tests written from a fixed contract.
- **Reviewer:** always a different agent from the author, using the skill named on the card.
- **Brief:** use the template in the `billing-delivery` skill for every phase, not only billing ones. Give the cited sections, owned files, the REST contract and the "Done when" list.
- **One phase at a time.** A phase is committed only when its gates pass. Every commit to `master` deploys to production.

## Gates between phases (every phase)
1. **Tests:** the phase's own "Done when" tests pass. The route inventory and two-org isolation harness stay green; from T1 onwards their baseline is empty.
2. **Consistency checker:** green from B1 onwards.
3. **Migration:** it runs on empty SQLite, empty Postgres and a copy of production data, and has a rollback note.
4. **Before/after check:** a before and after snapshot of plans, subscription states, counts and money totals is taken. Any unexplained difference stops the rollout.
5. **Owner hand-off:** release notes, a changelog entry and a version bump; a UAT checklist for the owner; and a list of what has never run for real.

## Conflicts resolved (19 Nov 2026)

The documents were written by two agents in parallel. Every conflict found is listed with the decision and where it now lives.
Each document has been updated to match; no document should contradict another. If one appears to, this table wins and the
other text is a bug to fix.

| # | Topic | Conflict | Decision | Lives in |
|---|---|---|---|---|
| C1 | Old licence-server billing | Strangler adapter kept until each account runs a cycle (billing 11.2, D2, `billing-core`) vs no adapter (PLAN N1) | **No adapter.** Production never configured it; B4 removes `services/billing.js` | PLAN N1; billing 11.2 and D2 marked superseded; `billing-core` |
| C2 | `BILLING_ENABLED` default | true on server (billing 9) vs off (PLAN N4) | **Off** until the owner switches it on | billing 9; PLAN N4 |
| C3 | Who decides access | `entitlements.can/limit` in billing vs `access.check` | **Access decides** (platform 5); billing supplies `entitlements.snapshot()` and `lockoutDecision()` through a port | billing 5.3; `billing-core` |
| C4 | Where code lives | `services/featureCatalogue.js` vs `modules/access/*` | **`modules/access/`** (`index.js`, `features.js`, `permissions.js`, `menu.js`, `limits.js`); glue in `services/accessHost.js`, `services/billingHost.js` | PLAN N2, N6; platform 0; `access-control` |
| C5 | Feature keys | three lists (billing 11.3, platform 7.1, PLAN 2.1) | **One list:** ACCESS-REQUIREMENTS 4.1, with a column mapping the old keys | ACCESS-REQ 4.1 |
| C6 | Permission keys | `module.resource.action` (`content.post.publish`) vs `area.action` | **`area.action`**, scope on the grant; `platform.*` keys stay in platform 6.2 | ACCESS-REQ 5.3; platform 4, 5.3, 6.2 |
| C7 | Error codes | `LIMIT_REACHED`, `FEATURE_NOT_IN_PLAN`, `NOT_CONFIGURED` vs lower case | **Lower case**, one list: platform 13.3 (`limitreached`, `featurenotinplan`, `notconfigured`, ...) | platform 13.3; billing 7.3; PLAN 4.1 |
| C8 | Lockout scope | publishing, sending, automation only (D9) vs also AI, create, upload (platform step 5) | **Platform step 5** (reading, export, billing, account and viewing settings still work) | billing D9; platform 5.2 |
| C9 | Trial AI credits | 10 (D8) vs 100 (platform 7.3) | **Seeded unlimited**; the owner sets the number (platform 7.3 is a proposal) | billing D8; PLAN N5 |
| C10 | Posts per month | billing channel `POST` vs access `usage_counter` | **Access limit framework** (`usage_counter`); billing channels are AI_CREDIT, WHATSAPP, EMAIL | billing 5.9; platform 10.1 |
| C11 | Razorpay webhook path | `/billing/webhook` vs `/billing/webhook/razorpay` | **`/billing/webhook/razorpay`** (old path belongs to the old client until B4) | billing 7; PLAN 6 |
| C12 | Who may pay | org owner only vs owner and Billing admin | **`billing.*` permissions**, held by Owner and Billing admin | billing 4, 11.3; ACCESS-REQ 5.2 |
| C13 | Staff identity | `users.role` / platform admin vs `platform_staff` | **`platform_staff`** from R1; billing staff endpoints need `platform.billing.manage` (`super_admin`, `billing_ops`) | billing 4; platform 9.1 |
| C14 | Staff console phase | console in R1 (platform 16) vs S1 (roadmap) | **R1:** staff table, MFA, support sessions, suspend. **S1:** console, Org 360 and Health, directory, audit screens, other staff roles | platform 16 (R1 and S1 cards) |
| C15 | Audit of plan edits | `bill_audit` and `access_audit` both | **`bill_audit`** for everything in billing tables (plans, prices, overrides, subscriptions, money); `access_audit` for the rest; screens merge both | platform 15 |
| C16 | Owners per organisation | at least one vs exactly one | **Exactly one**, moved by transfer with acceptance | ACCESS-REQ 5.2, A10; platform 6.1 |
| C17 | Org-level menu hiding | proposed in a draft vs not now (Q15) | **Not now** | platform 8.1, Q15 |
| C18 | Staff billing screens | PLAN "Clients" tab vs Org 360 | **One console:** per-organisation billing is the Billing tab of Org 360 | PLAN 5.1; platform 9.2 |
| C19 | Billing phase B1 | "Entitlements" in billing 12 vs roadmap A0 and B1 | **Split:** engine, adapter and characterization in A0; feature gate and menu in B1. B5 pairs with P1, B6 and B7 with L1 and L2 | billing 12 (mapping note) |
| C20 | Default quotas and credits | a draft's numbers (1 GB, 300 credits...) vs platform 7.3 | **Platform 7.3 proposals**; seeded unlimited until the owner sets them | platform 7.3; PLAN N5 |
| C21 | `entitlements.js` result shape | `can_use` vs `can_publish` | **`can_publish`** (what the code returns today) | billing 5.3; `billing-core` |
| C22 | Tenant key name | `org_id` vs billing `account_id` | Same value and the **same isolation rules** | platform 11.1; `tenant-isolation`; `billing-core` |
| C23 | AI settings permission | `org.ai.settings` vs `org.settings.manage` | **`org.settings.manage`** | ACCESS-REQ 5.3; platform 13.1 |
| C24 | Routing feature key | `chat_routing` vs `teams_routing` | **`teams_routing`** | ACCESS-REQ 4.1, 5.7 |

**Known follow-up for B0 (not a document conflict):** the uncommitted draft migration
`db/migrations/20261119000001_billing_b0_catalogue.js` predates these decisions. Before B0 is built, it needs:
- `QUOTA` as an override kind;
- `bill_plan_revision`;
- `bill_plan.owner_org_id` and `bill_plan.badge`.

## Defaults that apply unless the owner overrides them
- Plan matrix numbers (access 7.3) are proposals; the seed keeps today's values and every feature on (PLAN N5).
- Support sessions replace the silent staff bypass (access Q2); consent not required; visible to the owner.
- Staff roles: `super_admin` only in R1; `support`, `billing_ops`, `auditor` in S1.
- All other defaults: access Q1–Q16, ACCESS-REQUIREMENTS A1–A12, PLAN N1–N8 and billing D1–D12. Which decision blocks which phase is in "Decisions needed before each phase" above; the record of conflicts resolved between documents is in "Conflicts resolved" below.
