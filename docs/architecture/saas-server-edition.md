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

## Phase 2 (settings per business) — built 2026-11-13

- New table `business_settings` (one row per business and setting); secrets
  (AI keys, mail password) are stored encrypted like saved logins
  (`services/secrets`). `services/businessSettings.js` reads and saves them.
- **AI keys:** a person's own key first, then the keys their business shares with
  the team (Settings → AI → "Shared with your team"; owner or manager saves, the
  rest of the team sees which are set). Radixile's own `.env` keys are used only
  by Radixile platform admins, never by customers. Background work (Sales
  outreach drafts, SEO autopilot drafts, lead qualifying from WhatsApp and Meta
  webhooks) uses the business's keys too. Local AI (Ollama) is off on the server
  unless `OLLAMA_ENABLED=true`, and its section is hidden there.
- **Email sending:** Settings → Email sending saves the business's own mail
  server (owner or manager only; the password is never sent back). Email
  campaigns, Sales outreach and replies send through it; a business without one
  is told to set it up and never sends through Radixile's server. Sign-up and
  password emails still use `PLATFORM_SMTP_*`.
- Install-wide settings that write `.env` (platform app keys, Local AI, content
  folder) stay admin-only, which on the server means Radixile staff only.
- Not moved yet: WhatsApp and lead-pipeline settings are already stored per
  workspace; Radixile-owned OAuth apps for one-click connect come with phase 5.
- Tests: tests/businessSettings.test.js (8).

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

## Phase 4 (paying online) — built 2026-11-11

- **Billing service** (licence server, `src/saas.js`): business-plan products
  (`saas_monthly` / `saas_yearly`, one per plan and period; prices editable in
  Admin → Pricing, each needs a Razorpay plan id), a `saas_subscriptions` row per
  business (`org_ref` = `nexus:<organization id>`), a payment page
  (`/saas/pay/:order`), GST invoices (same numbering as licences), Razorpay
  events (renewal → new invoice and later end date; failed payments → past due;
  cancelled; full refund → ends now). Each change is sent to the app
  (`SAAS_APP_WEBHOOK_URL`). The desktop shop doesn't list these products.
- **App** (`services/billing.js`, `routes/billing.js`): Settings → **Plan** shows
  the plans (monthly/yearly), GST details, then the payment page; back in the
  app (`/billing/return`) the plan shows as active with its renewal date,
  **Cancel plan** (works until the end of the paid period) and **Invoices**. Only
  the business owner (or a Radixile admin) can pay or cancel. The app copies the
  status onto the business (`plan`, `plan_status`, `paid_until`) from notices,
  on the Plan screen, after paying and every 6 hours. Plan limits come from the
  billing service's editions. A business Radixile paused stays paused.
- Plan rules (`services/entitlements.js`): active; payment failing (past due)
  keeps working for 3 days after the paid end; cancelled keeps working until the
  paid end.
- Requests between the two are signed (HMAC-SHA256 of
  `time.METHOD.path.body`, 5 minutes' leeway) with `BILLING_SECRET` =
  `SAAS_APP_SECRET`.
- Safeguards (from the code review): the plan changes only when a payment is
  confirmed; starting a new checkout expires older unpaid ones (and stops their
  Razorpay subscriptions); payment links work for 24 hours; Razorpay events that
  arrive late or twice are ignored and never revive a cancelled plan; a full
  refund of the current payment ends the plan and stops future charges, while
  refunds of older payments leave it alone; a business whose payments fail can
  pay again from the Plan screen (the old subscription is stopped); businesses
  that started paying in the last week are re-checked every 6 hours even if a
  notice was missed. Checkout needs `APP_URL`.
- Not yet: changing plan mid-period (write to info@radixile.com; Radixile can
  set it in Admin → Businesses), AI credits per plan.
- Tests: license-server/test/saas.test.js (13), tests/billing.test.js (11). Tried
  end to end with both servers locally in test-payment mode: sign up → choose
  Individual → GST details → payment page → back to the app with the plan
  active, invoice listed → cancel → "Ends on …".

### Before taking real payments
1. In Razorpay, create a subscription plan for each business-plan product and
   paste its id in the licence server's Admin → Pricing.
2. Set real prices there (the seeded ones are placeholders).
3. Licence server: `SAAS_APP_SECRET`, `SAAS_APP_WEBHOOK_URL`, Razorpay keys and
   webhook (subscription.* and refund events). App: `BILLING_URL`,
   `BILLING_SECRET`, `APP_URL`.
