---
name: billing-core
description: >-
  Reference for the Nexus billing module (plans, price book, entitlements, subscriptions, invoices, payments,
  wallet, metering, top-ups, quota enforcement). Use this whenever work touches modules/billing, bill_* tables,
  plans, subscriptions, invoices, Razorpay checkout or webhooks, the wallet, entitlements, usage limits,
  AI credits, trials, lockout or grace, or anyone asks how billing works, even if they only say "plan",
  "paid_until", "invoice", "limit" or "quota".
---

# Billing core (Nexus)

One self-contained billing module that any Radixile product can plug in. Nexus is the first host. It is a
port of the UrbanSociety Platform Billing module, which has run real invoices, wallet, Razorpay and quota
enforcement in production.

- **Requirements (read first):** `docs/billing/REQUIREMENTS.md`. Sections 4 (hard rules) and 13 (lessons) are
  mandatory reading before writing any money code.
- **Rules at a glance and traps:** `references/rules.md` in this skill.
- **Reference maths with tests:** `docs/billing/reference/price-calculator.js` (run it with node). Copy it to
  `modules/billing/domain/` and keep it free of database, clock and framework imports.
- **To build a phase:** use the `billing-delivery` skill. **To review money code:** use `billing-money-review`.
- **Access, entitlements, menus, limits:** `docs/platform/ACCESS-AND-ENTITLEMENTS.md` and the `access-control`,
  `tenant-isolation` and `usage-limits` skills. Combined build order: `docs/platform/ROADMAP.md`. Billing owns
  plans, prices and subscriptions; access owns every allow or deny decision and reads billing through a port.

## Layout

```
modules/billing/{domain,repos,services,gateways,ports,routes,jobs,migrations,tests}
```
No file in `modules/billing/` may require anything outside it except `services/knex.js` and `node_modules`
(a boundary test enforces it). The host is reached only through `ports/`: accounts, notifier, clock, files, audit.

## Non-negotiables (short form)

1. Money is integer minor units (paise). Percentages in integer hundredths. Never float, never a decimal column.
2. Dates are IST `YYYY-MM-DD` strings; "today" comes from the clock port. Epoch seconds for timestamps.
3. Customer routes take the account only from the session. Only staff routes take an account id.
4. Every money write has an idempotency key. Same key + same payload replays; different payload is 409.
5. Issued invoices and ledger rows are never edited or deleted. Void with a reason, or reverse.
6. Nothing is issued, numbered, counted or granted until money is captured.
7. No network call (gateway, email, S3) inside a database transaction.
8. Code must stay correct on SQLite and Postgres: use guarded `UPDATE ... WHERE <expected>` and check rows
   affected; never rely on `SELECT ... FOR UPDATE` for correctness.
9. Limits and quota checks fail open. Kill switches ship off.
10. Customer responses never contain internal notes, staff logins or gateway failure text.

## Where things go

| Concern | File (under `modules/billing/`) |
|---|---|
| Price maths, periods, allowance, proration | `domain/price-calculator.js` (from the reference) |
| Quotes, coupons, tax | `services/pricing.js` |
| Subscription state and lifecycle | `services/subscriptions.js` |
| Entitlement data: effective plan, features, limits, allowances, overrides (`snapshot(account)`) | `services/entitlements.js` (decisions are made by `modules/access`, never here) |
| Invoices, numbering, void, payment application | `services/invoices.js`, `repos/invoiceSequence.js` |
| Gateway, checkout, capture, webhook | `gateways/razorpay.js`, `services/payments.js` |
| Wallet and ledger | `services/wallet.js` |
| Usage, allowances, grants, enforcement | `services/metering.js`, `services/grants.js` |
| AI credits (reserve, settle, release) | `services/aiCredits.js` |
| Lockout state (`lockoutDecision(account)`, read by access step 5) | `services/lockout.js` |
| Reminders, dunning, alerts | `services/notifications.js`, `jobs/*` |
| Routes | `routes/admin.js`, `routes/my.js`, `routes/webhooks.js` |

## Nexus facts to remember

- Server edition only (`services/edition.js` `isServer()`); the desktop app keeps `services/license`.
- `services/entitlements.js` is read by many screens. Keep its return shape
  `{ can_publish, state, message, limits, plan, plan_name, trial_days_left }` when swapping the internals.
- `organizations.plan`, `plan_status`, `paid_until`, `trial_ends_at` are a **mirror** the module writes through
  one adapter. Do not scatter writes to them.
- The existing external billing client (`services/billing.js`, license server) is **not** kept behind a switch: production never
  configured it, so B4 removes it (PLAN N1). Its public path `/billing/webhook` is freed then; Razorpay uses `/billing/webhook/razorpay`.
- `services/aiQuota.js` is an in-memory abuse speed bump, not billing. Credit metering sits beside it.
- Billing tables key the customer as `account_id` (= `organizations.id`); the isolation rules treat it as the table's `org_id`.
- Error codes are lower case and shared with access (platform 13.3): `limitreached`, `featurenotinplan`, `notconfigured`.
