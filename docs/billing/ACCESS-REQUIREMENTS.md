# Features, plan designer, roles and data scope: requirements

**What this document owns** (per section 0 of `docs/platform/ACCESS-AND-ENTITLEMENTS.md`):
- the **feature catalogue** (section 4.1);
- the **plan designer** and on-the-fly plan changes (4.2, 4.3);
- add-ons (4.4);
- the **role catalogue and hierarchy** (5.1, 5.2, 5.5);
- the **permission key format and list** (5.3);
- **data scope** (5.4);
- **AI sales agents** (5.6);
- **teams and routing** (5.7);
- **custom roles** (5.8);
- decisions A1–A12 (section 15).

**What it does not own (read the platform document):**
- the decision engine and its order (platform 5);
- tenancy and isolation (platform 11);
- platform staff, the Super Admin console and support sessions (platform 9);
- menu management (platform 8);
- usage limits for AI, storage and counts (platform 10);
- the consistency checker (platform 7.4);
- APIs and data model for those topics (platform 12, 13).

**Money:** see `REQUIREMENTS.md`. **Build order:** see `docs/platform/ROADMAP.md`.

**Status:** requirements only; nothing is built. **Section numbers are stable**, because other documents cite them.

---

## 1. What the owner must be able to do

Design any plan as any combination of features. The app grants and denies access to match, with an upgrade prompt
wherever a feature is missing, and the menu follows automatically.

| Plan the Super Admin designs | Features on |
|---|---|
| "Ads only" | Advertising: `ad_copy`, `meta_lead_ads`, `meta_reports`. Nothing else. |
| "Website AI chat" | `web_chat` + `web_chat_ai` (+ `ai_knowledge_base`). No WhatsApp bot. |
| "Chatbots, no AI" | `whatsapp_chats`, `whatsapp_bot`, `web_chat`. No `*_ai`. |
| "WhatsApp suite" | WhatsApp chats, broadcasts, templates, bot with AI. No social publishing. |
| "Agency" | Everything, 25 workspaces, 10 seats, custom roles. |
| Private plan for one client | Any mix, not on the price list, priced by quote. |

And, without touching the plan, give one organisation a feature or a higher limit for a while, with a reason and an end date (an override).

---

## 2. Tenancy (summary; the rules are in platform section 11)

Organisation (tenant, billing account) → workspaces (brand, client, branch) → members with roles. **Multi-org chatbots:**
each workspace has its own WhatsApp bot, website chat (its own token and look), knowledge base, persona and AI agents. A
bot answers only from its own workspace's data. AI runs on the organisation's own key, or on Radixile's platform keys
metered per organisation (platform 10.2). No data is ever shared between organisations.

---

## 3. The access decision (summary; the engine is platform section 5)

Every "may this happen?" goes through `access.check(ctx, permission, opts)`. The parts this document feeds:
- **feature entitlement** (platform step 6) uses the catalogue in 4.1 and the plan and override data in 4.2 and 4.3;
- **role** (step 7) uses 5.2, 5.3, 5.5 and 5.8;
- **record scope** (evaluated with tenancy at step 3, and again in every list query) uses 5.4, and answers **404**.

Effective permissions of a person in a workspace:
```
(org role permissions ∪ workspace role permissions in this workspace)
  ∩ permissions whose feature is on for the organisation
  limited by each permission's scope
```
A role never grants what the plan lacks; a plan never grants what the role lacks.

---

## 4. Features and plans

### 4.1 Feature catalogue (canonical list; code: `modules/access/features.js`, PLAN N2)

**Feature fields:**
- `key`, `name`, `module`;
- `description` (customer wording, used in upgrade prompts);
- `requires[]` (dependencies), `editions`, `beta`;
- `kind`: `module`, `capability` or `access`.

A feature exists only if code enforces it (route declarations, engine and job checks, menu items). **This list replaces
the "initial features" list in platform 7.1**; keys there map as shown in the last column.

| Module | Key | Customer sees | Requires | Platform 7.1 key |
|---|---|---|---|---|
| Core (always on) | `core` | home, settings, team, help, billing, usage | | |
| Social publishing | `social_publishing` | create post, calendar, publish and schedule, history | | `publishing`, `scheduling` |
| | `approvals` | approval workflow, client approvals | `social_publishing` | `approvals`, `client_portal` |
| | `bulk_schedule` | schedule from Excel | `social_publishing` | |
| | `content_studio` | Content Studio | `social_publishing` | |
| | `social_inbox` | comments on your posts | `social_publishing` | `inbox` |
| | `analytics` | results | `social_publishing` | |
| | `analytics_advanced` | exports, competitor and best-time reports | `analytics` | `analytics_advanced` |
| | `media_library` | media library, brand kit, post templates, hashtags | | |
| AI content | `ai_writer` | AI writer, AI captions and hashtags | | `ai_text` |
| | `ai_images` | AI images | | `ai_image` |
| | `ai_video` | AI video | | `ai_video` |
| | `ai_tools` | other AI tools directory | | |
| | `ai_assistant` | in-app AI assistant | | `ai_assistant` |
| | `ai_premium_models` | stronger AI models | | (platform 10.2.5) |
| | `byok` | use your own AI keys | | `byok` |
| Website & SEO | `seo_tools` | keywords, audits, meta tags, sitemap maker | | `seo_basic` |
| | `seo_autopilot` | SEO autopilot | `seo_tools` | `seo_autopilot` |
| | `rss_feeds` | blog and news feeds auto-posting | `social_publishing` | `rss_autopost` |
| | `link_in_bio` | link in bio | | `bio_pages` |
| | `link_tracker` | link tracker (UTM) | | |
| | `app_store` | app store listing | | |
| Advertising | `ad_copy` | ads and press releases | | |
| | `meta_lead_ads` | Meta lead ads into Contacts | | `lead_ads` |
| | `meta_reports` | Meta reports | | |
| Sales & CRM | `crm` | leads and CRM pipeline | | `crm_pipeline` |
| | `email_outreach` | outreach sequences (Sellbird) | | `sellbird` |
| | `email_campaigns` | e-mail campaigns and newsletters | | `email_campaigns` |
| | `email_mailboxes` | connect domain mailboxes; campaign replies, history and lead conversion in Nexus (CONVERSATIONS C1) | `email_outreach` | |
| | `email_oauth` | connect with Google or Microsoft sign-in (C3) | `email_mailboxes` | |
| | `reply_ai` | AI intent and action items on replies (C2) | `email_mailboxes` | |
| | `reply_auto` | automatic replies for safe intents (C2) | `reply_ai` | |
| | `campaign_variants` | A/B variants, strategy templates, warm-up (C2) | `email_outreach` | |
| | `sms_channel` | SMS provider, two-way SMS, SMS campaign steps (C4) | | |
| WhatsApp | `whatsapp_chats` | WhatsApp chats, contacts, setup | | |
| | `whatsapp_broadcasts` | broadcasts | `whatsapp_chats` | `whatsapp_broadcast` |
| | `whatsapp_templates` | message templates | `whatsapp_chats` | |
| | `whatsapp_bot` | WhatsApp auto-replies (menu, keywords, FAQ) | `whatsapp_chats` | `whatsapp_bot` |
| | `whatsapp_bot_ai` | AI answers on WhatsApp | `whatsapp_bot` | |
| | `contact_sync` | contact sync | `whatsapp_chats` | `contact_sync` |
| Website chat | `web_chat` | website chat widget (menu, keywords, FAQ, live replies) | | |
| | `web_chat_ai` | AI answers in the website chat | `web_chat` | |
| | `white_label` | own bottom line, no Radixile branding (chat and pages) | | `white_label` |
| AI agents | `ai_knowledge_base` | AI knowledge base screen | any of `whatsapp_bot_ai`, `web_chat_ai`, `ai_agents` | `ai_knowledge_base` |
| | `ai_agents` | AI sales agents (5.6) | `whatsapp_chats` or `web_chat` | |
| Access & admin | `custom_roles` | custom roles (5.8) | | `custom_roles` |
| | `teams_routing` | teams, routing rules, agent status (5.7) | `whatsapp_chats` or `web_chat` | |
| | `audit_log` | the organisation's own audit trail and export | | `audit_log_export` |
| | `priority_support` | faster support (informational) | | `priority_support` |
| | `api_access` | API keys (later) | | `api_access` |

AI is a **separate feature per channel** (`whatsapp_bot_ai`, `web_chat_ai`), so "website AI chat without the WhatsApp bot" and
"both bots without AI" are both possible (PLAN N3).

### 4.2 Plans changed on the fly (the plan designer)

**A plan has:**
- a `code` (immutable), `name`, `description`;
- `public` (on the price list), `active` (choosable), `rank` (orders "higher plan"), `badge`;
- **features (any subset)**, **limits**, **allowances**, **quotas** (platform 10);
- **prices** (`REQUIREMENTS.md` 5.2).

**Designer rules:**
1. Features are grouped by module, with name and description. Ticking a feature ticks what it requires. Unticking lists its
   dependants and unticks them after confirmation. A plan can never be saved in an impossible state.
2. **Impact preview** before saving:
   - organisations on the plan;
   - for each removed feature, how many of them used it in the last 30 days;
   - for each lowered limit or quota, how many would be over it, with examples;
   - consistency warnings (platform 7.4).
3. **Adding features or raising limits** applies to everyone at once.
4. **Removing a feature or lowering a limit on a plan in use** asks (decision A4):
   - **Everyone now:** downgrade behaviour (platform 7.5): data kept, read-only window, scheduled items paused, creation refused.
   - **Keep for current organisations:** one override per affected organisation, with reason "kept when <plan> changed on <date>". The change applies to new subscribers only.
5. **Takes effect within 60 s** (platform caching rules). The menu updates on the next request via the menu-version header.
6. **Revisions:** each save writes `bill_plan_revision` (number, full snapshot, author, mandatory reason when organisations are
   on the plan). Invoices record the revision they were priced on. Restoring an old revision is a new save.
7. **Clone, deactivate, never delete.** An inactive plan cannot be chosen by new customers; organisations on it keep it.
8. **Custom plan for one organisation:** from the organisation page, "Make a custom plan" clones its current plan as
   private (`public = false`, `owner_org_id` set) and moves the organisation onto it. Private plans never appear on the price list
   or in other organisations' upgrade prompts.
9. **Trial is a plan**, designed the same way. Seed: every feature on, today's trial limits.
10. **Seed** (PLAN N5): every feature on in every plan, today's three limits, new limits unlimited (-1) until the owner sets
    them (platform 7.3 numbers are proposals).

### 4.3 Overrides (per organisation)
- **Kinds:** `FEATURE` (on or off), `LIMIT`, `ALLOWANCE` (monthly per channel), `QUOTA` (storage bytes).
- **Fields:** value, `valid_from`, optional `valid_until`, **mandatory reason**, author.
- **Uniqueness:** one active override per organisation, kind and key.
- **Precedence:** overrides win over the plan in both directions, below platform kill switches (platform 7.2).
- **Expiry:** automatic (daily job, organisation cache version bumped). Expired overrides stay as history.
- **Screen:** organisation page → Plan & overrides lists each override with source, dates, reason and "end now".

### 4.4 Paid add-ons (later; ROADMAP B8)
Recurring subscription items that switch a feature on or raise a limit or quota for a price. Examples: AI answers ₹499 a month,
+5 seats, +10 GB. They are priced and invoiced like the plan and appear as source `add_on`, between override and plan in
precedence. Until then, staff use overrides.

---

## 5. Roles, permissions and hierarchy

### 5.1 Levels
- **Organisation role** (`org_members.role_key`): rights across the organisation.
- **Workspace role** (`memberships.role_id`): rights inside one workspace. A person can hold different roles in different workspaces.
- **Platform roles** (staff) are in platform 9.1, not here.
- The org Owner and Admin have Manager-equivalent rights in every workspace of their organisation (platform 6.1). Billing and Member have
  no implicit workspace access.

### 5.2 System roles (immutable, available to every organisation)

**Organisation level**

| Key | Name | Rank | May |
|---|---|---|---|
| `owner` | Owner | 100 | everything in the organisation, including billing, plan, ownership transfer and closing the organisation. **Exactly one**; transfer needs the new owner to accept. |
| `admin` | Admin | 90 | everything except billing changes, ownership and closing; all workspaces |
| `billing` | Billing admin | 40 | billing and usage only; no business data; combinable with any workspace role |
| `member` | Member | 10 | nothing at organisation level; works through workspace roles |

**Workspace level.** ✓ = granted. A scope word = granted with that scope. – = not granted.

| Permission ↓ / Role → | Manager | Creator | Approver | Client | Analyst | Sales mgr | Sales agent | Support agent | Bot designer | Viewer |
|---|---|---|---|---|---|---|---|---|---|---|
| `content.view` | workspace | workspace | workspace | workspace | workspace | – | – | – | – | workspace |
| `content.create`, `content.submit` | ✓ | ✓ | – | – | – | – | – | – | – | – |
| `content.edit` | workspace | own | – | – | – | – | – | – | – | – |
| `content.approve`, `content.comment` | ✓ | – | ✓ | ✓ | – | – | – | – | – | – |
| `content.publish`, `content.schedule` | ✓ | – | – | – | – | – | – | – | – | – |
| `social.manage` | ✓ | – | – | – | – | – | – | – | – | – |
| `analytics.view` / `analytics.export` | ✓ / ✓ | ✓ / – | ✓ / – | ✓ / – | ✓ / ✓ | ✓ / ✓ | – | – | – | ✓ / – |
| `media.view` / `media.upload` / `media.delete` | ✓ | ✓ / ✓ / own | ✓ / – / – | ✓ / – / – | ✓ / – / – | ✓ / ✓ / – | – | – | ✓ / ✓ / – | ✓ / – / – |
| `ai.text`, `ai.image`, `ai.video`, `ai.assist` | ✓ | ✓ | – | – | – | ✓ | `ai.assist` | `ai.assist` | `ai.text` | – |
| `chats.view` / `chats.reply` | workspace | – | – | – | – | workspace | assigned | assigned | – | workspace / – |
| `chats.assign` / `chats.takeover` | ✓ / ✓ | – | – | – | – | ✓ / ✓ | – / ✓ | – / ✓ | – | – |
| `chats.export` | ✓ | – | – | – | – | ✓ | – | – | – | – |
| `leads.view` / `leads.edit` / `leads.stage` | workspace | – | – | – | – | workspace | assigned | assigned | – | workspace / – / – |
| `contacts.view` | workspace | – | – | – | – | workspace | assigned | assigned | – | workspace |
| `contacts.import` / `contacts.export` / `contacts.delete` | ✓ | – | – | – | – | ✓ / ✓ / – | – | – | – | – |
| `broadcasts.view` / `broadcasts.send` | ✓ | – | – | – | – | ✓ | – | – | – | ✓ / – |
| `templates.manage` | ✓ | – | – | – | – | ✓ | – | – | – | – |
| `bot.view` / `bot.configure` | ✓ | – | – | – | – | ✓ | ✓ / – | ✓ / – | ✓ | ✓ / – |
| `bot.ai.configure`, `kb.manage`, `webchat.configure`, `agents.manage` | ✓ | – | – | – | – | ✓ | – | – | ✓ | – |
| `outreach.view` / `outreach.manage` / `outreach.send` | ✓ | – | – | – | – | ✓ | assigned / – / – | – | – | ✓ / – / – |
| `seo.view` / `seo.manage` | ✓ | ✓ | – | – | ✓ / – | – | – | – | – | ✓ / – |
| `links.manage`, `feeds.manage`, `bio.manage`, `appstore.manage` | ✓ | ✓ | – | – | – | – | – | – | – | – |
| `ads.create` / `ads.reports.view` / `leadads.manage` | ✓ | ✓ / ✓ / – | – | – | – / ✓ / – | ✓ | – | – | – | – / ✓ / – |
| `members.manage`, `settings.manage`, `integrations.manage` | ✓ | – | – | – | – | – | – | – | – | – |

**Mapping from today** (characterization test, ROADMAP A0):
- `manager` → Manager, `creator` → Creator, `reviewer` → Approver, `client` → Client, `analyst` → Analyst;
- org `owner` and `admin` unchanged.

**Known change (A9):** today a Creator can edit the bot and WhatsApp settings, because those routes use `content.edit`.
In R1 this moves to Manager, Sales manager and Bot designer. Organisations with Creators who used those screens in the last
30 days get a one-release compatibility grant, which the Owner sees and can remove.

### 5.3 Permission keys (format and full list)
- **Format:** `area.action`, optionally with a third part for a sub-resource (`platform.orgs.view`). A **scope** is attached to the grant,
  not the key: `chats.view` granted with scope `assigned`.
- **Each key's catalogue entry also carries:**
  - from platform 6.2: `category`, `feature`, `limit`, `meter`, `risk`, `requiresVerifiedEmail`, `editions`;
  - `scoped` (whether a scope applies).

| Area | Keys (scoped keys marked *) |
|---|---|
| content | `content.view`*, `content.create`, `content.edit`*, `content.delete`*, `content.submit`, `content.approve`, `content.comment`, `content.schedule`, `content.publish`, `content.templates.manage`, `content.series.manage` |
| social | `social.manage` (connect and disconnect accounts) |
| analytics | `analytics.view`, `analytics.export`, `reports.meta.view` |
| media | `media.view`, `media.upload` (bytes), `media.delete`* |
| AI | `ai.text`, `ai.image`, `ai.video`, `ai.assist` (meter `AI_CREDIT`) |
| inbox | `inbox.view`, `inbox.reply` |
| chats | `chats.view`*, `chats.reply`*, `chats.assign`, `chats.takeover`, `chats.export` |
| leads and contacts | `leads.view`*, `leads.edit`*, `leads.stage`*, `contacts.view`*, `contacts.import` (limit `contacts`), `contacts.export`, `contacts.delete`, `contactsync.manage` |
| broadcasts | `broadcasts.view`, `broadcasts.send` (meter `WHATSAPP`), `templates.manage` |
| bot and AI | `bot.view`, `bot.configure`, `bot.ai.configure`, `kb.manage`, `webchat.configure`, `agents.manage` (limit `ai_agents`) |
| outreach | `outreach.view`*, `outreach.manage`, `outreach.send` (meter `EMAIL`, `SMS`), `email.campaigns.manage` |
| channel accounts | `mailboxes.manage` (shared mailboxes; limit `mailboxes`), `mailboxes.own` (a personal mailbox), `sms.manage` (provider, DLT templates; limit `sms_numbers`). Email and SMS conversations reuse `chats.*` and `leads.*` with their scopes |
| SEO and web | `seo.view`, `seo.manage` (limit `seo_sites`), `seo.autopilot.manage`, `links.manage`, `feeds.manage`, `bio.manage`, `appstore.manage`, `tools.use` |
| ads | `ads.create`, `ads.reports.view`, `leadads.manage` |
| workspace | `members.view`, `members.manage`, `settings.manage`, `integrations.manage` |
| org | `org.view`, `org.settings.manage`, `org.workspace.create` (limit `workspaces`), `org.workspace.delete`, `org.members.invite` (limit `users`), `org.members.manage`, `org.roles.manage`, `org.teams.manage`, `org.usage.view`, `org.audit.view`, `org.data.export`, `org.support_access.manage`, `org.ownership.transfer` (AI key source and caps use `org.settings.manage`, platform 13.1) |
| billing | `billing.view`, `billing.pay`, `billing.plan.change`, `billing.wallet.view` |
| account (self) | `account.profile.manage`, `account.keys.manage`, `account.delete` |
| platform (staff) | the `platform.*` list in platform 6.2 |

### 5.4 Data scope
| Scope | Records | Typical holder |
|---|---|---|
| `own` | created by the person | Creator editing own drafts |
| `assigned` | assigned to the person, plus the unassigned queue of their teams (or of the workspace when there are no teams) | Sales or Support agent |
| `team` | assigned to anyone in a team the person leads | team lead (5.7) |
| `workspace` | everything in the workspace | Manager, Sales manager |
| `org` | everything in every workspace of the organisation | Owner, Admin |

- Out-of-scope records answer **404**.
- List endpoints, counts, search, exports and reports filter by scope **on the server**, in the query.
- A scope applies to the records of its area: chats, leads and contacts share the lead's assignment.

### 5.5 Hierarchy rules
1. A person grants only roles of **lower rank** than their own, and only permissions they hold themselves. Nobody changes their own role.
2. Only the Owner adds or removes Admins. The Owner role moves only by transfer (the new owner accepts).
3. Workspace Managers manage members of their own workspaces, up to but excluding Manager.
4. Role changes take effect on the next request; membership and user status are cached at most 5 s (platform 5.2).
5. Invitations carry the role. At acceptance, the seat limit and the inviter's right to grant that role are re-checked.
   Pending invitations count toward seats (platform Q7).
6. **Seats:** `users` counts distinct people with any role (platform 6.4). `human_agents` counts people whose role holds
   `chats.reply`. `ai_agents` counts active AI agents.

### 5.6 AI sales agents (feature `ai_agents`, limit `ai_agents`)
- **What:** a non-human workspace member that works chats.
- **Configured by** a Sales manager or Bot designer (`agents.manage`):
  - name, avatar, persona;
  - goals: qualify, answer, book a site visit, collect details;
  - knowledge (the workspace knowledge base), channels (WhatsApp, website chat);
  - working hours, hand-over rules, allowed actions.
- **Acts as a system actor** (platform 4) with a **fixed restricted permission set**, on chats routed to it:
  - `chats.reply`;
  - `leads.stage`;
  - `leads.edit` (qualifying fields only);
  - booking a follow-up.

  It can never export, broadcast, configure, upload, or reach another workspace.
- **Enforcement:** every tool action of the AI goes through `access.check`, so no prompt can widen its rights.
- **Routing:** menu and keyword bot, then AI agent, then human queue. Hand-over happens when:
  - the customer asks for a person;
  - confidence is low;
  - a rule matches;
  - a human takes over (`chats.takeover`).
- **Visibility:** every message and change shows "AI agent: <name>" in the chat and in the audit trail.
- **Cost:** consumes AI credits (platform 10.2). When credits run out under enforcement, it hands over politely.
- **Migration:** today's "Let AI answer" fallback becomes the default AI agent of each workspace, built from the existing bot
  settings, so current bots behave exactly as before.

### 5.7 Teams and routing (feature `teams_routing`)
- **Teams** per workspace: name, members, optional lead (who gets `team` scope).
- **Routing rules** (in order): by channel, by menu choice or keyword (for example "Talk to our team" goes to Sales), by working hours.
  Then the distribution within the team: round robin or least busy.
- **Agent status:** available, away or offline (`agent_status`). Unanswered chats return to the queue after N minutes (setting).
- **Without the feature:** one shared queue per workspace, and managers assign by hand (`chats.assign`).

### 5.8 Custom roles (feature `custom_roles`, limit `custom_roles`)
- **Who:** created by the Owner or an Admin (`org.roles.manage`), always starting from a system role or a Super Admin **role
  template**, which is copied, not linked.
- **Bounds:** only permissions whose feature the plan has (others shown greyed with the plan that has them), and only permissions
  the creator holds. Never `org.ownership.*`, `billing.*` or `platform.*` in a workspace role.
- **Rank:** below the creator's own.
- **Editing** applies to holders within 5 s, after showing how many people hold the role. **Deleting** a role in use needs a
  replacement role for its holders.
- **Plan loses `custom_roles`:** roles keep working as defined, and editing is frozen (platform 6.3).
- **Limit:** per plan (platform Q12: Agency 20, Full 50).

---

## 6. Super Admin (pointer)
Platform staff roles, the console, organisation health, support sessions and organisation actions are in platform section 9.

## 7. Menu (pointer)
The registry, item states, Super Admin overrides and rendering are in platform section 8. Menu items name a permission. The feature
comes from the permission's catalogue entry.

## 8. Behaviour when access is missing (pointer)
The deny codes and downgrade behaviour are in platform 13.3 and 7.5. The upgrade prompt lists **public** plans that include the
missing feature or raise the limit, cheapest first with price. Private plans are never offered; the prompt shows "Talk to us"
instead. A person who cannot pay sees "Ask your account owner to upgrade".

---

## 9. Data model (owned here; the rest in platform 12 and billing 6)

| Table | Columns |
|---|---|
| `access_role_permission` (platform 12) | + `scope` (`own`/`assigned`/`team`/`workspace`/`org`, null for unscoped keys) |
| `access_role` (platform 12) | + `rank`, `based_on`, `is_template` |
| `teams` | id, org_id, workspace_id, name, lead_user_id, created_at |
| `team_members` | org_id, team_id, user_id; unique(team_id, user_id) |
| `ai_agents` | id, org_id, workspace_id, name, avatar_key, persona, goals json, channels, allowed_actions json, hours json, handover_rules json, active, created_by, created_at, updated_at |
| `chat_assignment` | org_id, workspace_id, lead_id unique, assignee_type (`user`/`ai_agent`/`queue`), assignee_id, team_id, assigned_at, assigned_by (supersedes `assigned_to`) |
| `agent_status` | org_id, workspace_id, user_id, status, updated_at |
| `bill_plan_revision` | plan_code, revision, snapshot json, reason, created_by, created_at |
| `bill_plan` (billing 6.1) | + `owner_org_id` (private custom plan), `badge`, `description` |

Every table carries `org_id NOT NULL` (platform 11.1).

## 10. REST (owned here)
| Method and path | Permission | Purpose |
|---|---|---|
| `GET/POST/PUT/DELETE /api/workspace/teams` | `org.teams.manage` + `teams_routing` | teams |
| `GET/POST/PUT/DELETE /api/workspace/ai-agents` | `agents.manage` + `ai_agents` | AI agents |
| `PUT /api/chats/{leadId}/assign` | `chats.assign` | assign to a person, team, AI agent or queue |
| `PUT /api/me/agent-status` | `chats.reply` | available, away or offline |
| `GET /api/platform/plans/{code}/revisions`, `POST /api/platform/plans/{code}/restore` | `platform.plans.manage` | plan revisions |
| `POST /api/platform/orgs/{id}/custom-plan` | `platform.plans.manage` | make a private plan from the current one |
| `GET/POST/PUT /api/platform/role-templates` | `platform.plans.manage` | role templates |

Roles, members, usage and menu endpoints are in platform 13.

## 11. Screens (owned here)
- **Super Admin → Plans:**
  - the designer, with features grouped by module, dependency ticks, limits, allowances, quotas and prices;
  - impact preview and the keep-for-current choice;
  - revisions;
  - "make custom plan" on the organisation page.
- **Settings → Team & roles:**
  - members, with organisation role and roles per workspace;
  - invitations with the seat counter;
  - custom roles (editor grouped by area, greyed plan-locked permissions);
  - teams.
- **Inbox for agents:**
  - tabs **My chats**, **Unassigned**, **Team** and **All**, shown by scope;
  - assign button;
  - agent status switch.
- **AI agents** (workspace): list, editor, test chat, hand-over log.

## 12. Security specifics
- Role and scope **fail closed** (platform section 3, rule 2).
- Escalation tests:
  - nobody grants above their rank or beyond their permissions;
  - custom roles can't exceed the plan;
  - an AI agent can't export or broadcast, whatever its prompt says.
- Every role, membership, team, AI agent and plan change is audited, with old value, new value and reason (platform 15).

## 13. Migration of roles
1. **Seed system roles** from the matrix in 5.2. Today's five roles keep exactly today's effective permissions; the
   characterization test compares old `rbac.can` with `access.check` for every role and action.
2. **Org role column:** `org_members.role` becomes `role_key` (`owner`, `admin`). Exactly-one-owner is checked. Organisations with two owners
   keep the oldest as Owner, and the others become Admin. The migration reports this, and production has none today.
3. **Creator compatibility grant** (A9) for one release.
4. **`assigned_to`** on leads moves into `chat_assignment`.

## 14. Tests (owned here)
- Matrix snapshot: for each system role × feature on or off, the permission set equals the expected table (5.2).
- Scope:
  - an agent cannot open another agent's chat (404); a team lead sees the team; a manager sees all;
  - lists, counts and exports respect scope.
- Hierarchy: rank and escalation rules; ownership transfer; last-owner rule.
- Plan designer:
  - dependencies are kept;
  - keep-for-current creates overrides;
  - a revision is written;
  - a private plan is invisible to other organisations.
- AI agent: restricted permission set enforced; hand-over on low confidence; credits exhausted leads to hand-over.

## 15. Decisions (defaults until the owner says otherwise)

| # | Question | Default |
|---|---|---|
| A1 | Platform staff roles | `super_admin` only in R1; `support`, `billing_ops`, `auditor` in S1 (platform 9.1) |
| A2 | Customer consent for support access | Not required; visible to the owner; policy options in platform 9.3 |
| A3 | Missing features in the menu | Locked with an upgrade prompt for plan reasons; hidden for role reasons (platform Q6) |
| A4 | Removing a feature or lowering a limit on a plan in use | Ask each time: everyone now, or keep for current organisations via overrides |
| A5 | Custom roles | Sellable feature `custom_roles`; system roles always available |
| A6 | AI agents | Sellable feature with a per-plan limit; consume AI credits |
| A7 | Teams and routing | Sellable feature `teams_routing`; otherwise one shared queue |
| A8 | Billing admin | Organisation role `billing`, combinable with any workspace role |
| A9 | Creator editing the bot today | Moves to Manager, Sales manager, Bot designer in R1; one-release compatibility grant |
| A10 | Owners per organisation | Exactly one; transfer with acceptance |
| A11 | Plan revisions | Kept forever; invoices record the revision |
| A12 | Private custom plans in upgrade prompts | Never shown to other organisations; "Talk to us" instead |
