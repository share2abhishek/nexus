# Access, Entitlements and Usage Limits: requirements and plan

**What this covers, end to end:**
- **Roles and authorisation:** platform staff, organisation roles, workspace roles and custom roles.
- **Feature control:** feature flags, kill switches and the plan feature matrix.
- **Menu management:** one server-driven menu.
- **The single decision point:** one place that answers "may this person do this, here, now?", checked against subscription, plan, features, role and limits.
- **Super admin oversight:** a console over every organisation, and audited support access.
- **Strict organisation isolation:** no data shared across organisations.
- **Usage limits per plan:** AI usage, data storage and every other countable thing.

**Status:** this is a plan only. Nothing here is built. It sits on top of `docs/billing/REQUIREMENTS.md`, which owns plans, prices, subscriptions, invoices and metering. This document owns everything that **decides access** and **counts usage against limits**. The two documents share one plan catalogue and one effective-plan rule. The combined build order is in `docs/platform/ROADMAP.md`.

**Who it is for:** the owner, for decisions (section 17 lists them with recommended defaults), and developers and Claude models building it. The skills `access-control`, `tenant-isolation` and `usage-limits` in `.claude/skills/` summarise the rules and point back here.


## 0. How this document relates to `docs/billing/ACCESS-REQUIREMENTS.md` and `docs/billing/PLAN.md`

Those two documents were written in parallel and cover the same ground. To avoid two sources of truth:

| Topic | Source of truth |
|---|---|
| **Feature catalogue** (the one list of feature keys, including AI per channel) | `ACCESS-REQUIREMENTS.md` 4.1. It replaces the "initial features" list in 7.1 here, and its last column maps the old keys |
| **Plan designer**, on-the-fly plan changes, keep-for-current overrides, plan revisions, private custom plans, add-ons | `ACCESS-REQUIREMENTS.md` 4.2–4.4 (the staff screen and matrix API in 9.2 and 13.2 here use them) |
| Workspace and org **role catalogue** (Owner, Admin, Billing admin, Member; Manager, Creator, Approver, Client, Analyst, Sales manager, Sales agent, Support agent, Bot designer, Viewer) with the default permission matrix, **data scope** (own, assigned, team, workspace, org), hierarchy rules, **AI sales agents**, **teams and routing**, **custom roles** | `ACCESS-REQUIREMENTS.md` 5.1–5.8 |
| Permission key format and full key list | `ACCESS-REQUIREMENTS.md` 5.3 (`area.action`, scope on the grant). The `platform.*` keys stay in 6.2 here; the other rows of the 6.2 table are superseded by 5.3 there |
| File locations and migrations | **One layout (PLAN N2, N6):** all access code in `modules/access/` (`index.js` engine, `features.js`, `permissions.js`, `menu.js`, `limits.js`); host glue in `services/accessHost.js` and `services/billingHost.js`; all migrations in `db/migrations/` |
| Licence server | `PLAN.md` decision N1 (no adapter; the built-in module replaces it), which overrides the billing default D2 |
| Seeded plans | `PLAN.md` decision N5: seed every feature on and today's limits; new limits (storage, AI credits, contacts, posts) are seeded as unlimited (-1) and the numbers in 7.3 here are proposals the owner applies later in the plan designer |
| **This document is the source of truth for:** the production findings and safety fixes (section 2, phase S0); tenancy hardening and enforcement of isolation (section 11, phases T1 and T2); the full decision order including identity, kill switches, org status and limits (5.2); platform staff roles and support session rules (section 9); limits for AI, storage and counts (section 10, phases L1 and L2); the consistency checker (7.4) | here |

Differences resolved:
1. **Decision order.** `ACCESS-REQUIREMENTS.md` section 3 lists four gates (subscription, plan, role, scope). Section 5.2 here is the same order with identity, kill switch, tenancy, org status, limits and rate guard added around it. Record **scope** (own, assigned, team) is evaluated with tenancy at step 3 and again for list queries, and answers 404.
2. **Staff roles.** Ship `super_admin` only in R1 (ACCESS-REQUIREMENTS decision A1). `support`, `billing_ops` and `auditor` follow in S1, as specified in 9.1.
3. **Support consent.** Same in both: not required by default, visible to the owner. The `approval` and `blocked` policies in 9.3 are options the org can choose.
4. **Workspace roles in 6.1** are replaced by the larger list in `ACCESS-REQUIREMENTS.md` 5.2; today's five map without loss, as both documents require.
5. **Feature keys.** One catalogue: `ACCESS-REQUIREMENTS.md` 4.1. Plan matrix rows, permission `feature` fields and menu items use those keys only; the consistency checker (7.4) fails on any other key.
6. **Owners.** Exactly one Owner per organisation, moved only by transfer with acceptance (both documents; ACCESS-REQUIREMENTS A10).

---

## 1. Goals and non-goals

### 1.1 Goals
1. **One decision point.** Every route, job, webhook, bot and screen asks `access.check(...)`. No hand-written role or plan checks anywhere else.
2. **Defence in depth for tenancy.** An organisation can never see, change or infer another organisation's data. This holds through:
   - guessed ids;
   - shared caches and background jobs;
   - AI retrieval, exports, files, webhooks and logs.
3. **Plans drive features, menus and limits from data, not code.** A super admin changes a plan matrix and the effect shows in menus, APIs and limits within a minute.
4. **Super admin sees every organisation**, through aggregated views by default. Reaching into an organisation's content goes through **support access**: it needs a reason, is time-boxed, is audited, and the customer can see it.
5. **Usage limits are fair, visible and safe.**
   - **AI:** credits, rate limits and cost caps.
   - **Storage:** bytes and file sizes.
   - **Counts:** seats, workspaces, sites, contacts, posts and messages.
   - Customers see what they used. Limits block only deliberately, with clear wording and an upgrade or top-up path.
6. **Desktop edition unchanged.** All of this runs on the hosted (server) edition. The desktop app keeps its licence (`services/license`) and gets a fixed "desktop plan" through the same decision point, so the code paths are the same.

### 1.2 Non-goals
- Single sign-on (SAML or OIDC) and SCIM provisioning are later, enterprise-plan items. The model leaves room for them.
- Field-level permissions (hiding single fields) are out of scope. Masking stays a per-endpoint concern.
- Cross-organisation sharing such as agency-to-client links is **out of scope**: no organisation shares data with another. The existing agency model, where one organisation has many client workspaces, covers agencies.

---

## 2. What Nexus has today (findings; file references verified 2026-11-19)

| Area | Today | Gap |
|---|---|---|
| Tenancy model | `organizations` (the business) has `workspaces` (brand or client). `org_members` (owner, admin) and `memberships` (manager, creator, reviewer, client, analyst). | About 48 newer tables carry `workspace_id`, but none carries `org_id`. About 13 legacy tables (`posts`, `scheduled_posts`, `history`, `analytics`, `templates`, `brand_kit`, `email_*`, `seo_keywords`, `utm_links`, `tokens`, `apps`) were created per `user_id`, and `workspace_id` was added later by `tenancy_core`. Isolation therefore depends on every query remembering a `workspace_id` filter. |
| Workspace resolution | `middleware/tenancy.js` reads the workspace from the `x-workspace-id` header, route params, **the request body**, or the session, then checks membership. | Membership is checked, which is good. But the workspace can come from the body, and a nested resource id (a post id or a contact id) is not checked against the workspace in one central place. Each route does its own check. |
| Workspace permissions | `services/rbac.js` holds a static matrix of 5 roles and 11 actions. `requirePermission(action)` is mounted per route. | No org-level permissions, no custom roles, and no tie to plan features. Platform admins bypass all checks and silently act as `manager` in **any** workspace, with no audit and no reason. |
| Org roles | `org_members.role` is `owner` or `admin`. `routes/workspaces.js` checks it inline. | It isn't in the permission matrix, and there is no billing-only or member org role. |
| Platform roles | `users.role` is `user`, `admin` or `superadmin`. `PLATFORM_ADMIN_EMAILS` also grants platform admin once the email is verified (`services/platformAdmin.js`). | **Risk (P0):** `routes/admin.js` lets a user with `users.role = 'admin'` list **all** users across the platform (`GET /admin/users`), view one, delete one, create users and manage invite codes. Only some routes need super admin. `services/ensureAdmin.js` runs at every start, **including on the server edition**. If no admin exists, it promotes the owner of the first organisation, or the first sign-up, to `admin`. On the hosted edition that can be a customer. **Verify on production and fix first** (Phase S0). *Verified 19 Nov 2026 (read-only):* production has one `superadmin` (the owner of the Radixile organisation), `PLATFORM_ADMIN_EMAILS` is set, and both customer users are plain `user`. No customer holds `admin` today, so this is preventive; the code path still exists and S0 still goes first. |
| Plans and limits | `services/entitlements.js` holds `DEFAULT_PLANS` with limits `workspaces`, `users` and `seo_sites`, an override via `saas_plans` config, `decide()`, a 3-day grace, `limitProblem()`, and a 30-second cache. | The only feature switch is `can_publish`. There are no per-plan feature keys, and plan data lives in code plus a JSON blob. |
| Feature switches | `services/edition.js` (`features()`), `services/siteSwitches.js` (signup and pricing from `platform_config`). | There is no general feature-flag service, no rollout percentage, and no org allowlist. |
| Menus | `public/index.html` has a static sidebar with about 36 `data-page` items. `public/js/01-core.js` `navigateTo()` decides nothing about access. | Menus ignore role and plan. Users see pages they cannot use, and an API 403 or 402 is the first signal. |
| AI limits | `services/aiQuota.js` keeps in-memory per-process counters: platform AI 20 a minute and 100 a day per workspace, and bot replies 500 a day. `middleware/auth.js` `injectUserKeys` picks the key source (own, the business's shared keys, platform) and requires a verified email for platform keys. | Counters reset on restart and are per process. There are no credits, no plan link, no persistent usage, no cost cap and no customer-visible usage. |
| Storage | `services/mediaStore.js` caps each file (image 15 MB, video 200 MB) and sniffs content. `media_assets.size` exists. Files are stored on local disk under `data/media`. | There is no per-organisation total, no plan limit, no usage screen and no reconciliation. Attachments and knowledge-base files are not counted. |
| Audit | `GET /admin/activity` exists. | There is no structured access or staff audit. |

---

## 3. Principles (hard rules)

1. **Deny by default.** A route with no declared access rule fails a test (route inventory, section 13.2). Public routes are an explicit allowlist.
2. **Security checks fail closed; commercial limits fail open.** These must fail closed: identity, tenancy, organisation suspension and role checks. An error in them means deny. These must fail open: measuring usage (counting rows, reading quota). An error there means allow and log, so a bug of ours never stops a customer. Hard limits such as storage bytes are checked fail-open on read errors, but the write itself is still bounded by the per-file limit.
3. **The organisation comes from the session, never from input.** An id in a URL or body is a *pointer* and must resolve to a row whose `org_id` equals the session's organisation. A mismatch answers **404** (not 403), so ids cannot be probed.
4. **One rule, one place.** Role matrices, plan features, limits and menus are data in registries and tables. Routes and screens only ask.
5. **The server decides; the UI mirrors.** Menus and buttons come from the same decision as the API, so they never disagree. A hidden menu is a convenience, not a control.
6. **Downgrades never delete data.** Over-limit or de-entitled data becomes read-only, export stays possible, and new items are refused.
7. **Staff access is visible.** A super admin entering an organisation's content does it through a support session that the organisation's owner can see.
8. **Audit every change of power:** role grants, custom roles, plan matrix edits, overrides, flags, support sessions and suspensions. Record who, when, old value, new value and reason.
9. **Caches are keyed by organisation and short-lived**, at most 60 seconds, and evicted on write. Never cache a decision across organisations.
10. **Same code on both editions and both databases** (SQLite and Postgres). Correctness never depends on row locks (as in billing rule 3.3).

---

## 4. Concepts and vocabulary

| Term | Meaning |
|---|---|
| **Platform** | Radixile's hosted Nexus. |
| **Organisation (org)** | The business: the billing account and the tenant boundary. `organizations` row. |
| **Workspace** | A brand or client inside an org. Most content belongs to a workspace. |
| **Actor** | Who is acting: a user, a platform staff member (possibly in a support session), or a **system actor** (a scheduler job, webhook or bot) acting for an org. |
| **Scope** | Where a permission applies: `platform`, `org` or `workspace`. |
| **Permission** | A stable key `area.action` (`ACCESS-REQUIREMENTS.md` 5.3), for example `content.publish`; the scope is attached to the grant. |
| **Role** | A named set of permissions for one scope. **System roles** are built in and immutable. **Custom roles** are defined by an org (plan feature). |
| **Feature** | A stable key such as `seo_autopilot` that a plan enables. Permissions and menu items name the feature they need. |
| **Limit** | A number a plan sets. A **count limit** compares with how many exist now (workspaces, seats). A **rate limit** compares with how many were used this period (posts per month, AI credits). A **size limit** is in bytes (storage, file size). |
| **Flag** | A platform switch independent of plans: a kill switch, a rollout percentage, or an org allowlist for betas. |
| **Decision** | The answer from `access.check`: allow or deny with a reason code, a message, and an upgrade or top-up hint. |

---

## 5. The single decision point (policy engine)

### 5.1 Interface
```js
// modules/access/index.js
access.check(ctx, permissionKey, { resource, quantity = 1, bytes = 0 }) -> Decision
access.assert(ctx, permissionKey, opts)       // throws AccessError(decision) on deny
access.middleware(permissionKey, { resource: (req) => ({ type, id }) })   // express
access.explain(ctx)                            // full map for /api/me/access and the menu
```
`ctx` is built once per request (or per job item) by `access.context(req)` and frozen:
```
{ actor: { kind: 'user'|'staff'|'system', userId, staffRole?, supportSessionId? },
  orgId, workspaceId?, orgRole?, workspaceRoleId?, edition, effectivePlan, subscriptionState,
  orgStatus, flags, requestId }
```
`Decision` is:
```
{ allow: boolean, code, message, http: 200|401|402|403|404|429,
  upgrade?: { feature?, limitKey?, planCodes[] }, topup?: { channel },
  limit?: { key, value, used, adding }, retryAfterSec? }
```

### 5.2 Evaluation order (first failure wins; the order is a requirement)
| # | Check | Fails as | Fail mode |
|---|---|---|---|
| 1 | **Identity**: the session exists, the user exists and is not suspended, and the email is verified where the permission requires it (`requiresVerifiedEmail`). | 401 `unauthenticated`, 403 `suspended`, 403 `emailunverified` | closed |
| 2 | **Edition and global kill switch**: the permission's module is available on this edition and is not killed by a platform flag. | 404 `notavailable`, 503 `featureoff` | closed |
| 3 | **Tenancy**: the org and workspace come from the session. A workspace from the header must be one the user belongs to. The `resource` (if any) loads with `org_id = ctx.orgId` and, for workspace-scoped resources, `workspace_id = ctx.workspaceId`. | 404 `notfound` | closed |
| 4 | **Org status**: the platform has suspended the org, which allows only `*.read`, `export.*`, `billing.*` and `account.*`. | 403 `orgsuspended` | closed |
| 5 | **Subscription state** (from billing `access.lockoutDecision`): locked allows only the categories `read`, `export`, `billing`, `account` and `settings.read`. `publish`, `send`, `automate`, `ai`, `create` and `upload` are refused. | 402 `subscriptionexpired` | open on read error |
| 6 | **Feature entitlement**: the permission's `feature` (and the menu item's) is enabled for the effective plan, after org overrides and flag allowlists. | 402 `featurenotinplan` with upgrade plans | open on read error (a cached plan is used) |
| 7 | **Role**: the actor's role in the right scope grants the permission. The org owner has every `org` and `workspace` permission in their org. Staff have their staff-role permissions, and in a support session only that session's mode. System actors get the permissions their job declares. | 403 `forbidden` with `requiredPermission` | closed |
| 8 | **Limits**: if the permission declares `limit` (count or rate) or `bytes`, check `used + quantity <= limit`. Reserve for AI (section 10). | 402 `limitreached` or `quotaexhausted`; 413 `storagefull`; 429 `ratelimited` | open on measurement error |
| 9 | **Rate guard**: abuse speed bumps per user and per org (the existing `aiQuota` and `rateLimit` move here). | 429 | open |

Notes:
- Steps 1–4 and 7 never consult caches older than 5 seconds for **user status and membership**. The existing `platformAdmin.loadUser` 5-second cache is kept. Plan and feature data can be cached for 60 seconds.
- **Step 3 comes before role and plan checks**, so a foreign id always answers 404, whatever role or plan the caller has.
- One request may check several permissions. `explain()` computes them all in one pass for menus.
- Every **deny** at steps 3, 4 and 7 is logged (`[ACCESS_DENY]`, rate-limited) with the actor, org, permission and code, and no data. Repeated 404s from one actor across many ids raise a probe alert.

### 5.2a Versions and caches
- `platform_config.access_version` (global) is incremented by every change to plans, features, flags, menu overrides and system roles. `organizations.access_version` is incremented by every change to that organisation's subscription, overrides, members, roles and custom roles. Both are bumped **in the same transaction** as the change.
- A cached snapshot or permission set is used only while both versions match, so a change applies at once on the server that made it, and within 60 s elsewhere.
- API responses carry `X-Access-Version: <global>.<org>`. The app re-reads `/api/me/access` and `/api/me/menu` when it changes, so menus update without sign-out (this is the menu-version header in 8.2).

### 5.3 Where it is called
- **HTTP:** `access.middleware('content.publish', { resource: req => ({ type: 'post', id: req.params.id }) })` replaces `requirePermission`. The router-level `withWorkspace` becomes `access.context`.
- **Services:** for anything reachable from more than one route, a job or a bot, the service calls `access.assert(ctx, ...)` itself, so a new route cannot skip the check.
- **Scheduler and jobs:** at run time each item builds a **system ctx** for its org (`access.systemContext(orgId, workspaceId, jobKey)`) and checks the job's permission. Publishing a scheduled post re-checks `content.publish` (entitlement and subscription) **at send time**, not only when it was scheduled.
- **Webhooks and bots:** the org is resolved from the verified integration record (for example the WhatsApp number bound to a workspace), never from the payload. They then check through a system ctx.
- **Frontend:** reads `GET /api/me/access` and `GET /api/me/menu` and never decides on its own.

---

## 6. Roles and permissions

### 6.1 Three scopes, separate role sets
| Scope | Assigned in | System roles (immutable) |
|---|---|---|
| **Platform** | `platform_staff` (new table; replaces `users.role` for staff on the server edition) | `super_admin` (everything, including managing staff), `support` (read console, support sessions read-only, cannot change plans), `billing_ops` (plans, prices, overrides, invoices, wallets; no content), `auditor` (read-only console and audit logs; no support sessions) |
| **Org** | `org_members.role_key` | `owner` (exactly one; transfer requires a confirmation and the new owner's acceptance), `admin` (everything except billing and ownership), `billing` (billing and usage only), `member` (sees the org, holds workspace roles only) |
| **Workspace** | `memberships.role_key` | the list in `ACCESS-REQUIREMENTS.md` 5.2 (Workspace manager, Content creator, Approver, Client, Analyst, Sales manager, Sales agent, Support agent, Bot designer, Viewer); today's five map without loss |

- A user may be in many orgs. **Org context is chosen per session** (org switcher) and data is never combined across orgs, including on the dashboard.
- A user's workspace access is **workspace roles ∪ (org owner or admin ⇒ manager-equivalent in every workspace of that org)**. Org `billing` and `member` have no implicit workspace access.
- **Desktop edition:** one implicit org. `users.role = 'admin'` maps to org `owner` and keeps its install-admin powers (licence, users on this install). The platform scope doesn't exist on desktop.

### 6.2 Permission catalogue (registry in code, `modules/access/permissions.js`; keys per `ACCESS-REQUIREMENTS.md` 5.3)
Each entry has these fields:
```
key, scope, module, category (read|create|edit|delete|publish|send|automate|ai|upload|export|billing|admin|account|settings),
feature (entitlement key or null), limit (limit key or null), meter (channel or null),
risk ('low'|'high'), requiresVerifiedEmail, editions ['server','desktop'], description, defaultRoles[]
```
The initial catalogue below is derived from today's routes. The builder confirms it in Phase A0 by walking `routes/*`.

**Customer permission keys (content, social, media, AI, chats, leads, broadcasts, bot, outreach, SEO, ads, workspace, org, billing, account) are listed in `ACCESS-REQUIREMENTS.md` 5.3**, which is canonical. This table keeps only the staff keys it owns:

| Module | Permissions |
|---|---|
| platform (platform scope) | `platform.orgs.view`, `platform.orgs.suspend`, `platform.orgs.delete`, `platform.users.view`, `platform.users.suspend`, `platform.staff.manage`, `platform.plans.manage`, `platform.features.manage`, `platform.flags.manage`, `platform.menu.manage`, `platform.support.read`, `platform.support.write`, `platform.audit.view`, `platform.ai.keys.manage`, `platform.usage.view`, `platform.billing.manage` (billing doc) |

Default role grants are part of the catalogue (`defaultRoles`). Today's `rbac.MATRIX` maps 1:1. Phase A0 proves equality with a characterization test.

### 6.3 Custom roles (Phase R2; plan feature `custom_roles`, **Default** on Agency and Full)
- An org owner or admin creates a workspace-scope role from the catalogue. They may grant only permissions whose `feature` their plan has, and only permissions they hold themselves (no escalation).
- They **cannot** grant `org.*` ownership or billing permissions to a workspace role, or any `platform.*` permission.
- Editing a role takes effect within 5 seconds (cache eviction). Deleting a role in use requires picking a replacement role for its members.
- A downgrade that removes `custom_roles` keeps the roles working read-only. They can still be assigned, but not edited, and they behave as their nearest system role if the owner picks one. **Default:** keep working as defined, and freeze editing.
- Limits: 20 custom roles per org (plan limit `custom_roles`).

### 6.4 Assignment rules
- Only `org.members.manage` holders may change roles. Nobody can change their own role. The last owner cannot be removed or demoted.
- Invitations carry the role and are accepted by the invitee (existing flow). Expired invitations don't count toward the seat limit; pending ones do (**Default**: pending counts, to stop invite spam).
- Seat limit `users` counts **distinct people with any role in the org**, including pending invitations and excluding platform staff in support sessions.

---

## 7. Features, plans and the cross-check

### 7.1 Feature catalogue (`modules/access/features.js`)
| Field | Meaning |
|---|---|
| `key` | Stable feature key, for example `seo_autopilot`. |
| `name`, `description` | Shown on the plan matrix and upgrade prompts. |
| `module` | The module it belongs to. |
| `editions` | Which editions have it. |
| `dependsOn[]` | Other features it needs. |
| `beta` | Whether it is a beta feature. |
| `upgradeCopy` | The text shown when a plan lacks it. |

**The feature list is `ACCESS-REQUIREMENTS.md` 4.1** (canonical, including AI per channel: `whatsapp_bot_ai`, `web_chat_ai`). Its last column maps the keys this section used before (`publishing` and `scheduling` → `social_publishing`, `ai_text` → `ai_writer`, `seo_basic` → `seo_tools`, `sellbird` → `email_outreach`, and so on). Rows in 7.3 use the canonical keys.

### 7.2 Plan matrix (data; owned by the billing doc tables `bill_plan_feature` and `bill_plan_limit`)
- Rows are features and limits; columns are plans (`trial`, `free`, `individual`, `agency`, `full`, plus future plans).
- Values are boolean for features. For limits they are integer, or -1 for unlimited, or bytes for storage.
- **Effective plan** is the billing rule: the highest paid plan covering today. Trial follows the trial plan.
- **Org overrides** (`bill_account_override`) can grant or deny one feature or raise one limit for one org, with validity dates and a reason. They take precedence over the plan.
- **Flags** come last: a kill switch can switch a feature off for everyone, and a beta allowlist can switch it on for named orgs.

**Resolution:** `kill switch off` ⇒ off. Otherwise, an `org override` if one is active. Otherwise the `plan value`. Then `dependsOn` must all be on.

### 7.3 Default plan matrix (seed; editable by super admin; **Defaults to confirm**)
| | trial | free | individual | agency | full |
|---|---|---|---|---|---|
| workspaces | 3 | 1 | 1 | 25 | -1 |
| users (seats) | 5 | 2 | 2 | 10 | -1 |
| seo_sites | 1 | 1 | 1 | 10 | -1 |
| social accounts per workspace | 10 | 3 | 10 | 15 | -1 |
| scheduled posts / month | 300 | 30 | 300 | 3,000 | -1 |
| storage | 2 GB | 500 MB | 5 GB | 50 GB | 200 GB |
| max file (image / video) | 15 MB / 100 MB | 10 / 50 MB | 15 / 200 MB | 15 / 200 MB | 15 / 500 MB |
| AI credits / month | 100 (once for the whole trial) | 20 | 300 | 3,000 | 10,000 |
| contacts (CRM) | 1,000 | 250 | 2,500 | 25,000 | -1 |
| WhatsApp / broadcast messages / month | 0 | 0 | 1,000 | 10,000 | custom |
| custom roles | no | no | no | 20 | 50 |
| seo_autopilot, whatsapp_bot, email_outreach, contact_sync | yes | no | yes | yes | yes |
| ai_video, white_label, api_access | no | no | no | yes / no / no | yes |
| byok | yes | yes | yes | yes | yes |

The first three rows are today's values from `services/entitlements.js`. The rest are proposals to confirm (open decision Q3).

### 7.4 Consistency checker (cross-check; runs at start-up, in tests, and on the plan matrix screen)
It fails a test, or warns on screen, when any of these is true:
1. A permission names a `feature` or `limit` that is missing from the catalogue.
2. A menu item names a permission that doesn't exist, or a feature its permission doesn't share.
3. A plan is missing a value for a catalogued feature or limit. A missing value means deny or zero, and is reported.
4. A feature's `dependsOn` is off while the feature is on in some plan.
5. A route mounted in Express has no declared permission and is not on the public allowlist.
6. A metered permission's channel has no allowance row for some plan.
7. Billing's plan list and the access plan list differ.

**Nightly data cross-checks** (read-only; findings go to the staff dashboard and the daily digest, never auto-fixed):

| Job | Time (IST) | Checks |
|---|---|---|
| `access-consistency` | 04:30 | every organisation has exactly one subscription row; the `organizations` mirror columns match it; no override without a reason or with an end before its start; no member whose role key or role id is missing; exactly one Owner per organisation |
| `over-limit-report` | 04:45 | organisations above a count limit or storage quota after a downgrade or plan edit (the owner is e-mailed once per period with what to do; nothing is deleted) |
| `isolation-check` | 05:00 | rows whose `org_id` differs from their parent's (for example a lead and its contact in different organisations), or from their workspace's organisation |
| `override-expiry` | 00:05 | overrides that ended yesterday: bump the organisation's access version and audit "override ended" |

The super admin plan matrix screen shows these as warnings before saving, plus an **impact preview**: how many orgs gain or lose each changed feature, how many go over a lowered limit, and examples.

### 7.5 Plan change and downgrade behaviour
| Situation | Behaviour |
|---|---|
| A feature is lost | Its menu items show as locked with an upgrade prompt. Data stays. Read access stays for 90 days (**Default**) and export always. Scheduled items that need the feature are **paused, not deleted**, and listed for the owner. |
| A count limit is lowered below current use | Nothing is deleted. Creating more is refused until under the limit. The owner sees "6 of 3 workspaces: archive 3 to add new ones". Archived workspaces are read-only and don't count. |
| A rate limit is lowered | Applies from the next period unless super admin ticks "apply now", which never goes below what is already used (billing rule). |
| Storage limit below current use | Uploads are refused (413 `storagefull`). Nothing is deleted. The usage screen lists the largest files to clean up. |
| An upgrade | Takes effect immediately on payment. Caches are evicted. |

---

## 8. Menu management

### 8.1 Menu registry (`modules/access/menu.js`, data in code with overrides in the database)
```
{ id: 'seo-autopilot', group: 'grow', label: 'menu.seoAutopilot', icon: 'seo', page: 'seo', order: 40,
  permission: 'seo.view', feature: 'seo_autopilot', editions: ['server'], whenLocked: 'show-locked'|'hide',
  badge?: 'beta'|'new', children?: [...] }
```
- Every `data-page` in `public/index.html` (about 36 today, plus the Lead Ads sub-menu) becomes a registry item. **Nothing in the sidebar is hard-coded after Phase B1b.**
- `whenLocked` sets what happens when access is denied. If the plan lacks the **feature**, `show-locked` shows a lock and an upgrade prompt, which helps selling. If the **role** lacks the permission, the item is always hidden: people never see what their role cannot use.
- **Admin overrides** (`menu_override` table, super admin) change things without a deploy:
  - per item: hidden globally, label override, order, group, badge;
  - per plan: hidden on a plan.
  - Overrides can only hide or reorder; they never grant access, because access comes from section 5.
- **Org-level customisation (Default: not now):** an org owner could hide items for their team. Left for later.

### 8.2 API and rendering
- `GET /api/me/menu` returns the filtered tree for the active org and workspace: `[{id, label, icon, page, state: 'enabled'|'locked', lockReason?, upgrade?, badge, children}]`. Cache key: (user, org, workspace, plan version, menu version), 60 seconds.
- The frontend renders the sidebar from this response. `navigateTo(page)` refuses pages not in the enabled set and shows the locked or upgrade panel instead. Deep links are handled the same way.
- Workspace switch or plan change refreshes the menu. There is also a `menu-version` header on API responses, so a stale menu refreshes itself.
- The **staff console menu** comes from the same registry, with platform-scope items.

---

## 9. Super admin (platform staff)

### 9.1 Staff identity
- `platform_staff(user_id unique, role, active, mfa_required true, added_by, added_at, removed_at)`. On the server edition, staff status comes **only** from this table. `PLATFORM_ADMIN_EMAILS` remains a bootstrap path: on start, listed and verified emails are inserted as `super_admin` if missing, and this is logged. `users.role` stops granting anything on the server edition.
- **MFA required for staff** (TOTP) before any platform permission works (**Default**; open decision Q5).
- Staff sessions expire after 12 hours of inactivity (customers: 7 days, as today).

### 9.2 Platform console (all orgs, aggregated by default)
| Screen | Shows | Needs |
|---|---|---|
| Overview | Orgs by plan and state, trials ending, MRR (billing), AI cost this month, storage total, error and deny rates. | `platform.orgs.view` |
| Organisations | Searchable list with plan, status, seats used/limit, workspaces, storage used/limit, AI credits used/limit, last activity, flags, health. | `platform.orgs.view` |
| Org 360 | Profile, owner, members (names and roles; emails masked for `auditor`), subscription and invoices (billing doc), usage (all meters), overrides, flags, support history, audit trail. **No content** (posts, contacts, messages) unless in a support session. | `platform.orgs.view` |
| Org health (tab of Org 360) | **Connections:** WhatsApp number state (Cloud API token valid, Evolution connected), last webhook received, website chat last used, social accounts with expired tokens, SMTP. **Chatbot:** replies in 24 h, AI errors by reason (quota, key, provider), chats waiting for a person, paused chats. **Delivery:** failed posts, broadcasts and e-mails with the provider's reason; SEO autopilot failures. **Access:** `featurenotinplan` and `limitreached` denials in 30 days (what users tried and couldn't do). **Errors:** last 100 log errors tagged with this `org_id` (ids only). Badge: green, amber or red. | `platform.orgs.view` |
| Users | Cross-org user directory with orgs and roles, status, last login, MFA; suspend or unsuspend; force password reset; sign out everywhere. | `platform.users.view` / `.suspend` |
| Plans and features | Plan matrix editor (7.2) with impact preview and consistency warnings. | `platform.plans.manage`, `platform.features.manage` |
| Flags | Kill switches, rollouts, beta allowlists. | `platform.flags.manage` |
| Menu | Registry view with overrides. | `platform.menu.manage` |
| Usage | AI (by org, feature, model, cost), storage (by org), messages, posts; top consumers; anomalies. | `platform.usage.view` |
| Staff | Add or remove staff and roles, MFA status. | `platform.staff.manage` (super_admin only) |
| Audit | Platform audit with filters and export. | `platform.audit.view` |
| Support sessions | Active and past sessions. | `platform.support.read` |

### 9.3 Support access (replaces "platform admin silently acts as manager")
- A staff member opens **Support access** on an org: they choose a reason (free text, at least 10 characters, plus an optional ticket reference), a mode (`read`, or `write` if they have `platform.support.write`), and a duration (15–120 minutes, default 60).
- Org setting `support_access_policy`:
  - `allowed`: the session starts at once and the owner is notified.
  - `approval`: the owner gets a request and approves it.
  - `blocked`: staff cannot enter; only an emergency `super_admin` override with a second reason, flagged in audit.
  - **Default:** `allowed`, with notification.
- During the session the staff member acts **in that org only**, with the session's mode as their permission set. A red banner names the org and the time left. Every request carries `supportSessionId` and is audited. Payments, plan changes, ownership transfer and member deletion are **never** possible in a support session; they go through the staff console's own audited actions.
- **Read mode excludes revealing secrets:** no integration tokens, no API keys, and no AI key values.
- The org owner sees a "Support access" log in their settings: who, when, why, mode, duration, and the number of actions.
- Sessions end at expiry, or when the staff member or org owner ends them. A job closes stale sessions.

### 9.4 Org-level platform actions
- **Suspend org** (`platform.orgs.suspend`) needs a reason. Members can log in, view, export and pay; everything else is refused (step 4). Unsuspend needs a reason too.
- **Delete org** (`platform.orgs.delete`, super_admin only) uses two-step confirmation and a 30-day soft delete, then a purge job. The purge removes files and rows by org id, and billing records are kept as the law requires.
- **Plan and override changes** go through billing staff endpoints and are audited.

---

## 10. Usage limits

### 10.1 One limit framework
| Type | Examples | Source of "used" | Check |
|---|---|---|---|
| **Count** | workspaces, seats (`users`), `human_agents`, `ai_agents`, seo_sites, social accounts, `whatsapp_numbers`, `web_chat_sites`, contacts, custom roles, bio pages, RSS feeds | live `COUNT(*)` scoped to the org (cached 30 seconds; evicted on create or delete) | at create, `used + adding <= limit` |
| **Rate (period)** | scheduled posts per month, AI credits per month, messages per month, emails per month | `usage_counter(org_id, metric, period_start)` incremented atomically | reserve or check at the action |
| **Size** | storage bytes, max file bytes | `org_storage(org_id, bytes_used)` plus the per-file limit | at upload, before accepting the body |
| **Speed** | AI calls per minute per user, API requests per minute | in-memory buckets (existing) | per request |

- **Limit catalogue** (`modules/access/limits.js`) lists, for each limit: key, type, unit, how to measure, period (`month`, IST calendar), and `blocks` (true = hard refuse; false = warn only). It also sets the 80% and 100% notice thresholds.
- **Customer screen "Usage"** (org scope, `org.usage.view`) shows every limit with used, limit, bar, reset date and what to do. The **dashboard** shows a compact strip of anything above 80%.
- **Notices:** at 80% and 100%, once per period per limit, by email to the owner and the billing role, and in-app. Dedupe key `LIMIT:{org}:{key}:{period}:{80|100}`.
- **The checks go through `access.check` step 8.** Counting code is shared with the usage screen, so the two never disagree.

### 10.2 AI usage limits (in detail)
Builds on billing doc section 5.9, "AI credits as a channel".
1. **Unit:** AI credits. Each feature has a credit price, effective-dated and editable by super admin. **Defaults:**
   - text generation, 1 credit;
   - assistant answer, 1;
   - knowledge-base answer, 1;
   - image generation, 5;
   - image edit, 3;
   - video generation, 50 (per 5 seconds);
   - SEO page analysis, 1 per page;
   - bot reply on a platform key, 0.2, billed per 5 replies (stored as 1 credit per 5).
   Customers see credits only, never tokens.
2. **Key sources** (existing `injectUserKeys` order):
   - **Platform key (Radixile's):** metered against credits, needs a verified email, and is subject to every cap below.
   - **Org shared key or user's own key (BYOK, feature `byok`):** **not charged credits**, but still counted for visibility and still under the speed guard (to protect the org's own bill), with no monthly cap.
   - An org may choose `platform`, `own` or `auto` (existing `aiSource`).
3. **Caps (all per IST period):**
   - Org monthly allowance comes from the plan, plus top-ups (billing grants).
   - Org daily cap stops one day burning the month. **Default:** max(20, 25% of the monthly allowance).
   - Per-user daily cap stops one member burning the org's credits. **Default:** 50% of the org's daily cap, adjustable by the org owner within that.
   - Speed: 20 a minute per workspace (existing), plus 10 a minute per user.
   - Bot replies have their own daily cap (existing 500, now per plan). Beyond it the bot sends the plain reply (existing behaviour).
   - **Platform cost cap:** a monthly INR ceiling across all orgs on platform keys (super admin setting). Near the ceiling, staff get an alert. At the ceiling, platform-key AI pauses for orgs over 100% of allowance first, then for all, with a clear message. BYOK continues.
4. **Sequence:** reserve, then call, then settle or release (billing doc). No credits are charged for errors, refusals, empty or invalid output, or timeouts. A repeat of the same input within 7 days costs 0. Reservations older than 15 minutes expire.
5. **Model tiers:** plan feature `ai_premium_models` allows the stronger models. Without it, requests are routed to the default model and the UI says so. Video and image models need `ai_image` or `ai_video`.
6. **Visibility:**
   - **Org Usage tab:** credits used and remaining, by feature, by member, by day, plus the top-up button.
   - **Staff:** cost versus credits sold by feature and model (margin), and anomaly detection when an org exceeds 5× its 7-day average.
7. **Persistence replaces `services/aiQuota.js` counters for credits.** The in-memory speed bumps stay for per-minute protection.
8. **Safety:**
   - The AI context for an org contains only that org's data. Knowledge-base retrieval filters by `org_id` and `workspace_id` **in the query**, never after.
   - Prompts and outputs are not logged in full on the platform. Hashes and token counts only (**Default**).

### 10.3 Storage limits (in detail)
1. **What counts**, per org:
   - media library files (`media_assets.size`);
   - CRM and Sellbird attachments;
   - knowledge-base source files;
   - bio page images;
   - brand kit files;
   - email campaign assets;
   - generated images and videos saved to the library.

   **Not counted:**
   - backups (platform-run);
   - temporary exports (deleted after 24 hours);
   - platform-hosted copies such as `fb_hosted_photos`.

   Every stored file is registered in **one table**, `stored_file(org_id, workspace_id, kind, key, bytes, sha256, created_by, created_at, deleted_at)`. Modules call `files.put()` and `files.delete()` from the files service. No module writes to disk or S3 directly (enforced by a test).
2. **Counter:** `org_storage(org_id, bytes_used, files_count, updated_at, recomputed_at)` is updated in the same transaction as `stored_file` insert or delete, with atomic `+`/`-`. A **nightly reconciliation** recomputes from `stored_file` and from the actual files (sizes). It corrects drift and logs it. A missing file is reported, not silently removed.
3. **Check at upload:**
   1. Before reading the body, compare the `Content-Length` with the per-file limit and the remaining quota.
   2. While streaming, abort the upload past the declared or limit size.
   3. After writing, register the file and increment the counter.
   4. If the increment would exceed the limit because two uploads raced, accept the file (small overrun) and block the next upload. **Default:** at most one file's worth of overrun.
   - Two decision codes: 413 `filetoolarge` for one file over its limit, and 413 `storagefull` for the quota.
4. **Deletion and trash:** deleted files stay in trash for 30 days and **still count**. Purge frees space. Users can empty the trash themselves.
5. **Dedupe (Default: off):** identical files in one org are stored once, by sha256. The counter counts logical bytes (what the customer uploaded), not physical bytes, so the customer's number is predictable.
6. **Paths:** files live under `{org_id}/{workspace_id}/{kind}/{random}`. The files service refuses any key outside the caller's org prefix. Signed URLs expire after 15 minutes. Public assets such as bio pages are published through a separate, explicitly public path.
7. **Screens:**
   - **Org Usage:** a storage bar, a breakdown by workspace and kind, the largest files, trash, and the 80% and 100% notices.
   - **Staff:** storage per org, growth, and orphans.

### 10.4 Other count and rate limits
- **Scheduled posts per month:** counted at **schedule time**, and released if deleted before sending (**Default**). Over the limit, scheduling is refused and drafts are still allowed.
- **Contacts:** count limit. CSV import checks the total before importing and imports nothing if it would exceed the limit, showing how many would fit (**Default**: all or nothing).
- **Messages (WhatsApp, broadcast, email):** rate limits, metered per billing doc 5.9, starting COUNT_ONLY.
- **Social accounts per workspace:** count limit at connect time.

---

## 11. Organisation isolation (no cross-org data sharing)

### 11.1 Rules
1. **Every tenant table has `org_id NOT NULL`** (billing tables name it `account_id`, which is the same value and gets the same rules), and `workspace_id` where the row belongs to a workspace. This is denormalised on purpose, so every query can filter by org directly, and a composite index starts with `org_id`.
2. **Every tenant query goes through a scoped repository**: `repo.forCtx(ctx)` returns a query builder that already has `where org_id = ctx.orgId`, and `workspace_id` for workspace-scoped tables. **Raw `knex('<tenant table>')` outside `repos/` is forbidden**, enforced by a lint test that scans for tenant table names.
3. **Insert sets `org_id` from ctx**, never from input. Update and delete always include `org_id` in the WHERE clause and check that exactly one row changed. Zero rows means 404.
4. **Ids from input are pointers** resolved through the scoped repository (section 5.2, step 3).
5. **Joins** between tenant tables join on `org_id` too.
6. **Global (platform) tables** are explicitly listed and read-only for customers. Examples: `help_knowledge`, festivals, plan catalogue, `platform_config`.
7. **Caches** are keyed by `org_id`. Any module-level `Map` holding tenant data is reviewed in T1.
8. **Background jobs** iterate per org with a system ctx. One org's failure never stops the loop, and logs carry `org_id`.
9. **Webhooks** resolve the org from a verified binding: a signature plus a registered id such as a phone number id, page id or form id. A payload that names an org or workspace is ignored.
10. **Files** follow section 10.3, item 6.
11. **Exports and backups:** an org export contains only that org. Platform backups are platform-only.
12. **AI:** prompts, knowledge-base retrieval, embeddings and conversation memory are scoped by org and workspace in the query. There is no shared vector index without an org filter. Platform AI logs never feed another org.
13. **Search and analytics** are aggregated per org only. Platform analytics are aggregates with no content.
14. **Email and notifications:** recipients are resolved inside the org. A member of org A never receives org B's notices, even if they also belong to B and B is not the active context.
15. **Multi-org users:** the session has one active org. Switching re-builds the ctx, menus and caches. The UI never shows two orgs' data together. Notifications name the org.
16. **Logs:** application logs may carry `org_id` and ids, but never customer content. Staff log viewers never show content.

### 11.2 Migration of existing data (Phase T1)
- Add `org_id` to every workspace-scoped table and backfill it from `workspaces.org_id`. Backfill the legacy `user_id` tables from their `workspace_id` (set by `tenancy_core`). Rows with no workspace are **reported, not guessed**. The migration lists them, and the owner decides: attach them to the user's first org, or archive them.
- Add a `NOT NULL` constraint after the backfill, and indexes `(org_id, workspace_id, ...)`.
- Keep reading by `workspace_id` during the transition. Switch repositories to `forCtx` table by table, each with an isolation test.

### 11.3 Defence in depth: Postgres row-level security (Phase T2, server edition only, optional)
- Enable RLS on tenant tables with the policy `org_id = current_setting('app.org_id')::int`. Every transaction sets `app.org_id` from ctx. The system role for migrations and staff aggregates is `BYPASSRLS` and is used only by explicitly marked code.
- It ships after T1 is complete, behind `ACCESS_RLS_ENABLED`, first in **audit mode**: it logs a would-be violation instead of failing, for 2 weeks.
- SQLite (desktop) has no RLS. Desktop is single-org, so the risk is low.

---

## 12. Data model (new or changed; knex migrations, both databases)

| Table | Columns | Notes |
|---|---|---|
| `platform_staff` | id, user_id unique, role, active, mfa_required, added_by, added_at, removed_at | replaces `users.role` for staff on the server edition |
| `user_mfa` | user_id, totp_secret_enc, enabled_at, recovery_codes_hash | staff required, customers optional (later) |
| `access_role` | id, org_id null (null = system), scope, key, name, description, system bool, archived_at, created_by, updated_at | custom roles have an org_id |
| `access_role_permission` | role_id, permission_key; unique(role_id, permission_key) | system roles are seeded from the catalogue, read-only |
| `org_members` (alter) | + `role_key` (owner/admin/billing/member), + `status`, + `invited_by` | migrate `role` to `role_key` |
| `memberships` (alter) | + `role_id` (FK access_role), keep `role` during transition | |
| `organizations` (alter) | + `status` (active/suspended/deleted), `suspended_at`, `suspended_reason`, `deleted_at`, `support_access_policy`, `ai_source_default` | |
| `feature_flag` | key, kind (kill/rollout/beta), enabled, percent, note, updated_by, updated_at | |
| `feature_flag_org` | flag_key, org_id, enabled, reason | beta allowlist and per-org kill |
| `menu_override` | item_id, plan_code null, hidden, label, order, group, badge, updated_by | |
| `support_session` | id, staff_user_id, org_id, reason, ticket_ref, mode, status, started_at, expires_at, ended_at, ended_by, approved_by, actions_count | |
| `access_audit` | id, at, actor_kind, actor_user_id, org_id, support_session_id, action, target_type, target_id, old_value, new_value, reason, request_id | append-only, retained 2 years (**Default**) |
| `usage_counter` | org_id, metric, period_start, value, updated_at; unique(org_id, metric, period_start) | rate limits (posts per month and so on); AI and messages use billing tables |
| `org_storage` | org_id unique, bytes_used, files_count, updated_at, recomputed_at | |
| `stored_file` | id, org_id, workspace_id, kind, storage_key unique, bytes, sha256, mime, created_by, created_at, deleted_at, purged_at | the single file registry |
| `limit_notice` | org_id, limit_key, period_start, threshold, sent_at; unique | dedupe for 80% and 100% notices |
| all tenant tables (alter) | + `org_id NOT NULL`, index | section 11.2 |

The plan catalogue, features, limits, overrides, subscriptions, AI requests, grants and quota periods are **in the billing doc** (section 6) and are not duplicated here.

---

## 13. APIs

### 13.1 Customer
| Method and path | Purpose | Permission |
|---|---|---|
| `GET /api/me/access` | ctx summary: user, active org and workspace, org role, workspace role, effective plan, subscription state, permissions (keys allowed), features (on, off or locked), limits (`{key, used, limit, unit, resetsOn}`), banners | logged in |
| `GET /api/me/menu` | filtered menu tree | logged in |
| `POST /api/me/active-org` `{orgId}` | switch org (must be a member) | logged in |
| `GET /api/org/usage` | every limit with used and limit, AI by feature and member, storage breakdown | `org.usage.view` |
| `GET /api/org/usage/storage/largest` | largest files | `org.usage.view` |
| `GET/POST/PUT/DELETE /api/org/roles` | custom roles | `org.roles.manage` |
| `GET /api/org/permissions` | the catalogue filtered to what the org's plan has (for the role editor) | `org.roles.manage` |
| `GET/PUT /api/org/members/{userId}` | change org role and workspace roles | `org.members.manage` |
| `GET /api/org/audit` | org-visible audit (role changes, support sessions, settings) | `org.audit.view` |
| `GET/PUT /api/org/support-access` | policy, plus the list of past and active sessions; approve or end | `org.support_access.manage` |
| `POST /api/org/ownership/transfer` | start a transfer (the new owner accepts) | `org.ownership.transfer` |
| `GET /api/org/ai-settings`, `PUT` | key source, per-user daily cap | `org.settings.manage` |

### 13.2 Staff (`/api/platform/...`)
| Method and path | Purpose |
|---|---|
| `GET /orgs`, `GET /orgs/{id}` | console list and Org 360 |
| `POST /orgs/{id}/suspend`, `/unsuspend`, `/delete`, `/restore` | org status changes |
| `GET /users`, `POST /users/{id}/suspend`, `/unsuspend`, `/signout`, `/reset-password` | user directory and user actions |
| `GET/POST/DELETE /staff` | staff management |
| `GET/PUT /plans/matrix`, `POST /plans/matrix/preview` | plan matrix (uses billing tables) |
| `GET/PUT /flags`, `PUT /flags/{key}/orgs/{orgId}` | flags and per-org flags |
| `GET/PUT /menu` | menu overrides |
| `POST /support-sessions` `{orgId, reason, mode, minutes, ticketRef}`, `POST /support-sessions/{id}/end`, `GET /support-sessions` | support access |
| `GET /usage/ai`, `/usage/storage`, `/usage/limits` | usage views |
| `GET /audit` | platform audit |
| `GET /consistency` | checker output (7.4) |

### 13.3 Error codes (stable; the UI maps them to text)
- 401: `unauthenticated`
- 403: `suspended`, `emailunverified`, `orgsuspended`, `forbidden`, `mfarequired`, `supportreadonly`
- 404: `notfound`, `notavailable`
- 402: `subscriptionexpired`, `featurenotinplan`, `limitreached`, `quotaexhausted`
- 413: `filetoolarge`, `storagefull`
- 429: `ratelimited`, `aidailycap`, `aiusercap`
- 503: `featureoff`, `aiplatformpaused`
- 409: `lastowner`, `roleinuse`, `selfrolechange`, `escalation`

---

## 14. Screens

### 14.1 Customer (mobile first, 360 px)
- **Sidebar** from `/api/me/menu`. A lock icon on plan-locked items opens an upgrade sheet naming the plan that unlocks the item.
- **Org switcher** in the header, for users in several orgs.
- **Settings → Team:** members, org role, workspace roles per workspace, and invitations with the seat counter.
- **Settings → Roles** (`custom_roles`): list, create from a system role, a permission picker grouped by module (only plan-available permissions; others shown greyed with "in Agency plan"), and members using each role.
- **Settings → Usage:** all limits, the AI tab, the storage tab, the reset date and the top-up or upgrade buttons.
- **Settings → Security:** support access policy and log, audit log, sign-out-everywhere.
- **Banners:** subscription state (billing), org suspended, support session active ("Radixile support is viewing this account until 14:30"), and over 80% of a limit.
- **Empty and locked states** on every gated page, explaining why and what to do.

### 14.2 Staff console
The screens in 9.2, with a support session banner and timer, and a two-step confirm for suspend, delete and staff changes.

---

## 15. Audit and observability
- **Two audit tables, one screen.** Billing owns `bill_audit` for what lives in billing tables: plans, plan features and limits (the plan designer), prices, coupons, tax, overrides, subscriptions, invoices, payments and wallet. `access_audit` records everything else below. The staff Audit screen and the org audit view read both, merged by time.
- `access_audit` records:
  - every role change, custom role edit, member add or remove, and ownership transfer;
  - org suspend, unsuspend and delete;
  - feature flags and kill switches;
  - menu overrides;
  - support session start and end, and every write in a support session;
  - staff changes;
  - AI key source changes, and storage purge.
- Customer-visible subset: anything about their org except internal staff notes.
- Metrics:
  - deny rate by code;
  - 404 probe alerts;
  - `access.check` latency (p95 under 5 ms with warm caches);
  - cache hit rate;
  - AI credits and cost per hour;
  - storage drift found by reconciliation;
  - consistency checker warnings.
- Logs use tags `[ACCESS]`, `[ACCESS_DENY]`, `[SUPPORT]`, `[USAGE]`, `[STORAGE]` and `[AI_METER]`, with ids only.

---

## 16. Phases (ids match `docs/billing/PLAN.md`; S0, T1, T2, L1, L2 and P1 are added by this document; combined order in `docs/platform/ROADMAP.md`)

Every phase ships on its own, with migrations first, a version bump, release notes, a changelog entry and the tests listed. Each "Done when" is mandatory.

### S0 Safety net and urgent fixes (small; first)
- **Scope:**
  - **Verify on production:** list users with `users.role IN ('admin','superadmin')` and any `PLATFORM_ADMIN_EMAILS` entries. Confirm none is a customer.
  - **Fix the platform-admin path:**
    - make `ensureAdmin` a no-op on the server edition;
    - gate every `/admin/*` route that lists or changes users across orgs with super admin;
    - keep the desktop behaviour.
  - Stop reading `workspaceId` from the request **body** in `withWorkspace`. Only the header, route param and session remain.
  - **Route inventory test:** enumerate the Express router stack and fail on any route without auth plus a permission or a public allowlist entry. It starts with a recorded baseline list of exceptions to burn down.
  - **Two-org isolation harness:** fixtures with orgs A and B, each with a workspace, a post, a contact, a media file and an SEO site. For every GET, PUT and DELETE route with an id, call as A with B's id and expect 404 or 403. Record the current failures as a baseline (do not fix them in S0).
- **Done when:**
  - production is verified;
  - `/admin/users` returns 403 for non-super-admin;
  - the inventory and isolation tests run in CI with a baseline;
  - nothing else changes.

### A0 Permission catalogue and policy engine (medium)
- **Scope:**
  - `modules/access/` with the catalogue (6.2), `context()`, `check()`, `assert()`, `middleware()` and `explain()`, with steps 1–3, 4 (status column added, all active), 7 and 9.
  - Steps 5, 6 and 8 call **today's** `services/entitlements.js` through an adapter.
  - Replace `requirePermission` everywhere with `access.middleware`, keeping behaviour identical.
  - Platform admin bypass stays for now, but every bypass is logged to `access_audit` as `legacy_staff_bypass`.
- **Tests:**
  - characterization: for every role × action, old `rbac.can` equals new `check`;
  - inventory baseline shrinks;
  - latency budget.
- **Done when:** every route uses `access.*`; there are no direct `rbac.can` calls; behaviour is unchanged.

### T1 Tenancy hardening (large; split by module)
- **Scope:**
  - add `org_id` to all tenant tables (11.2), backfill it, apply `NOT NULL`, and add indexes;
  - scoped repositories (`forCtx`);
  - raw-knex lint test;
  - resource resolution in step 3 for every route with an id;
  - jobs and webhooks use system ctx;
  - cache review;
  - file paths prefixed by org (for local disk too).
- **Order:** content and posts, then media, leads/CRM/Sellbird, inbox, SEO, email, bio/tools, legacy user tables.
- **Done when:**
  - the isolation harness baseline is **empty**;
  - the lint test passes;
  - the orphan-row report has been resolved with the owner.

### B1a Features and entitlements, single entry point (medium; with billing B0/B1)
- **Scope:**
  - feature catalogue (7.1);
  - plan matrix in billing tables, seeded from `DEFAULT_PLANS` plus 7.3 after confirmation;
  - steps 5 and 6 read billing's effective plan and access decision;
  - overrides and flags (`feature_flag`, `feature_flag_org`);
  - consistency checker (7.4) as a test and at start-up;
  - `GET /api/me/access`;
  - `services/entitlements.js` becomes a thin wrapper over `access` with the **same return shape**.
- **Done when:**
  - characterization shows the old `decide()` and `limitProblem()` outputs match;
  - the consistency checker is green;
  - a super admin flag kills a feature within 60 seconds in a test.

### B1b Menu registry (medium)
- **Scope:**
  - registry for all sidebar items and sub-menus;
  - `GET /api/me/menu`;
  - frontend sidebar rendered from the API;
  - `navigateTo` guard and locked pages;
  - `menu_override` with the staff screen;
  - consistency rules 2 and 5.
- **Done when:**
  - every `data-page` is in the registry;
  - for each system role × plan, a snapshot test of the menu matches the expected table;
  - a manual check covers phone and desktop.

### R1 Platform staff and support access (large; console screens are in S1)
- **Scope (split per `ROADMAP.md`; R1 also delivers the role catalogue v2 of `ACCESS-REQUIREMENTS.md` 5.1–5.5):**
  - `platform_staff` with `super_admin` only, and a bootstrap from `PLATFORM_ADMIN_EMAILS`;
  - staff MFA;
  - the legacy bypass is removed, and support sessions replace it (9.3);
  - org policy and log for support access;
  - org suspend and resume.

### S1 Staff console and organisation health (medium; after R1)
- **Scope:**
  - console screens 9.2 (overview, organisations, Org 360 with the Health tab, users directory, audit, support sessions, jobs), except usage, which comes in L1 and L2;
  - staff roles `support`, `billing_ops`, `auditor`;
  - org delete with the 30-day soft delete and purge;
  - `access_audit` screens and the daily staff digest.
- **Done when:** each staff role sees only its screens; Org 360 shows no content outside a support session; a broken test integration turns the health badge red with its reason.
- **Done when:**
  - staff cannot touch org content without a session;
  - a read session cannot write;
  - a session cannot pay, change plan or transfer ownership;
  - the owner sees the log;
  - a suspended org can still view, export and pay.

### L1 Limits framework and storage (medium)
- **Scope:**
  - limit catalogue;
  - `usage_counter`;
  - count limits through step 8;
  - `stored_file` registry and the files service (all modules move to it);
  - `org_storage` counter, upload checks, trash, the reconciliation job;
  - Usage screen (count, rate and storage);
  - 80% and 100% notices;
  - staff storage view;
  - downgrade behaviours from 7.5 for counts and storage.
- **Ships with:** storage enforcement **warn-only** for 2 weeks (`ACCESS_STORAGE_ENFORCE=false`). The counter is compared with the reconciliation, then enforcement is switched on.
- **Done when:**
  - concurrent uploads near the limit overrun by at most one file;
  - reconciliation drift is 0 on a copy of production;
  - no module writes files outside the files service (test).

### L2 AI usage limits (medium; with billing B6/B7 AI part)
- **Scope:**
  - credit prices;
  - reserve, settle and release on every AI path (`aiHelper`, `platformAi`, `aiAssist`, `helpAssistant`, knowledge base, SEO, image and video, bots);
  - org daily cap, per-user cap and platform cost cap;
  - BYOK counted but not charged;
  - model tiers;
  - AI tab on Usage;
  - staff AI usage and margin;
  - KB retrieval scoped in the query.
- **Ships with:** count-only for a month (`BILLING_AI_ENABLED` metering on, enforcement off). Then enforce per plan.
- **Done when:**
  - every AI call path is metered (a test lists the providers' call sites and fails on an unmetered one);
  - a crash between reserve and settle charges nothing;
  - the platform cost cap pauses only platform-key calls.

### R2 Custom roles and team management (medium)
- **Scope:** section 6.3–6.4, with role editor, member editor, ownership transfer and the org audit view.
- **Done when:**
  - escalation tests pass (cannot grant what you don't hold, or what the plan lacks);
  - last-owner rules hold;
  - edits take effect within 5 seconds.

### P1 Plan matrix admin and downgrade handling (medium; with billing B5)
- **Scope:**
  - staff plan matrix editor with impact preview and consistency warnings;
  - downgrade handling for features (paused schedules list, read-only period) and over-limit archiving UI;
  - upgrade sheets everywhere.
- **Done when:** a downgrade scenario script (agency to individual with 6 workspaces, 3 GB storage, custom roles and SEO autopilot) behaves as table 7.5.

### T2 Postgres RLS defence in depth (optional, small to medium)
- **Scope:** section 11.3, audit mode, then enforce.
- **Done when:** 2 weeks of audit mode show zero would-be violations, then enforcement is on, with a kill switch.

---

## 17. Open decisions (recommended default first)

| # | Question | Recommended default |
|---|---|---|
| Q1 | Build access as part of the billing module or separate? | A separate `modules/access/` that reads billing through a port, so each can be reused in other products |
| Q2 | Platform admins acting inside orgs | Support sessions only (9.3); remove the silent bypass in R1 |
| Q3 | Default plan matrix (7.3) | As proposed; confirm the storage, AI credits and contacts numbers |
| Q4 | Support access policy default for new orgs | `allowed` with notification to the owner |
| Q5 | MFA | Required for staff; optional for customers (later, plan feature) |
| Q6 | Locked menu items | Show locked items with an upgrade prompt for plan reasons; hide for role reasons |
| Q7 | Pending invitations count toward seats | Yes |
| Q8 | Downgrade read-only window for lost features | 90 days, export always |
| Q9 | Trash counts toward storage | Yes, 30 days |
| Q10 | BYOK charged credits | No; counted and rate-limited only |
| Q11 | Per-user AI cap | 50% of the org daily cap by default, adjustable by the owner |
| Q12 | Custom roles plans | Agency (20) and Full (50) |
| Q13 | Postgres RLS | Yes, after T1, audit mode first |
| Q14 | Audit retention | 2 years |
| Q15 | Org-level menu customisation by owners | Not now |
| Q16 | Orphan legacy rows with no workspace (T1) | Report, then the owner decides per row group |

---

## 18. Risks
| Risk | Mitigation |
|---|---|
| T1 touches every query; regressions | Isolation harness, table-by-table switch, characterization tests, one module per release |
| A wrong plan seed blocks paying customers | B1a ships with characterization (same as today); new limits arrive in L1/L2 as warn-only first |
| Menu from the API makes the app depend on one call | Cache the last menu in local storage; on failure show the cached menu with a retry; the server still guards every API |
| Staff lock themselves out (MFA, staff table) | Bootstrap from `PLATFORM_ADMIN_EMAILS` plus a documented recovery CLI on the server |
| Storage counter drift | Transactional increments plus nightly reconciliation plus warn-only period |
| AI cost spike from one org | Org daily cap, user cap, platform cost cap, anomaly alert |
| Performance of `access.check` | Precomputed permission sets per (role, plan version); 60 s caches; p95 under 5 ms test |
