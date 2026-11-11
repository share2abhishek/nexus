# Social-Nexus server edition (SaaS) — plan

Decided 2026-11-12. Radixile hosts Social-Nexus; businesses sign up at a web
address (for example `app.radixile.com`) and use it in the browser. There are no
per-install licences. Each **business** (an organization in the app) has a
**plan** (Individual, Agency, …) with limits, and a monthly or yearly
subscription. The desktop app stays as it is, with its licence key.

Always-on features (SEO autopilot first) are on only in this edition
(`NEXUS_MODE=server`, see `services/edition.js`).

## What changes, and why

| Today (desktop) | Server edition (SaaS) |
|---|---|
| Anyone with the PC can register; the first account is "admin of this install" | Public sign-up creates a **business** (organization), its owner and a first workspace. Radixile staff use a separate **platform admin** role |
| One licence for the whole install (`services/license`), checked in posting, scheduling, broadcasts, auto-replies, outreach | **Entitlements per business**: plan, limits, subscription state, looked up from the request's organization. Same "limited mode" rule when a subscription lapses: data stays, viewing/drafting/export work, publishing and automation stop |
| ~50 settings in one `.env`: AI keys, social app IDs/secrets, WhatsApp, SMTP, webhooks | **Platform settings** (Radixile's own Facebook, LinkedIn, Google, Pinterest, X, Threads apps; one-click connect for everyone) stay in the server's environment. **Business settings** (AI keys, email sending, WhatsApp number, brand) move to the database, encrypted, per organization |
| Password reset by recovery code only (no email) | Email verification and "forgot password" by email (the server can send email); recovery codes stay as an extra |
| SQLite file, media in a local folder, sessions in a file | Postgres, media in object storage (Azure Blob), sessions in Postgres, one scheduler instance (a database lock) |
| PC-bound licence (`services/license/fingerprint.js`) | Not used |

## Billing: reuse the licence server

`D:\Social\license-server` (license.radixile.com) already has Razorpay one-time
and **subscription** checkout, webhooks, GST invoices, configurable **editions
and limits**, prices, coupons and an admin panel. For the SaaS:

- It becomes Radixile's **billing service**: a business on the app clicks
  *Upgrade*, the app asks the billing service for a checkout (server to
  server, signed), the customer pays on Razorpay, and the webhook updates the
  subscription.
- The app asks the billing service for a business's **entitlements** (plan,
  limits, valid until) and caches them; a webhook or a periodic refresh keeps
  them current. No PC binding, no licence keys.
- Plans, prices and limits are edited in the existing admin panel (no code
  changes for price changes). New limits for the SaaS: workspaces, members,
  connected social accounts, scheduled posts per month, SEO autopilot
  websites, WhatsApp broadcast contacts per month.

## Phases

1. **Businesses and sign-up** — organizations as the tenant; public sign-up
   (business name, owner, email verification), invitations into a business,
   platform-admin role for Radixile; a free trial plan.
2. **Per-business settings** — move AI keys, email sending, WhatsApp, brand
   and lead-pipeline settings from `.env` to encrypted per-organization
   settings; platform OAuth apps (Radixile's) for one-click connect.
3. **Plans and limits** — entitlements per organization replace the global
   licence check everywhere (posting, scheduler, broadcasts, auto-replies,
   outreach, autopilot); limits enforced with plain messages.
4. **Billing** — billing service API in the licence server (checkout,
   entitlements, webhooks to the app), Billing page in the app (plan, renew,
   change plan, invoices).
5. **Running it** — Docker image and compose file, Postgres (separate
   database), media in Azure Blob, health checks, one scheduler worker,
   backups, logs; security review for multi-tenant isolation (tests that one
   business can never read another's data).

Each phase ends with tests and a review (ease of use, privacy, easy setup).

## Decisions (2026-11-12)

- **Trial:** 14 days with full features, no card. Afterwards: choose a plan, or the business stays in limited mode (data kept, nothing published or automated).
- **AI:** both. By default each business adds its own AI key (as on desktop); higher plans include monthly AI credits on Radixile's key, metered per business.
- **Hosting:** the app runs on **AWS EC2** (Docker), the database is the existing **Azure Postgres server** (a separate `socialnexus` database and login; never the Urban Society database). Put media in S3 (same cloud as the app). The app and the database are in different clouds, so keep them in nearby regions and use connection pooling.

## Open decisions

- Web address (e.g. `app.radixile.com`).
- Starting plans, prices and limits (editable later in the admin panel).
- How many AI credits each plan includes.

## Phase 1 (businesses and sign-up) — built 2026-11-13

Server edition only; the desktop app keeps today's behaviour.

- **No automatic admin.** Today `repos/usersRepo.create` makes the first account the
  admin of the whole install; in the server edition every sign-up is a normal user.
  Radixile staff become platform admins through `PLATFORM_ADMIN_EMAILS` (verified email).
- **Sign-up creates a business** (`routes/users.js /register`): business name, owner,
  email, password → in one transaction: user, `organizations` row (plan `trial`,
  `trial_ends_at` = now + 14 days), `org_members` owner, first workspace (Asia/Kolkata),
  `memberships` manager. `services/workspaceHelper.ensureDefaultWorkspace` must also give
  a trial (it currently makes a "X's Org" on plan `free`). Edition user limits and
  registration modes from the desktop licence don't apply (platform admin can still pause sign-ups).
- **Joining by invitation:** signing up from an invitation link joins that business
  (`repos/invitationsRepo.accept`) instead of creating a new one.
- **Email:** new migration with `users.email_verified_at`, `organizations.trial_ends_at`,
  and an `auth_tokens` table (user, kind `verify_email` | `reset_password`, hashed token,
  expiry, used_at). Verification email after sign-up (banner "Verify your email · Resend"
  until done); "Forgot password?" sends a reset link (1 hour, single use; same answer
  whether or not the email exists). Sent with the platform SMTP settings.
- **Screens:** `login.html` asks for the business name in the server edition and uses
  email reset instead of the recovery-code flow; new reset page; in-app banners for
  email verification and "Trial: N days left"; the recovery-code reminder hidden.
- **Tests:** sign-up makes a trial business and no admin; platform admin by env; invite
  sign-up joins the right business; verify and reset tokens (expiry, single use);
  desktop sign-up unchanged.

**Status:** built and tested (tests/saasSignup.test.js) and tried in a fresh server-edition copy: sign-up → business on a 14-day trial → confirm-email banner → link confirms → forgot password → emailed link → new password (link single-use). Settings: APP_URL, PLATFORM_ADMIN_EMAILS, PLATFORM_SMTP_* (see .env.example). Until phase 3, the desktop licence check still blocks publishing on the server edition.

## Phase 3 (plans and limits per business) — built 2026-11-13

- `services/entitlements.js` answers "may this business publish?" for every check:
  posting and scheduling (routes + scheduler), broadcasts, WhatsApp auto-replies,
  client approval links, Sales outreach sending, first comments and the SEO autopilot.
  Desktop keeps the install's licence; the server edition uses the business's
  trial (`trial_ends_at`) or plan (`plan`, `plan_status`, `paid_until` with 3 days'
  grace; `suspended` pauses a business). The scheduler checks each business, so an
  ended trial leaves only that business's posts waiting (still scheduled).
- Limits per business (workspaces, team members, SEO autopilot websites) from the
  plan; defaults in `DEFAULT_PLANS`, overridable with the `saas_plans` config value.
- Settings → **Plan** (the Licence tab on the desktop) shows plan, status, trial days
  left and usage. Admin → **Businesses** lets Radixile staff set a business's plan,
  status, paid-until and trial end (`PATCH /admin/organizations/:id/plan`) until
  online payment (phase 4) does it.
- Tests: tests/businessPlans.test.js. Tried in a fresh server-edition copy: trial
  publishes; admin ends the trial; publishing and scheduling answer with the reason.
