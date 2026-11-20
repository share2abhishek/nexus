# Platform roadmap: access, roles, entitlements, usage limits and billing (one order)

This is the single build order for four documents:

| Document | Owns |
|---|---|
| `docs/billing/REQUIREMENTS.md` | money: plans, price book, subscriptions, invoices, payments, wallet, metering, top-ups |
| `docs/billing/ACCESS-REQUIREMENTS.md` | role catalogue and hierarchy, data scope, AI sales agents, teams and routing, plan designer, support mode |
| `docs/billing/PLAN.md` | the Super Admin plan designer, customer billing page, Nexus decisions N1–N8 |
| `docs/platform/CONVERSATIONS-AND-CAMPAIGNS.md` | connected mailboxes (IMAP/SMTP, Gmail, Microsoft 365), two-way campaigns, reply matching, reply AI and auto-reply, campaign strategies and results, SMS with DLT (phases C1–C4) |
| `docs/platform/ACCESS-AND-ENTITLEMENTS.md` | production findings and safety fixes, tenancy hardening, the full decision order, staff roles and support sessions, AI, storage and count limits, consistency checker, row-level security |

Phase ids follow `PLAN.md` section 7. The phases this roadmap adds are **Q0** (quality gates), **S0** (safety), **T1** and **T2** (tenancy), **L1**, **L2a** and **L2b** (limits) and **P1** (plan change handling). B5 is split into **B5a** (expiry alerts) and **B5b** (plan lifecycle).

**Priority:** set on 19 Nov 2026 after the product owner, architect and QA review in `docs/platform/REVIEW-2026-11-19.md`. That file has the reasons for this order.

**Status:** this is a plan only; nothing is built. Skills for the build are in `.claude/skills/`:
- `access-control`
- `tenant-isolation`
- `usage-limits`
- `billing-core`
- `billing-delivery`
- `billing-money-review`

## Status

| Phase | State | Where | Notes |
|---|---|---|---|
| Q0 | **done, in production** (`97046f4`, 20 Nov 2026) | `master` | Suite green (918 passed, 0 failed; quarantine Q1). **Open:** enable Bitbucket Pipelines in the repository settings; DNS `staging.nexus.radixile.com` (until then staging is reached by SSH tunnel to port 3301). Production now has a stable `NEXUS_DATA_KEY` (copied from the running container, so saved credentials stay readable) and the Dockerfile in git. |
| S0 | **done, in production** (`97046f4`, 20 Nov 2026) | `master` | No admin promotion and no cross-business `/admin` for customers on the hosted edition; no workspace from the request body; route inventory (98 routes without a permission and 13 checking inline are the baseline for A0); two-organisation isolation harness: 49 tables, 83 routes, 0 leaks, with a planted-leak self-check. |

## Principles of the order
1. **Protect what exists.** Wave 0 keeps today's customers running (the Avinash Group trial ends 2 Dec) and makes releases safe (CI, staging, a green suite) before anything new.
2. **Lay the minimum foundation once.** The access engine (A0) comes before anything that decides access. Tenancy hardening (T1) runs as a **parallel track**: any real leak the S0 harness finds is fixed at once, and the leads module finishes before R1.
3. **Sell by feature, then get paid, then alert.** Feature-based plans (B0, B1), expiry alerts (B5a), invoices and offline payments (B3), then online payment (B4).
4. **Count before enforcing.** AI usage counting (L2a) starts in Wave 1, because enforcement and pricing need a month of real data.
5. **Kill switches ship off.** The feature gate, lockout, storage and AI enforcement are never switched on in the release that introduces them.
6. **Seeds change nothing.** Seeded plans have every feature on and today's limits (PLAN N5). Seeded roles keep today's permissions.
7. **Branch per phase.** Each phase is built on `feature/<phase>` and merged to `master` only when its gates pass, because every `master` commit deploys to production (review AR1).

## Order (waves)

**MVP = Waves 0 to 2.** Waves 3 to 5 are re-prioritised after the MVP using customer feedback. **Wave 6 (two-way campaigns, C1–C4) is the last priority by the owner's decision (19 Nov 2026).**

| Wave | # | Phase | Depends on | Size | Visible change on production |
|---|---|---|---|---|---|
| **0 Now** | – | **Owner action:** extend Avinash Group's trial or set a paid plan before 2 Dec, using the existing Super Admin → Subscriptions tab | – | – | their bot keeps answering |
| | 1 | **Q0** Quality gates: Bitbucket Pipelines CI (SQLite and Postgres), test quarantine, staging environment, branch per phase | – | S | none |
| | 2 | **S0** Safety net: no `ensureAdmin` on the server edition, super admin only on cross-org `/admin/*`, no workspace id from the request body, route inventory test, two-org isolation harness | Q0 | S | none (security fix) |
| **1 Sell by feature** | 3 | **A0** Access foundation: catalogues, menu registry (data), `access.check`, `GET /api/me/access`, characterization tests, access snapshot diff tool | S0 | M | none |
| | 4 | **B0** Catalogue and plan designer, import of today's organisations (dry run first) | A0 | M | staff only |
| | 5 | **B1** Feature gate, server-driven menu, upgrade prompts, consistency checker | A0, B0 | M | none until staff edit a plan and switch the gate on |
| | 6 | **B5a** Expiry and overdue alerts: e-mails and in-app banners from the trial and paid-until dates | B0 | S | alerts start |
| | 7 | **L2a** AI usage counting: every AI call recorded per organisation and feature (count only, no limits) | A0 | S–M | staff usage view |
| **2 Get paid** | 8 | **B3** Invoices and offline payments (activate the plan) | B0 | M | staff bill and activate by bank or UPI |
| | 9 | **B2** Wallet | B3 | M | staff only |
| | 10 | **B4** Online payment (Razorpay) and customer Billing page; old licence-server client removed | B2 | M | customers pay online |
| **3 Team and oversight** | 11 | **R1** Roles v2 (sales and support agents, data scope) and support sessions | A0, T1 leads module | L | new roles; support banner and log |
| | 12 | **S1** Staff console and organisation health; staff roles `support`, `billing_ops`, `auditor` | R1 | M | staff only |
| | ∥ | **T1** Tenancy hardening, module by module, as a parallel track from Wave 1 | A0 | L | none |
| **4 Limits and lifecycle** | 13 | **L1** Limits framework and storage (warn first) | T1 media module, B1 | M | Usage screen; storage bar |
| | 14 | **B6** Message metering (count only; email and SMS) | L1 | M | usage per channel |
| | 15 | **B5b + P1** Upgrade, downgrade, cancel, plan change handling, lockout switch | B4, L1 | M | plan changes |
| | 16 | **B7 + L2b** AI credits enforcement, top-ups, caps | L2a (a month of data), B6 | M | buy more credits |
| **5 Growth** | 17 | **R2** Custom roles, teams and routing | R1, B1 | M | sellable `custom_roles`, `teams_routing` |
| | 18 | **R3** AI sales agents | R2, L2a | M | sellable `ai_agents` |
| | 19 | **B8** Reports and add-ons | B7 | M | staff only |
| | 20 | **T2** Postgres row-level security (optional) | T1 complete | S–M | none |
| **6 Two-way campaigns (last priority)** | 21 | **C1** Domain mailboxes and campaign replies: connect IMAP/SMTP, send with tracked `Message-ID`, sync and match replies, bounces and out-of-office, one conversation history, convert to lead; apply for Google verification | A0, B1, T1 Sellbird and leads modules, R1 | L | replies to campaigns arrive in Nexus |
| | 22 | **C2** Reply AI, auto-reply and campaign strategies: intents, action items and tasks, automatic lead conversion, guarded auto-reply, A/B variants, windows, warm-up, results | C1, L2a | M | AI action items; campaign comparison |
| | 23 | **C3** Gmail and Microsoft 365 sign-in | C1, Google verification approved | M | connect with Google or Microsoft |
| | 24 | **C4** SMS: provider connection (MSG91 first), DLT templates, two-way SMS, SMS steps in sequences | C1, B6, the owner's DLT registration | M | SMS in campaigns and the inbox |

Two pairs share files, so one owner builds both phases in each pair:
- **B1 with A0's registry.**
- **B7 with L2b.**

T1 runs alongside Waves 1 to 3 because none of B0, B3 or B2 touches existing tenant tables (new tables carry `org_id` / `account_id` from the start).

## Milestones

| Milestone | Phases | What the owner can do at the end |
|---|---|---|
| **M0 Safe to build** | owner action, Q0, S0 | Avinash Group keeps running. Every change is tested in CI and rehearsed on staging. Customers can't become admins. |
| **M1 Sell by feature** | A0, B0, B1, B5a, L2a | Design plans by ticking features (for example "Website AI Chat"); menus lock and unlock within a minute; customers are warned before expiry; AI cost per organisation is known. |
| **M2 Get paid (MVP complete)** | B3, B2, B4 | Bank and UPI payments recorded with numbered invoices that activate plans; customers pay online. |
| **M3 Team and oversight** | R1, S1, T1 | Sales agents see only their chats; audited support sessions; one view of every organisation's health; isolation enforced in data. |
| **M4 Limits and lifecycle** | L1, B6, B5b + P1, B7 + L2b | Usage and storage screens; upgrades pay the difference; AI credits enforced after a month of data. |
| **M5 Growth** | R2, R3, B8, T2 | Custom roles and teams, AI sales agents, revenue reports, row-level security. |
| **M6 Two-way campaigns** (last priority) | C1, C2, C3, C4 | Campaign replies from connected mailboxes (domain, then Gmail and Microsoft 365) land in one conversation history; AI lists action items and converts interested replies to leads; guarded auto-reply; A/B strategies and results; two-way SMS with DLT. |

## Phase cards

Each card adds what the specs leave out:
- the owner-visible outcome;
- the switches;
- the owner check (UAT);
- the rollback plan;
- the review needed.

Scope detail is in the cited sections. "Review" names the skill checklist that the reviewing agent applies. It must be a different agent from the author.

### Q0 Quality gates (before any build)
- **Outcome:** every change is tested automatically on SQLite and Postgres and can be rehearsed on staging.
- **Scope:** review AR1, AR2, QA1, QA2, QA3, QA4.
- **Key deliverables:**
  - `bitbucket-pipelines.yml` ported from `.github/workflows/test.yml` (Node 20; a SQLite leg; a Postgres 16 service leg with `PG_TEST_URL`), run on every branch and pull request;
  - the 28 known failures fixed or quarantined in `tests/QUARANTINE.md` (owner and reason per test), and the gate "green except quarantine; quarantine does not grow";
  - staging: a second compose project `nexus-staging` on the same server, its own database restored from a masked production copy, `staging.nexus.radixile.com`, Razorpay **test** keys, SMTP to a catch-all inbox, and a deploy script option `--staging <branch>`;
  - a branch per phase (`feature/<phase>`), merged to `master` only when green;
  - `docs/platform/UAT-LOG.md`.
- **Switches:** none.
- **Done when:**
  - a pull request with a failing test is shown red in Bitbucket;
  - staging serves the current `master` with its own database;
  - the suite is green apart from the listed quarantine.
- **Owner check:** open staging, log in, see test data (not real customers' messages).
- **Merging to `master` (one time):** production's `Dockerfile` and `.dockerignore` exist on the server as untracked files, and git refuses to fast-forward over them. Before the deploy, on the server: `mkdir -p ~/projects/nexus-backups/pre-q0 && mv ~/projects/nexus/Dockerfile ~/projects/nexus/.dockerignore ~/projects/nexus-backups/pre-q0/`. The new `.dockerignore` keeps every `.env*` file out of the image (production's `.env.bak` was being copied in).
- **Rollback:** none needed (tooling only).
- **Review:** QA review checklist in `REVIEW-2026-11-19.md` section 4.

### S0 Safety net
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

### A0 Access foundation
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

### B0 Catalogue and plan designer
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

### B1 Feature gate and menu
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

### B5a Expiry and overdue alerts (Wave 1)
- **Outcome:** owners are warned before a trial or paid period ends, and after it lapses, by e-mail and an in-app banner. This works before the billing module bills anyone, because it reads today's `trial_ends_at` and `paid_until`, and later the subscription.
- **Scope:** billing 5.11 (dedupe keys, recipients), the reminder offsets in billing 5.10 (D-30/15/5/2/1), and the lapse notice. Not upgrade or downgrade.
- **Key deliverables:**
  - the `reminders` job (08:00 IST, claimed per day through `bill_job_run`);
  - e-mail templates;
  - a banner component on the dashboard with a "Choose a plan" button (opens Billing, or "contact us" until B4);
  - a staff "send a test reminder" action;
  - SMTP domain check (review AR9).
- **Switches:** `BILLING_REMINDERS_ENABLED` off at release; switched on after a test send on staging.
- **Done when:**
  - with the clock override on staging, an organisation whose trial ends in 7, 2 and 1 days gets exactly one e-mail per offset;
  - a second run sends nothing;
  - the banner shows the right date.
- **Owner check:** receive the test reminders for a staging organisation.
- **Rollback:** switch off.
- **Review:** `billing-money-review` (notification rules), `tenant-isolation` (recipients inside the organisation).

### L2a AI usage counting (Wave 1, count only)
- **Outcome:** every AI call on platform keys and on the organisation's own keys is recorded per organisation, workspace, feature, model and provider cost. Nothing is limited.
- **Scope:** access 10.2 (sequence, what counts, BYOK counted not charged) and billing 5.9 (`bill_ai_request`, `bill_feature_price`). Only the recording: no credits are deducted, nothing is blocked.
- **Key deliverables:**
  - an `afterCall` hook beside the existing `beforeCall` in `aiHelper.aiGenerate`;
  - the same in image and video generation and in the bot's AI path;
  - a staff usage view (per organisation, feature, model, cost);
  - a test that fails on an unmetered AI call site;
  - prompts never stored (hashes and token counts only).
- **Switches:** `BILLING_AI_ENABLED` (metering on, enforcement off).
- **Done when:**
  - every AI call path is recorded;
  - a failure in recording never delays or fails the AI answer (slow-database test);
  - a month's counts compare with the provider dashboards within 5%.
- **Owner check:** after a week, read the staff usage view, then decide credit prices and allowances for B7.
- **Rollback:** switch off.
- **Review:** `usage-limits`, `tenant-isolation`.

### B3 Invoices and offline payments, B2 Wallet, B4 Online payment and Billing page
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

### R1 Roles v2 and support mode
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

### S1 Staff console and organisation health
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

### T1 Tenancy hardening (parallel track; one release per module)
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

### L1 Limits framework and storage
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

### B6 Message metering, B7 + L2b AI credits and enforcement
- **Outcome:**
  - every AI call metered with reserve, settle and release (the counting itself started in L2a);
  - credits per plan, top-ups, daily, user and platform cost caps;
  - BYOK counted but not charged;
  - message counts.
- **Scope:** billing 5.9 and 12 (B6, B7); access 10.2 and 16 (L2; enforcement part).
- **Switches:**
  - `BILLING_AI_ENABLED` metering on and enforcement off for a month;
  - `BILLING_ENFORCEMENT_ENABLED` off;
  - then one organisation at a time.
- **Owner check:**
  - compare a month of counted credits with the AI provider bills;
  - set the credit prices and allowances in the designer.
- **Review:** `usage-limits`, `billing-money-review`.

### B5b + P1 Plan lifecycle, lockout, plan change handling
- **Outcome:**
  - upgrade (pay the difference), downgrade at period end, cancel and undo;
  - the impact preview and keep-for-current in the designer;
  - downgrade behaviour (access 7.5);
  - lockout ready.
- **Scope:** billing 5.4, 5.10, 5.11 and 12 (B5); access 7.5 and 16 (P1); ACCESS-REQUIREMENTS 4.2.
- **Switches:** `BILLING_LOCKOUT_ENABLED` off. It is turned on only after a month, one organisation at a time (Radixile first, then Avinash Group with agreement).
- **Owner check:** run the downgrade scenario script (Agency to Individual, with 6 workspaces, 3 GB, custom roles and autopilot) and read its report.
- **Rollback:** switch off.
- **Review:** `billing-money-review`, `access-control`.

### R2 Custom roles, teams and routing
- **Outcome:** organisations make their own roles from templates; teams and routing rules; agent status.
- **Scope:** ACCESS-REQUIREMENTS 5.7–5.8; access 6.3–6.4 and 16 (R2).
- **Switches:** sellable features `custom_roles` and `teams_routing`, off in seeded plans until the owner ticks them.
- **Owner check:**
  - create a "Site-visit coordinator" template and copy it into Avinash Group;
  - confirm an Admin cannot grant more than they hold.
- **Review:** `access-control`.

### R3 AI sales agents
- **Outcome:** AI agents per workspace with restricted rights. Routing goes bot, then AI agent, then person. Today's "Let AI answer" becomes the default agent unchanged.
- **Scope:** ACCESS-REQUIREMENTS 5.6.
- **Switches:** sellable feature `ai_agents`. The migration of today's fallback keeps behaviour identical (characterization on recorded bot conversations).
- **Owner check:** an AI agent for Ask Avi qualifies a test lead and hands over on "talk to a person"; an export attempt by the agent is refused.
- **Review:** `access-control`, `tenant-isolation` (prompt contains only own workspace data), `usage-limits`.

### B8 Reports and add-ons
- **Outcome:** MRR, ARR, ageing, collections, AI margin; paid add-ons on top of plans (ACCESS-REQUIREMENTS 4.4).
- **Review:** `billing-money-review`.

### T2 Postgres row-level security (optional)
- **Outcome:** the database itself refuses cross-organisation reads on the server edition.
- **Scope:** access 11.3.
- **Switches:** `ACCESS_RLS_ENABLED` in audit mode for 2 weeks, then enforce.
- **Review:** `tenant-isolation`.

### C1 Domain mailboxes and campaign replies
- **Outcome:** a campaign sent from a connected mailbox gets its replies back into Nexus, matched to the campaign and contact, in one conversation history. Interested replies become leads with one click. Bounces and out-of-office replies are handled automatically.
- **Scope:** CONVERSATIONS sections 3.1 (domain mailbox), 4, 5, 8 and 9.
- **Key deliverables:**
  - `channel_accounts` with an IMAP/SMTP connect and test screen;
  - `Message-ID` and reply tokens on every touch;
  - `List-Unsubscribe` with a one-click unsubscribe;
  - a suppression list per organisation;
  - the `mail-sync` job with matching rules 1–3, bounce, auto-reply and complaint detection;
  - `email_messages`, and the email channel in `lead_conversation_messages`;
  - an email filter in the inbox;
  - stop the sequence on a reply;
  - manual convert to lead;
  - mailbox health on the organisation Health tab;
  - the Google verification application started.
- **Switches:** feature `email_mailboxes` (on in trial, Agency and Full seeds, per PLAN N5); `MAIL_SYNC_ENABLED` off at release, then on for Radixile's own mailbox first.
- **Done when:**
  - the fixture suite passes: replies, forwarded mail, HTML-only, non-English, bounces, out-of-office, duplicates on re-sync;
  - an unmatched message is never stored;
  - another organisation's mailbox or replies are unreachable (isolation harness);
  - a reply on staging arrives within 3 minutes.
- **Owner check:** on staging, connect a test domain mailbox, send a 3-contact campaign, reply from your phone, and see the reply in the contact's history and convert it to a lead.
- **Rollback:** switch sync off. The tables are additive.
- **Review:** `tenant-isolation` (mandatory), `access-control`, `usage-limits` (attachments count toward storage).

### C2 Reply AI, auto-reply and campaign strategies
- **Outcome:**
  - every human reply gets an intent and action items (tasks with due dates);
  - interested replies become leads automatically;
  - safe questions can be answered automatically under strict rules;
  - campaigns use strategy templates, A/B variants, send windows and warm-up, and are compared on results.
- **Scope:** CONVERSATIONS sections 6 and 7.
- **Switches:** features `reply_ai`, `reply_auto` (off in seeds until the owner ticks it), `campaign_variants`. Auto-reply defaults to **draft**.
- **Done when:**
  - intents are labelled correctly on a 100-reply labelled fixture set at ≥ 85%;
  - an auto-reply is never sent for unsubscribe, complaint, legal or negative replies (tests);
  - at most 2 automatic replies per thread;
  - prompt-injection fixtures ("ignore your instructions...") are refused;
  - variant results add up to the campaign totals.
- **Owner check:** read 20 real replies' intents and action items on staging; correct any wrong ones; check the campaign comparison view.
- **Rollback:** switch the features off.
- **Review:** `usage-limits` (AI metering), `tenant-isolation` (prompt contains only that thread and workspace), `access-control`.

### C3 Gmail and Microsoft 365 sign-in
- **Outcome:** owners connect Gmail / Google Workspace and Outlook / Microsoft 365 by signing in, with no passwords.
- **Scope:** CONVERSATIONS 3.1 (Gmail and Microsoft rows).
- **Before it starts:**
  - Google's OAuth verification and security assessment approved (applied for in C1);
  - Microsoft publisher verification.
- **Key deliverables:**
  - OAuth with PKCE and a state check;
  - the Gmail API adapter (`history.list`, `send` in the thread);
  - the Graph adapter (delta query, `sendMail` / reply);
  - token refresh;
  - reconnect on revoke;
  - the same matching and import as C1.
- **Switches:** feature `email_oauth`.
- **Done when:**
  - the adapters pass the same fixture suite as IMAP through fakes;
  - token revocation shows "reconnect" within one sync;
  - the scopes are the minimum listed.
- **Review:** `tenant-isolation`, `access-control`.

### C4 SMS
- **Outcome:** organisations connect their SMS provider (MSG91 first) and send DLT-registered SMS steps in campaigns. Replies arrive in the same conversation history; STOP is honoured across channels.
- **Scope:** CONVERSATIONS 3.2, and the SMS rows of 7.1 and 10–12.
- **Before go-live:** the organisation's DLT registration (entity, header, templates).
- **Key deliverables:**
  - the `SmsProvider` port and the MSG91 adapter;
  - `sms_templates` with DLT ids;
  - `sms_messages`;
  - inbound and delivery webhooks with verification;
  - the time-window rules (promotional 09:00–21:00 IST);
  - the shared suppression list;
  - the SMS meter.
- **Switches:** feature `sms_channel`.
- **Done when:**
  - free text to an Indian number is refused;
  - promotional messages outside the window are held;
  - a webhook with a bad signature is refused;
  - STOP suppresses across email, SMS and WhatsApp.
- **Review:** `tenant-isolation`, `usage-limits`.

## Decisions needed before each phase

| Before | Decide | Default if not decided |
|---|---|---|
| Wave 0 | Avinash Group: extend the trial or set a paid plan before 2 Dec (review PO1) | **no default: needs a decision** |
| Q0 | staging on the same server; branch per phase; Bitbucket Pipelines | as proposed |
| S0 | nothing | go |
| A0 | feature list grouping (ACCESS-REQUIREMENTS 4.1); permission keys (5.3) | as written |
| B0 | yearly price rule (PLAN Q4); keep the draft migration | percentage annual discount; keep (with the C-register follow-ups) |
| B1 (switch on) | **first price list and which features each plan lacks** (review section 6); locked vs hidden menu items (A3 / Q6) | gate stays off; locked |
| B5a | reminder offsets; sender address | D-30/15/5/2/1 before, +3/+7 after; the existing SMTP sender |
| L2a | nothing (count only) | go |
| B3 (go-live) | seller details and GST status (PLAN Q5) | **blocks go-live**, not the build |
| B4 (go-live) | Razorpay live keys copied server to server and the Nexus webhook; test-mode keys for staging (PLAN Q6) | **blocks go-live**, not the build |
| R1 | role list and matrix (5.2); Creator bot change (A9); staff MFA (Q5); support consent (A2 / Q4); whether Avinash Group needs agent logins now (review PO6) | as written |
| C1 | mailbox visibility (CONVERSATIONS M1); import mail from known contacts (M2); lead conversion automatic or one click (M3); start Google verification (M4); expected mailboxes and volume (M9) | as written in CONVERSATIONS section 15 |
| C2 | auto-reply default and allowed intents (M8); open tracking (M7) | drafts only; opens off |
| C3 | Google verification approved; Microsoft publisher verification | **blocks the phase** |
| C4 | SMS provider (MSG91 first) and billing model (M5); the organisation's DLT registration and templates | own provider account; **DLT blocks go-live** |
| L1 | storage quotas per plan (access 7.3); trash counts (Q9) | unlimited seeded; warn only |
| B5b | grace days | 3 days |
| B7 | credit prices and allowances (from L2a data) | count only until set |
| R2 / R3 | custom roles and AI agents per plan (Q12, A6) | Agency and Full |

## How to use Claude models for this build
- **Author:** the strongest model (Opus 5.5) for S0, A0, T1, B3, B4, B7 and L2, which cover security, isolation and money. Sonnet 5.5 for screens, routes and tests written from a fixed contract.
- **Reviewer:** always a different agent from the author, using the skill named on the card.
- **Brief:** use the template in the `billing-delivery` skill for every phase, not only billing ones. Give the cited sections, owned files, the REST contract and the "Done when" list.
- **One phase at a time.** A phase is committed only when its gates pass. Every commit to `master` deploys to production.

## Gates between phases (every phase)
0. **Where:** built on `feature/<phase>`; Bitbucket Pipelines green on SQLite and Postgres; rehearsed on staging (UAT recorded in `UAT-LOG.md`); only then merged to `master`, which deploys to production.
1. **Tests:** the phase's own "Done when" tests pass, and the full suite is green apart from `tests/QUARANTINE.md`, which must not grow. The route inventory and two-org isolation harness stay green; their baseline shrinks with T1 and is empty when T1 completes. A real cross-organisation leak found at any time is fixed at once.
2. **Consistency checker:** green from B1 onwards.
3. **Migration:** it runs on empty SQLite, empty Postgres and a copy of production data, and has a rollback note.
4. **Before/after check:** a before and after snapshot of plans, subscription states, counts and money totals, plus the access snapshot diff (every organisation and user's `/api/me/access` and menu, from A0), is taken. Any unexplained difference stops the rollout.
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
| C10 | Posts per month | billing channel `POST` vs access `usage_counter` | **Access limit framework** (`usage_counter`); billing channels are AI_CREDIT, WHATSAPP, EMAIL and SMS (added with CONVERSATIONS C4) | billing 5.9; platform 10.1 |
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
