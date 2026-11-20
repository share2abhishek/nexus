# Billing, plans and feature access: end-to-end plan for Nexus

**What this file owns:** the Nexus decisions N1–N8, the billing screens (5.1 Super Admin billing section, 5.2 customer
Billing page), the payment setup (6, Razorpay shared with UrbanSociety) and the owner questions (9).
**Elsewhere:** money rules `REQUIREMENTS.md`; features, plan designer, roles and scope `ACCESS-REQUIREMENTS.md`; the access
engine, tenancy, staff, menu and limits `docs/platform/ACCESS-AND-ENTITLEMENTS.md`; **the one build order
`docs/platform/ROADMAP.md`**. Status: **draft for owner approval. Nothing is built.**

---

## 1. What the Super Admin must be able to do

Design any plan as a combination of features, and the app grants and denies access to match, with an upgrade prompt
wherever a feature is missing. Examples the design must support:

| Plan the Super Admin designs | Features switched on |
|---|---|
| "Ads only" | Advertising module (ad copy and press releases, Meta lead ads, Meta reports). Nothing else. |
| "Website AI chat" | Website chat **with** AI answers. No WhatsApp bot. |
| "Chatbots, no AI" | WhatsApp bot and website chat, both with menu and keyword answers only. No AI answers anywhere. |
| "WhatsApp suite" | WhatsApp chats, broadcasts, templates, WhatsApp bot with AI. No social publishing. |
| "Agency" | Everything, 25 workspaces, 10 team members. |
| A private plan for one client | Any mix, not shown on the public price list, priced by quote. |

On top of plans, the Super Admin can give **one client** a feature or a higher limit for a while (with a reason and an end
date) without changing the plan, for example "WhatsApp bot free for one month".

---

## 2. Core idea: features are defined in code, plans are data

- **Feature catalogue (code).** Every feature the app can switch on or off is listed once in `modules/access/features.js`
  with a key, a name, its module, what it depends on, and where it is enforced. A feature exists only if the code checks it,
  so staff can never create a feature that nothing enforces. Adding a feature means one entry plus its check.
- **Plans (data).** Staff build plans in Super Admin → Billing → Plans by ticking features, setting limits and prices.
  Stored in `bill_plan`, `bill_plan_feature`, `bill_plan_limit` and `bill_price_book`. No deploy is needed to create or change a plan.
- **One decision.** `entitlements.can(account, feature)` and `entitlements.limit(account, key)` answer for every screen,
  route and background job. Nothing else decides access (the single point of entry).

### 2.1 Feature catalogue
The one list of feature keys is `ACCESS-REQUIREMENTS.md` 4.1 (module, key, what the customer sees, dependencies). It is
enforced through route declarations, engine and job checks and menu items (platform 5.3, 8.1).

### 2.2 Dependencies in the plan designer
Ticking a feature ticks what it requires; unticking lists and unticks its dependants; a plan can never be saved in an
impossible state (`ACCESS-REQUIREMENTS.md` 4.2).

## 3. How access is decided
One function, `access.check`, in the order of platform section 5.2 (identity, edition and kill switch, tenancy and record
scope, organisation status, subscription, feature, role, limits, rate guard). The effective plan and entitlement rules are in
platform 7.2 and billing 5.3.

## 4. How access is enforced
API routes, services, jobs, webhooks and bots all call the engine (platform 5.3); the menu and every button come from the
same decision (platform 8). The screens never decide on their own.

### 4.1 The upgrade prompt
```
402 { allow: false, code: 'featurenotinplan', http: 402,
      message: 'AI answers in the website chat aren’t in your Starter plan.',
      upgrade: { feature: 'web_chat_ai', planCodes: ['growth', 'agency'] },   // public plans that include it, cheapest first
      can_pay: true }   // false for people who may not pay; decision shape and codes: platform 5.1 and 13.3
```
Dialog: "AI answers in the website chat aren't in your **Starter** plan. They're included in **Growth** (₹2,499/month)
and **Agency**." Buttons: **See plans** (opens Billing with that plan selected) and **Talk to us**. Team members who can't
pay see "Ask your account owner to upgrade". If no public plan has the feature (private only), only **Talk to us** shows.

### 4.2 What happens to data when a feature goes away
As platform 7.5: nothing is deleted, read access stays for the read-only window (default 90 days) and export always,
creating, sending and automating stop, scheduled items are paused (not dropped) and listed for the owner, and everything
resumes when the feature comes back (upgrade or override).

---

## 5. Screens

### 5.1 Super Admin → Billing (a section of the one staff console, platform 9.2)
Tabs: **Plans**, **Prices & tax**, **Coupons**, **Invoices**, **Payments & wallets**, **Reports** (B8). Per-organisation billing
(subscription, overrides, discount, access card, invoices, wallet) is the **Billing tab of Org 360** (platform 9.2), not a
separate client list; usage is the console's Usage screen (platform 9.2, 10).

**Plans → plan designer**
```
┌ Plan: Website AI chat (code web_ai)            [Public ✓]  [Active ✓]   Clients on this plan: 4 ┐
│ Features                                    │ Limits              │ Prices (from 1 Dec 2026)     │
│ ▸ Social publishing        ☐                │ Workspaces    [ 1 ] │ Monthly   ₹ [ 999 ]          │
│ ▸ AI content               ☐                │ Team members  [ 2 ] │ Annual    discount [ 15 %]   │
│ ▸ Website & SEO            ☐                │ SEO websites  [ 0 ] │ Model     Per business ▾     │
│ ▸ Advertising              ☐                │                     │ Price history ▸              │
│ ▾ WhatsApp                 ☐                │                     │                              │
│ ▾ Website chat             ☑ Website chat   │                     │                              │
│                            ☑ AI answers     │                     │                              │
│ ▸ Shared                   ☑ AI knowledge base (needed by AI answers)                            │
│ Preview: what the customer sees ▸   Clone plan   Save (asks for a reason when clients are on it)  │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Changing a plan that clients use shows how many are affected and applies to them at once (features) or from the next
  period (prices, which never change an issued invoice).
- Plans are never deleted, only made inactive (existing clients keep them until moved).

**Org 360 → Billing tab**: plan and status, paid-until, change plan, **feature overrides** (grant or remove one feature
until a date, with reason), limit overrides, discount, access (grace, allow until, never lock), invoices, payments, wallet,
history. Every change is audited with who, when, old, new and reason.

### 5.2 Customer → Billing (one page, owner only; members see the plan read-only)
Plan card (plan, status, paid-until, next renewal, what's included), **Change plan** (compare plans side by side, with
features ticked), invoices with PDF and **Pay now**, payments, wallet, usage (B6). Expiry and overdue banners link here.
This is the single place a customer goes for anything about paying.

---

## 6. Money side (unchanged from REQUIREMENTS; summary)
- **Subscriptions**: trial → active → past due → (locked after grace) / cancelled; upgrade pays only the difference now,
  downgrade waits for the end of the paid period, cancel at period end with undo. Nothing refunded, nothing cut short.
- **Invoices**: issued only when money is captured or by the scheduler for renewals; gapless numbers per financial year;
  PDF with the rupee sign; void with a reason; part payments; offline payments recorded by staff with a reference.
- **Payments**: Razorpay with Radixile's keys; callback and webhook share one idempotent capture; money that can't be
  applied goes to the wallet; abandoned checkouts leave nothing behind.
- **Payment methods**:
  - **Online, through Razorpay Checkout**: UPI (QR, UPI ID, UPI apps), cards, net banking and wallets all come from the one Razorpay integration. No separate UPI gateway is needed.
  - **Offline, recorded by staff with a mandatory reference**: bank transfer, direct UPI to Radixile's UPI ID, cheque and cash. The same reference cannot be recorded twice (UrbanSociety lesson 14).
  - **Wallet**: pay from a prepaid balance.
- **Razorpay account, shared with UrbanSociety** (owner's request):
  - **Keys**: Nexus uses the same Razorpay account and keys. UrbanSociety reads them from three environment variables, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`; the values are in its server environment, not in its code. Nexus uses the same three names. In B4 the values are copied from UrbanSociety's server environment into the Nexus server `.env` only, never into git or chat.
  - **Webhooks**: add a second webhook in the Razorpay dashboard pointing at `https://nexus.radixile.com/billing/webhook/razorpay`, with its own webhook secret. One Razorpay account can have several webhooks, and each receives every event of the account.
  - **Telling the apps' payments apart**: every Nexus order carries the note `ctx=NEXUS_BILLING`. The Nexus webhook ignores events for orders it didn't create: it answers 200 and logs at info level, not as an error, because UrbanSociety's payments arrive there too.
  - **UrbanSociety side**: unknown orders fall through its router to its maintenance-payment handler, which logs "Payment not found for order ID" and answers 200. Nexus payments therefore don't disturb it. The only cost is that warning line in its log for each Nexus payment.
  - **Settings not copied**: UrbanSociety's `commission-percentage`, `customer-fee-bearer-enabled` and Razorpay Route (society payouts) don't apply to Nexus.
  - **Reports**: the Razorpay dashboard shows both apps' payments together. Nexus's own reports and invoices stay separate.
- **Activation and deactivation from payments**: a captured payment (online or recorded offline) activates the plan at once
  (cache cleared). When the paid period ends unpaid, grace days apply, then gated features stop (lockout). Login, viewing,
  export and the Billing page always work, so the customer can pay and come straight back.
- **Expiry alerts**: e-mail to the billing contacts at D-30, 15, 5, 2 and 1 before the lock day, invoice due D-7, 1, 0,
  overdue +3 and +7, plus a banner in the app from D-7. Each sent once (dedupe key), never silenced by notification settings.

---

## 7. Phases
**The one build order, with dependencies and detailed phase cards, is `docs/platform/ROADMAP.md`.** Phase ids used across the
documents: S0 (safety), A0 (access foundation), T1 and T2 (tenancy), B0 to B8 (billing), R1 to R3 (roles, support, AI
agents), S1 (staff console and health), L1 and L2 (limits), P1 (plan change handling).

## 8. Decisions taken for Nexus (owner may override)

| # | Decision | Why |
|---|---|---|
| N1 | **No adapter to the old licence server** (overrides REQUIREMENTS default D2). The built-in module is the only billing. The old client (`services/billing.js`) is removed in B4. | Production never configured it (no `BILLING_URL`) and nobody pays through it. |
| N2 | Feature keys, permissions, menu and limits are defined in code under `modules/access/` (`features.js`, `permissions.js`, `menu.js`, `limits.js`); plans are data. | A feature nobody enforces must not be sellable; one module, like `modules/billing/`, reusable in other products (platform Q1). |
| N3 | AI answers are a separate feature per channel (`whatsapp_bot_ai`, `web_chat_ai`). | Needed for "website AI chat without the WhatsApp bot" and "both bots without AI". |
| N4 | A missing feature blocks creating, sending and automating; viewing and exporting stay allowed. | Never lock a customer out of their own data. |
| N5 | Seeded plans keep today's limits and prices with every feature on. | No surprise for existing clients (Avinash Group trial, the Full plan client). |
| N6 | Migrations in `db/migrations/` (one per phase); host port implementations in `services/billingHost.js` and `services/accessHost.js`. | The app and tests migrate only that folder; keeps `modules/billing/` free of Nexus imports. |
| N7 | `BILLING_ENABLED` off by default; the staff console appears when it is on. The feature gate has its own switch `FEATURE_GATING_ENABLED` (off until B1 is verified on production). | Every behaviour ships dark first. |
| N8 | Tax: one GST line at 0 % until registered (default D4). Seat unit for per-unit prices = workspaces (D3). | |

## 9. Questions for the owner

1. **Feature list** (section 2.1): is the grouping right? Anything to split further (for example Comments separate from
   publishing, or Broadcasts separate from Templates) or to merge?
2. **Missing features in the menu**: show them with a lock and an upgrade prompt (recommended, it sells the upgrade), or hide them?
3. **Paid add-ons**: should a client be able to buy one feature on top of a plan (for example "AI answers" as an add-on for
   ₹499/month)? Recommended later, after B5; until then staff give a feature to one client with an override.
4. **Yearly price**: keep "10 × monthly" exactly (a price per cycle), or a percentage annual discount (the total can differ by paise)?
5. **Before B3 goes live**: seller details for invoices (legal name, address, GSTIN, e-mail, phone).
6. **Before B4 goes live**: confirm copying UrbanSociety's Razorpay key id and secret onto the Nexus server, and add the
   Nexus webhook in the Razorpay dashboard (I can't do this; it needs a dashboard login). Also confirm whether UrbanSociety
   runs on the same EC2 server, so the values can be copied server to server without passing through anyone's screen.
