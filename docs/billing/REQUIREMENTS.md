# Billing Core: plans, subscriptions, features, payments, invoices

**Purpose.** One self-contained billing module that any Radixile product can plug in, so a product can sell plans, take
subscriptions, charge online and offline, meter usage, and raise proper invoices without rewriting billing each time.
The first host is **Nexus**. The design comes from the Platform Billing module of UrbanSociety, which has run real
invoices, wallet, Razorpay and quota enforcement in production. Its mistakes are listed in section 13 so they are not
repeated.

**Audience.** Developers and Claude models building it. Read sections 1 to 5 first, then the phase you are building
(section 12). The skills in `.claude/skills/billing-*` point back here.

**Related.** Access, roles, menus, entitlement checks, isolation and AI/storage limits: `docs/platform/ACCESS-AND-ENTITLEMENTS.md`. Build order for both: `docs/platform/ROADMAP.md`.

**Status.** Requirements only. Nothing in this document is built in Nexus yet. Where a default is chosen for a missing
owner decision, it is marked **Default** and listed in section 15.

---

## 1. Scope

### 1.1 In scope
1. **Plan catalogue and price book** with effective dating, so past invoices never change.
2. **Entitlements**: which features a customer may use and what limits apply, decided by plan and overridable per customer.
3. **Subscriptions** (a customer's contract): trial, active, past due, suspended, cancelled; renew, upgrade, downgrade, cancel.
4. **Pricing engine**: per-unit (seat, workspace, flat), flat fee and one-time prices; cycle discount, customer discount, coupon, tax.
5. **Invoices**: gapless numbers per financial year, immutable once issued, PDF, void, payment application, overdue.
6. **Payments**: online through a gateway port (Razorpay first), offline recorded by staff, pay from wallet, webhooks, idempotency.
7. **Wallet**: prepaid balance with an append-only ledger.
8. **Metering and quotas**: count usage (AI calls, messages, posts) against a monthly allowance plus purchasable top-ups; count-only, warn, enforce.
9. **Notifications and dunning**: renewal reminders, invoice emails, overdue reminders, quota alerts.
10. **Admin console and customer billing screens**, audit trail, reconciliation jobs, basic revenue reports.

### 1.2 Out of scope (for now)
- Multi-currency conversion. One currency per deployment, default INR. Store the currency code on every money row so this can grow.
- Marketplace payouts, partner commission and refunds to cards (UrbanSociety has these in a separate module and they need an accountant first).
- Tax filing and e-invoicing (IRN). The data to support it is kept; submission is not built.
- Usage-based postpaid billing (charge at the end of the month for what was used). Everything here is prepaid or fixed-fee.

### 1.3 Non-goals
- Do not build a general accounting ledger. This module records what was billed and paid, nothing else.
- Do not let billing code read or write the host product's business data (posts, contacts, leads). It exposes decisions; the product asks.

---

## 2. Vocabulary (generic names used in this document)

| Generic term | UrbanSociety | Nexus today | Meaning |
|---|---|---|---|
| **Account** | `Company` (a society) | `organizations` row | The paying customer. One account has one subscription. |
| **Seat unit** | flat | workspace / user | The thing a per-unit plan multiplies by. |
| **Plan** | `PlanCode` | `organizations.plan` (`trial`, `individual`, `agency`, `full`, `free`) | A named bundle of features and limits. |
| **Subscription** | `company_subscription_contract` | `plan`, `plan_status`, `paid_until`, `trial_ends_at` columns | The customer's current commercial state. |
| **Super admin** | `ROLE_SUPER_ADMIN` | platform admin (`services/platformAdmin.js`) | Radixile staff. |
| **Billing admin** | society admin | org `owner` | The person who may pay and change the plan. |

Use the generic names in new code (`account_id`, `subscription`, `billing_admin`). The Nexus adapter layer maps `account_id` to `organizations.id`.

---

## 3. Architecture

### 3.1 Shape
A **bounded context**: one folder, no imports from product code except through ports.

```
modules/billing/
  domain/        pure functions and constants: price calculator, billing periods, state machine, allowance calculator
  repos/         knex queries only (one file per table group)
  services/      pricing, subscriptions, invoices, payments, wallet, metering, entitlements, notifications
  gateways/      payment gateway adapters (razorpay.js, fake.js for tests)
  ports/         interfaces the host implements: accounts, notifier, clock, files, audit
  routes/        express routers: admin.js, my.js, webhooks.js
  jobs/          scheduler jobs (invoice generation, reminders, reconciliation, expiry)
  migrations/    knex migrations (the host's db/migrations may include them)
  tests/
```
Nexus path: `modules/billing/`. A test (see 12, B0) fails if any file under `modules/billing/` requires anything outside
`modules/billing/`, `services/knex.js` or `node_modules`. Host access goes through `ports/`.

### 3.2 Ports (what the host provides)
| Port | Methods | Nexus implementation |
|---|---|---|
| `accounts` | `getAccount(id)`, `countSeatUnits(accountId)`, `billingContacts(accountId)`, `isBillingAdmin(user, accountId)`, `isPlatformAdmin(user)` | wraps `orgsRepo`, `membershipsRepo`, `services/accounts.js` |
| `notifier` | `sendEmail`, `sendPush?`, `sendWhatsapp?` (all take a dedupe key) | wraps `services/smtpSettings.js` and the email repo |
| `clock` | `now()`, `todayIST()` | one place, supports a QA date override |
| `files` | `put(key, buffer)`, `signedUrl(key, seconds)` | local disk on desktop, S3-compatible on server |
| `audit` | `record({actor, action, entity, entityId, detail})` | writes to billing's own `billing_audit` table (section 6.14) |

### 3.3 Database
- Nexus runs on **SQLite (desktop)** and **Postgres (server edition)** through knex. Every migration and query must work on both.
  The server edition is the only one that bills. The desktop app keeps its licence (`services/license`); billing routes return 404 there
  (existing pattern: `edition.isServer()`).
- **Money is stored as integer minor units** (paise), column suffix `_minor`, never float and never a decimal column. SQLite has
  no real decimal and float rounding has no place in invoices. UrbanSociety used `NUMERIC(21,2)`; integers are the safer
  equivalent here. Convert to rupees only at the screen and PDF edge.
- **Timestamps** follow Nexus: integer epoch **seconds** (`created_at`, `paid_until`). **Calendar dates** (period start and end, due
  date, effective-from) are `YYYY-MM-DD` strings in IST, stored in a `string(10)` column and compared as strings (they sort correctly).
- **No row locks on SQLite.** Where UrbanSociety used `SELECT ... FOR UPDATE`, use: (a) one transaction, (b) a guarded atomic
  `UPDATE ... WHERE <expected state>` and check the affected-row count, (c) unique indexes for idempotency. On Postgres you
  may additionally use `.forUpdate()`; the code must stay correct without it. Do not write a code path that needs a lock to be correct.
- Create tables with `if (!(await knex.schema.hasTable(...)))` guards and idempotent column adds, as the existing Nexus migrations do.
- All table names are prefixed `bill_` (for example `bill_plan`). Existing `organizations` columns are read and written only by
  the adapter that mirrors the subscription onto them (section 11.2).

### 3.4 Process model
- The scheduler (`services/scheduler.js`, node-cron) runs billing jobs on the server edition only.
- Jobs claim a run before doing work (`bill_job_run` unique key per job and day) so two instances never both invoice.
- Gateway calls (Razorpay) are never made inside a database transaction.

---

## 4. Hard rules (apply to every phase)

1. **Integer minor units for money.** Percentages are applied with one rounding step (half-up) per line and the rounded
   value is stored. Total equals the sum of stored lines. Never recompute an issued invoice.
2. **IST for every date decision.** "Today" comes from the clock port (`todayIST()`), never from `new Date()` inside business code.
   Period math is anchor-day preserving (Jan 31 to Feb 28 to Mar 31) and inclusive (a month period starting 1 Jan ends 31 Jan).
3. **Tenancy.** Customer endpoints take `account_id` only from the logged-in user's session (the active workspace's organisation).
   Never from a body, query or header. Only staff endpoints take an account id, and they require the platform-admin check.
4. **Access.** Customer billing endpoints require the `billing.*` permissions (org roles Owner and Billing admin, `ACCESS-REQUIREMENTS.md` 5.2). Staff endpoints require `platform.billing.manage` (staff roles `super_admin`, `billing_ops`, platform 9.1). Both are asked through `access.check` (platform 5); billing does not check roles itself. Centralise in one
   `billingAccess` service; routes call it, they do not check roles themselves.
5. **Idempotency on every money write.** The client sends an `Idempotency-Key` header. Same key and same payload returns the
   original result; same key with a different payload is 409 `idempotencykeyreused`. A failed attempt stores nothing, so the key can be retried.
6. **Immutability.** An issued invoice never changes (only `void` with a reason, and only with nothing paid). Ledger rows are
   append-only; corrections are new rows that reverse old ones. Nothing is deleted.
7. **Nothing is issued or counted until money is captured.** A checkout creates a draft with no invoice number and no coupon use.
   Capture issues and pays atomically. Abandoned drafts expire and leave nothing behind.
8. **Webhook and callback share one capture function.** It is idempotent on the gateway payment id. A wrong amount or a different
   payment id for the same order is rejected and recorded, not applied.
9. **Money is never lost.** If a captured payment cannot be applied (invoice voided, already paid, amount differs), credit the
   wallet and record why.
10. **Fail open on limits.** A bug, timeout or missing data in quota or entitlement checks must let the user continue. Only a
    deliberate, explained state (trial ended, subscription lapsed, quota in ENFORCE mode) blocks. Never block security mails, logins or password resets.
11. **Kill switches.** Every enforcement behaviour has a global env switch that defaults to the safe side (see section 9).
12. **Audit everything a human does:** plan changes, discounts, coupons, credits, voids, overrides. Who, when, old, new, reason.
13. **Reasons are mandatory** for super admin credits, debits, voids, overrides and free months.
14. **Customer responses are scrubbed.** Internal notes, creator login, gateway failure text and staff names are removed from every customer-facing response and PDF.
15. **Drafts are invisible** to customers (404, even on pay endpoints).
16. **Backend is the authority.** The UI may hide a button, but the server decides. A 200 response is not proof of success: the body carries the status (`CAPTURED`, `REJECTED`) and the UI reads it.

---

## 5. Concepts and rules

### 5.1 Plan catalogue
- A **plan** has a code (`individual`, `agency`, ...), a display name, a sort rank, and `active`.
- A plan has **features** (boolean) and **limits** (integer, -1 = unlimited) in the entitlement table (5.3), and **allowances** (monthly metered quantities, 5.8).
- Plans are data, editable by staff, not code constants. The seeder inserts missing rows and **never overwrites a row staff changed**.
- Default Nexus seed, from `services/entitlements.js` today: `trial` (workspaces 3, users 5, seo_sites 1), `individual` (1, 2, 1),
  `agency` (25, 10, 10), `full` (unlimited), `free` (1, 2, 1). Prices today: individual 1275 INR/month, 12750/year; agency 10200 / 102000; full by quote.

### 5.2 Price book
- A **price book row** is `(plan_code, pricing_model, cycle?, unit_price_minor, effective_from, effective_to?, active)`.
- `pricing_model`: `PER_UNIT` (price x quantity), `PER_ACCOUNT` (flat fee), `ONE_TIME` (custom amount).
- **Cycles:** `MONTHLY`=1, `QUARTERLY`=3, `HALF_YEARLY`=6, `ANNUAL`=12, `CUSTOM`=n months.
- Price for a period is read at the **period start date**, so a price rise never alters an issued or backdated invoice.
- A customer can have a **price override** (unit price or quantity) on the subscription; it wins over the price book.
- Unique `(plan_code, pricing_model, effective_from)`. Prices never go negative.
- **Cycle discount** (for example annual -15%) is a separate table keyed by cycle. Default all 0; staff set them.

### 5.3 Entitlements (features and limits)
Billing **provides the entitlement data** (effective plan, plan features, limits, allowances, overrides) through `entitlements.snapshot(accountId)`; **every allow or deny decision is made by `access.check`** (platform 5.2, steps 5, 6 and 8), which reads that snapshot through a port. `entitlements.can/limit` remain as thin helpers over the snapshot for the module's own use.
- Tables: `bill_plan_feature(plan_code, feature_key, enabled)`, `bill_plan_limit(plan_code, limit_key, value)`, and optional per-account
  overrides `bill_account_override(account_id, key, kind, value, valid_from, valid_until, reason)`.
- **Resolution order:** account override (active today) > effective plan (5.5) > default deny.
- **Effective plan** is the highest plan among **paid periods covering today**, not the plan the customer last clicked. If Premium is paid to
  31 Mar and a Standard renewal starts 1 Apr, the plan is Premium until 31 Mar and Standard after. A lower plan paid for the same days never lowers it.
- Result shape (match Nexus's existing `license.status()` shape so screens work for both editions):
  `{ can_publish, state, message, limits, plan, plan_name, trial_days_left }` (the shape `services/entitlements.js` returns today) where `state` is one of
  `active | trial | grace | expired | suspended | unlicensed`.
- **Cache** the decision per account for 60 seconds. Evict it on any write to the subscription, an override, or settings.
- Feature keys are stable strings owned by the host product; the canonical list is `ACCESS-REQUIREMENTS.md` 4.1 (`social_publishing`, `whatsapp_bot_ai`, `web_chat_ai`, ...). The billing module stores them, it does not interpret them.
- **Limits are checked at the action** (create workspace, invite user, add SEO site) by calling `entitlements.limit(...)`. Reaching a limit gives
  a clear 402 with `code: 'limitreached'` (platform 13.3), the limit, the current count, and the plans that raise it.
- Never lock out data: an expired customer can still log in, view and **export** their data. Only publishing, sending and automation stop.

### 5.4 Subscription lifecycle
States: `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`.
```
(signup) -> TRIAL --pay--> ACTIVE --period ends unpaid--> PAST_DUE --grace over--> (locked, state stays PAST_DUE/ACTIVE; see lockout)
ACTIVE --cancel at period end--> ACTIVE (cancel_effective_on set) --date passes--> CANCELLED
ACTIVE/TRIAL --staff--> SUSPENDED --staff--> ACTIVE
CANCELLED --customer buys again or staff reactivates--> ACTIVE
```
A subscription row holds: `plan_code`, `pricing_model`, `billing_cycle`, `custom_cycle_months`, `unit_price_override_minor`,
`quantity_override`, `trial_end_date`, `current_period_start`, `current_period_end` (the **paid-until** day), `status`, `auto_invoice`,
`billing_email`, `tax_id` (GSTIN), `billing_address`, `scheduled_plan_code`, `scheduled_plan_effective`, `cancel_requested_on`,
`cancel_effective_on`, `version`.

- **Trial.** New accounts start `TRIAL` with `trial_end_date` (Nexus: `trial_ends_at` today). No invoice during trial. An invoice for the first period is raised the day after the trial ends if `auto_invoice` is on and a plan was chosen; otherwise the customer sees "choose a plan".
- **Paid-until** is the end of the last paid, non-backdated subscription period. Paying an invoice moves it forward only if the invoice period moves it forward.
- **Renewal** continues from the current paid-until + 1 day. Buying early extends, it does not overlap.
- **One live subscription invoice per account per day.** At most one non-void subscription invoice may cover any given day; periods are inclusive and adjacent periods are fine. Every creation path checks for overlap inside the same transaction and returns 409 `alreadyinvoiced` naming the existing invoice (staff manual), skips silently (scheduler), or supersedes an open checkout draft then refuses a real overlap (checkout). There is no database constraint for this; the check is in code.
- **Upgrade (pay only the difference).** Immediate. Creates an `UPGRADE_ADJUSTMENT` invoice covering `[today, paid-until]`:
  `amount = (new_rate - current_rate) x quantity x months x remaining_days / total_days` (remaining counts today and the last day, half-up, minimum INR 1 = 100 paise), tax added at today's rate. The plan changes only when that invoice is paid. It does not move the period end.
  Example: Standard 1500 paise (INR 15) to Premium 1600 paise (INR 16) per unit-month, 100 units, 12 months of 365 days, 184 days left: `100 x 100 x 12 x 184 / 365 = 60493` paise.
- **Downgrade.** Scheduled for the day after the last paid period still above the target; no invoice, features unchanged until then. Undo until the day it takes effect. A paid period starting on or after that date clears the schedule (the customer chose again).
- **Cancel at period end.** Sets `cancel_effective_on` = last paid day (today if nothing paid), turns `auto_invoice` off, drops any scheduled downgrade. After the date the account behaves like a lapsed one. Undo until the last paid day; after it, 409 `cancelalreadyeffective`. Open invoices are not touched.
- **Paid period is never cut short and nothing is refunded** by upgrade, downgrade or cancel. Say this on the screen.
- **Paying an old invoice never** changes the plan, reactivates a cancelled or suspended subscription, or moves dates backwards.
- **Staff cancel / reactivate / delete.** Cancel stops all scheduled invoices and reminders. Delete removes the subscription and its discounts only; invoices, payments and wallet stay. Only the customer's own purchase (or staff reactivate) brings a cancelled subscription back; paying some other invoice never does.

### 5.5 Pricing engine (pure function)
Input: account facts and a period. Output: a quote with one line per charge and per discount.
```
months      = cycle months (CUSTOM -> subscription.custom_cycle_months); ONE_TIME -> n/a
qty         = PER_UNIT -> subscription.quantity_override ?? ports.accounts.countSeatUnits(accountId); else 1
unit        = subscription.unit_price_override_minor ?? price_book(plan, model, effective on periodStart).unit_price_minor
base        = ONE_TIME ? unit : unit * qty * months
cycleDisc   = round(base * cycle_discount_percent / 100)               // 0 for ONE_TIME
societyDisc = active account discount on periodStart:
              PERCENT -> round((base - cycleDisc) * v / 100) ; FIXED -> v_minor
couponDisc  = coupon if given and valid: PERCENT -> round(remaining * v / 100) ; FIXED -> v_minor
taxable     = max(0, base - cycleDisc - societyDisc - couponDisc)      // never below 0; each discount capped at what remains
taxRate     = tax_rate effective on the ISSUE date
tax         = round(taxable * taxRate / 100)                           // half-up, once
total       = taxable + tax
```
Return `{ lines[], base, discounts[], taxable, tax_name, tax_rate, tax, total, period_start, period_end, qty, months }`. Every discount is
its own visible line so the customer sees how the bill was built. A reference implementation with tests is in `docs/billing/reference/price-calculator.js`.
- **Order of discounts is fixed:** cycle, then account discount, then coupon.
- **Tax:** rate is effective-dated and append-only (`GST 0%` seeded; staff add `GST 18%` from a date later without touching past invoices). Charges and tax are always separate lines. If the seller has a GSTIN and the buyer's state differs, split IGST; same state, CGST + SGST. Until the CA confirms, show one `GST` line (**Default**).
- **Quantity source** is the host's `countSeatUnits`; the issued invoice keeps the quantity on its lines, only new quotes use the live count. Backdated invoices use today's count and say so on the line.
- **Coupons:** code (unique, case-insensitive), `PERCENT|FIXED`, valid from/to, max redemptions, redemption count, active. Validated in full **at issue**, not at checkout; a coupon that ran out after checkout is still honoured because the customer paid the quoted price. A redemption is counted only when the invoice is issued.

### 5.6 Invoices
- **Number** `PREFIX/FY/000123`, for example `RXS/2026-27/000123`. Financial year April to March in IST, from the **issue date**.
  Allocated inside the issuing transaction from `bill_invoice_sequence(fy, last_seq)` with an atomic increment (`UPDATE ... SET last_seq = last_seq + 1`, then read it back;
  on Postgres use `RETURNING`). Gapless per year. Drafts have no number. Backdated invoices get today's number and show the old period.
- **Types:** `SUBSCRIPTION`, `ONE_TIME`, `ADHOC`, `UPGRADE_ADJUSTMENT`, `CREDIT_TOPUP` (one per metered channel, for example `AI_TOPUP`). Do not reuse one top-up type for two channels; the type decides what is granted.
- **Status:** `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `VOID`. **Overdue is derived** (`ISSUED` or `PARTIALLY_PAID` and `due_date < today`), never stored.
- **Source:** `SCHEDULER`, `CHECKOUT`, `MANUAL`. Checkout may supersede open `SCHEDULER` and `CHECKOUT` invoices only; staff-priced `MANUAL` ones survive and give 409 `openinvoiceexists`.
- **Snapshot at issue:** seller block, buyer name, address, tax id, every quote number. Later edits to the account never change the invoice.
- **Timing:** subscription invoice raised the **day after** the period or trial ends; due date = issue + `due_days` (default 7). Partial payments allowed; overpayment rejected.
- **Void:** with a reason, only with nothing paid (a paid top-up has its own rules, 5.9). Voiding a **SCHEDULER** invoice cancels it: the job will not raise it again and billing pauses for that account until staff raise a new one. A free month is a manual invoice with a 100% discount. Voids caused by a checkout superseding an invoice are not waivers.
- **Backdated invoices** (for history) never advance the subscription and checkout never supersedes them. Staff can bulk-mark them paid with an offline payment and a note.
- **PDF:** seller, buyer, number, date, period, lines (charges, discounts, taxable, tax name and rate, total), amount paid, balance due. Embed a font that has the rupee sign and Indic glyphs (Noto Sans), or the PDF shows "Rs." and "?" (a known UrbanSociety defect).
- **Credit notes** (new, recommended once GST registered): a void after payment is replaced by a credit note linked to the invoice; the amount returns to the wallet. **Default:** not built in B-phases 0 to 5; the schema leaves `credit_note` room (section 6.7).
- **Emails:** issued, part-paid and paid emails go to the billing contacts after commit, with the PDF built at send time. Not for 0-total, checkout, backdated, already paid or void invoices.

### 5.7 Payments
- **Gateway port** `PaymentGateway`: `createOrder({amount_minor, currency, receipt, notes})`, `verifySignature(payload)`, `fetchPayment(id)`, `parseWebhook(req)`. Adapters: `razorpay` (uses Radixile's own keys, never linked accounts) and `fake` (tests).
- **Methods:** `GATEWAY` (Razorpay), `WALLET`, `CASH`, `BANK_TRANSFER`, `CHEQUE`, `UPI` (the last four are offline, recorded by staff with a mandatory reference).
- **Checkout sequence (no network call inside a transaction):**
  1. Transaction: lock or guard the subscription; supersede open drafts; create a `DRAFT` invoice and a `CREATED` payment row; commit.
  2. Call the gateway `createOrder` with notes `{ctx:"BILLING", paymentId, accountId}`.
  3. Short transaction: attach the order id to the payment. If the gateway failed, void the draft.
- **Capture** (callback and webhook both call `capture()`): guarded update on the payment row from `CREATED` to `CAPTURED`; idempotent on `gateway_payment_id`; check amount equals the quoted total; then issue and mark the invoice paid atomically and keep the quoted total.
- **Abandoned drafts** older than 2 hours are voided by a job every 15 minutes. A young draft makes the invoice scheduler wait, which prevents two bills.
- **Webhook route** is public, verified by signature, returns 500 on internal failure so the gateway retries, and 200 only when applied or safely ignored.
- **Wallet payment** is one transaction: wallet debit + payment row + invoice update.
- **Display:** the customer list shows only `CAPTURED` payments. Staff see `CREATED` rows older than 30 minutes labelled "Not completed (abandoned checkout)" so an abandoned attempt never looks like a duplicate payment (the Namrata B-Wing incident).
- **Native / desktop apps** that cannot take online payment link to the website; paying from the wallet still works.

### 5.8 Wallet
- Prepaid balance per account. **Never negative.** No cash-out. Staff credit it after an offline payment (reference mandatory, optional proof file) or the customer recharges online.
- **Ledger** `bill_wallet_txn`, append-only: `direction` (CREDIT/DEBIT), `txn_type` (`OFFLINE_CREDIT`, `ONLINE_RECHARGE`, `INVOICE_PAYMENT`, `TOPUP_PURCHASE`, `REFUND`, `ADJUSTMENT`, `REVERSAL`), `amount_minor > 0`, `balance_after_minor`, `payment_mode`, `reference_number`, `proof_key`, `payment_id`, `invoice_id`, `reversal_of_id`, `idempotency_key` (unique), `note` (internal), `public_note` (customer sees this), `created_by`, `created_at`.
- **Debit is atomic:** inside one transaction run `UPDATE bill_wallet SET balance_minor = balance_minor - :a, version = version + 1 WHERE account_id = :id AND balance_minor >= :a`; zero rows affected means insufficient funds. Then insert the ledger row. On Postgres a row lock is optional; the guarded update is correct on both databases.
- Wallet row is created lazily with an insert-if-absent inside the same transaction.
- Corrections are `REVERSAL` rows, once per entry. `INVOICE_PAYMENT`, `TOPUP_PURCHASE` and the credit `REFUND` of a voided top-up are not reversible here; undo them through the invoice.
- Per-transaction cap (default 10,00,000 INR) applies to **staff entries only**; system postings (capture credits) are uncapped or a large capture could never be recorded.
- One proof file per entry, only on offline credits and adjustments, stored privately with a 30-minute signed link; upload runs outside any transaction.
- **Nightly reconciliation (03:00 IST):** `balance == sum(credits) - sum(debits)` per wallet; log an error on drift. Read-only.

### 5.9 Metering, allowances and top-ups
A **channel** is a metered thing (`AI_CREDIT`, `EMAIL`, `WHATSAPP`). The design is channel-generic. Posts per month, storage and count limits are not billing channels: they are counted by the access limit framework (platform 10.1, `usage_counter`, `org_storage`).
- **Allowance** per plan and channel: `included = clamp(per_unit_per_month * seatUnits + per_account_per_month, min_per_month, max_per_month)`, with an **account override** replacing the formula when active (negotiated deals). One `AllowanceCalculator` serves every channel.
- **Period** = IST calendar month, created lazily and atomically (`INSERT ... ON CONFLICT DO NOTHING`, supported by SQLite 3.24+ and Postgres). `plan_included` is fixed when the row is created; a plan change in the month updates it, a seat-count change does not. No rollover.
- **Usage events** `bill_usage_event(account_id, channel, category, billable, status, quantity, actor_user_id, ref, created_at)`; `used` increments with one atomic `UPDATE ... SET used = used + :n`. Events are written **after** the action and **never delay or stop it**: queue in memory (bounded, drop with an error log when full), drain on shutdown, catch every failure.
- **Top-up packs** (staff-configured, none seeded): `code`, `channel`, `quantity > 0`, `price_minor`, validity (`MONTH_END`, `DAYS`, `NONE`), `active`.
- **Grants:** `bill_grant(account_id, channel, pack_id?, quantity, consumed, valid_from, valid_to, source PURCHASE|STAFF|COMPLIMENTARY, invoice_id UNIQUE?, reason, idempotency_key)` with `consumed <= quantity`.
- **Grant only on PAID**, in the same transaction that marks the top-up invoice paid, exactly once (unique invoice link). Works for wallet, gateway and offline payment. An abandoned purchase leaves nothing.
- **Order of use:** plan allowance first, then the grant expiring soonest. Consumption is one guarded `UPDATE` per draw.
- **Balance:** `total = plan_included + sum(grant quantity active in the period)`; `remaining = max(0, plan_included - used) + sum(quantity - consumed)` of active grants. Show server figures only (the real `used`, the server's `remaining`, the bar from `percentUsed`); never derive used from `total - remaining`.
- **Validity is decided at payment:** a pack starts on the IST payment date; a grant is never born expired. With no end date a custom grant runs to the IST month end.
- **Void of a paid top-up:** refused with `grantconsumed` once any is used and `grantexpired` once it ended. It deletes the grant and returns wallet and gateway money to the wallet; offline money is not auto-credited.
- **Complimentary grants:** staff only, reason mandatory, no invoice.
- **Enforcement modes** per account and channel: `COUNT_ONLY` (default), `WARN`, `ENFORCE`. A global switch (`BILLING_ENFORCEMENT_ENABLED`, default **false**) makes `ENFORCE` behave as `WARN`. Roll out by counting for at least a month and comparing with the provider's own usage, then enforcing one account at a time.
- **ENFORCE rules:** never hold back security or account messages, anything with no account, or categories flagged `never_blocked`. A held-back action is logged `BLOCKED`, not counted and not sent. The check is a cheap read with no row locks and no network call, with a short timeout, and **fails open**.
- **Missing data sends.** No allowance row for the plan, or a per-unit allowance with zero seat units, means nobody configured it, so allow.
- **Alerts** at 80% and 100% of the month's balance, once per threshold per period, only for `WARN` and `ENFORCE`; claimed with one guarded update after queuing; dedupe key stops a second send.
- **Existing in-memory AI limits** in `services/aiQuota.js` (platform AI per minute and per day) stay as **abuse speed bumps**. They are not billing. Credit metering is added beside them, not instead.
- **AI credits as a channel (recommended for Nexus):** a fixed credit price per action (editable, effective-dated), charged only on a usable result, with a reserve then settle then release sequence so a crash never charges for nothing: reserve inside a short transaction (guarded update on the period row), call the provider with no transaction open, then settle (charge) or release (0). Stale reservations are expired by a sweep after 15 minutes. Same input bytes re-read by the same account within 7 days cost 0. Log tokens, model and provider cost for a super-admin margin report; customers see credits only, never tokens.

### 5.10 Access, lockout and grace
- **Paid-until** is the subscription's `current_period_end`. Last covered day = paid-until (ACTIVE) or `trial_end_date` (TRIAL), plus **grace days** (account setting, else platform default, else 0), moved later by staff "allow access until". Locked from the next day 00:00 IST.
- **Never locked:** no subscription, CANCELLED handled as lapsed, TRIAL with no end, `never_lock`, platform lockout switch off, staff users.
- **What locked means in Nexus:** publishing, sending, scheduling and automation stop with a clear message; login, viewing, and **export** continue. Do not respond 402 to every route. The existing Nexus rule (`GRACE_DAYS = 3` in `services/entitlements.js`) becomes the default grace.
- Staff tools: per-account Access card (state, dates, allow-until, grace days, never lock, reason, history) and a platform setting (switch, default grace). Until saved, env defaults apply.
- Reminders before the lock day at D-30, 15, 5, 2, 1; the lapse job drops the cached plan to the lowest plan once, audited, with a 7-day catch-up.

### 5.11 Notifications and dunning
- Sent through the notifier port with a **dedupe key** per event, never charged to a customer's quota and never silenced by a customer's notification settings.
- Dedupe keys: `EXPIRY:{account}:{expiryDate}:{offset}`, `DUE:{invoice}:{daysBefore}` (7, 1, 0), `OVERDUE:{invoice}:{offset}` (3, 7), `INVOICE_ISSUED:{id}`, `INVOICE_PAID:{id}`, `INVOICE_PART_PAID:{id}:{amountPaid}`, `PLAN_CHANGE:{account}:{kind}:{date}`, `QUOTA:{account}:{channel}:{period}:{80|100}`.
- Plan change notices go to billing contacts when a downgrade or cancel is scheduled or undone, and the day before it takes effect.
- Recipients: billing email, then the account's owners. Failures are logged, never thrown.
- Never put a password or OTP in any billing or quota fallback message.

### 5.12 Staff console (platform admin)
- **Pricing setup:** price book, cycle discounts, tax rates (history and "add new rate"), coupons, plan features and limits, plan allowances (with change history and a preview of how many accounts a change affects; default applies from the next period, with an explicit "apply to the current month too" that never goes below what was used).
- **Accounts:** list (plan, cycle, paid-until, status, overdue), detail with subscription editor, discounts, quote preview, Access card, wallet, invoices, grants, perks tab.
- **Invoices:** filters (account, status, type, period), overdue badge, detail (lines, payments, PDF, issue, void, record payment), generate invoice with quote preview, generate history.
- **Wallets:** balances, ledger, credit (reference mandatory, proof), debit/refund (reason mandatory).
- **Usage:** per account per channel per month with a usage bar, category breakdown, paged log, summary for comparing with provider usage, policy mode selector with a confirmation for `ENFORCE`.
- **Reports (Phase 6):** MRR and ARR, new / churned / expansion, overdue ageing, collections by method, trial to paid conversion, top-up revenue, margin per channel.

### 5.13 Customer screens (billing admin)
- **Plan card** (plan, cycle, paid-until, status, next renewal, quote preview), upgrade / downgrade / cancel dialogs, plan history.
- **Billing tab:** invoices, payments, PDF, Pay now (gateway) or pay from wallet (disabled when balance is too low), wallet recharge.
- **Usage tab** per channel: used / remaining / total, reset date, category breakdown, log, Buy more (only when enforcement is on and nothing is left).
- **Wording:** under `COUNT_ONLY` and `WARN`, nothing on screen says messages or actions are blocked.
- **Money safety in the UI:** an idempotency key made when a pay dialog opens, kept after any ambiguous failure (network drop, timeout), renewed only after a clean rejection; every close refreshes the page; read the response body for `REJECTED`.
- Mobile first (360 px); copy in the host's languages (Nexus: English first, then the others).

### 5.14 Security and privacy
- Gateway keys, webhook secret and signing secrets only from environment or the host's secret store (`services/secrets.js`), never in source.
- Webhooks verified by signature with constant-time compare and a timestamp window (Nexus's existing `X-SNX-Signature` scheme uses 300 s).
- Customer PII in invoices: name, address, tax id only. Phone numbers masked in usage logs (last 4 digits).
- Proof files and PDFs private; signed links short-lived.
- Rate-limit checkout and payment endpoints (reuse `middleware/rateLimit.js`).
- No endpoint accepts `account_id` from a customer request. Add a test that fails if a customer route reads it.

---

## 6. Data model

Types: `id` = increments integer, `money` = integer minor units, `ts` = integer epoch seconds, `date` = `YYYY-MM-DD` string(10).
Every table also has `created_at ts`, and mutable tables have `updated_at ts`, `created_by`, `updated_by`.

### 6.1 Catalogue
| Table | Columns |
|---|---|
| `bill_plan` | code PK string(30), name, rank int, active bool, public bool |
| `bill_plan_feature` | plan_code, feature_key, enabled bool; unique(plan_code, feature_key) |
| `bill_plan_limit` | plan_code, limit_key, value int (-1 unlimited); unique(plan_code, limit_key) |
| `bill_price_book` | plan_code, pricing_model, unit_price_minor >= 0, effective_from date, effective_to date?, active, description; unique(plan_code, pricing_model, effective_from) |
| `bill_cycle_discount` | billing_cycle unique, discount_percent 0..100 (two decimals as integer hundredths) |
| `bill_tax_rate` | tax_name, rate_hundredths 0..10000, effective_from date unique |
| `bill_coupon` | code unique (lowercase), discount_type, discount_value, valid_from?, valid_to?, max_redemptions?, redemptions default 0, active |

### 6.2 Subscription
| Table | Columns |
|---|---|
| `bill_subscription` | account_id unique, plan_code, pricing_model, billing_cycle, custom_cycle_months?, unit_price_override_minor?, quantity_override?, trial_end_date?, current_period_start?, current_period_end?, status, auto_invoice default true, billing_email?, tax_id?, billing_address?, scheduled_plan_code?, scheduled_plan_effective?, cancel_requested_on?, cancel_effective_on?, notes(500), version |
| `bill_account_discount` | account_id, discount_type, discount_value, valid_from, valid_to?, reason NOT NULL, active |
| `bill_account_override` | account_id, kind (FEATURE/LIMIT/ALLOWANCE), key, value, valid_from, valid_until?, reason NOT NULL, active; partial unique active per (account, kind, key) |
| `bill_access_setting` | single row: lockout_enabled, default_grace_days |
| `bill_account_access` | account_id unique, grace_days?, allow_until?, never_lock, reason, updated_by |

### 6.3 Invoices
| Table | Columns |
|---|---|
| `bill_invoice_sequence` | fy PK string(7), last_seq int |
| `bill_invoice` | invoice_number? unique, fy?, seq?, account_id, invoice_type, source, period_start, period_end, issue_date?, due_date?, subtotal_minor, discount_total_minor, taxable_minor, tax_name, tax_rate_hundredths, tax_minor, total_minor, amount_paid_minor, status, is_backdated, upgrades_invoice_id?, buyer_name, buyer_address, buyer_tax_id, seller_snapshot (json text), pdf_key?, void_reason?, voided_at?, idempotency_key unique (`SUB:{account}:{periodStart}`), version |
| `bill_invoice_line` | invoice_id, line_type (CHARGE/DISCOUNT/TAX), description, qty, unit_price_minor, amount_minor, sort_order |
| `bill_credit_note` | reserved for a later phase: invoice_id, amount_minor, reason, created_by |

### 6.4 Payments and wallet
| Table | Columns |
|---|---|
| `bill_payment` | account_id, invoice_id? (null = wallet recharge), method, amount_minor, status (CREATED/CAPTURED/FAILED/REJECTED), gateway_order_id unique?, gateway_payment_id unique?, reference_number?, received_by?, paid_at?, failure_reason?, idempotency_key unique, note |
| `bill_wallet` | account_id unique, balance_minor >= 0, version |
| `bill_wallet_txn` | as section 5.8 |

### 6.5 Metering
| Table | Columns |
|---|---|
| `bill_plan_allowance` | plan_code, channel, per_unit_per_month, per_account_per_month, min_per_month, max_per_month?, updated_by; unique(plan_code, channel) |
| `bill_allowance_change` | plan_code, channel, old and new values, effective_from, applied_to_current, reason, changed_by (append-only) |
| `bill_quota_period` | account_id, channel, period_start, period_end, plan_included, topup_added (kept 0; computed on read), used >= 0, alert_80_sent_on?, alert_100_sent_on?; unique(account_id, channel, period_start) |
| `bill_usage_event` | account_id?, channel, category, billable, status (SENT/FAILED/BLOCKED), quantity, actor_user_id?, ref?, created_at; indexes (account_id, created_at), (channel, created_at). Kept 13 months. |
| `bill_policy` | account_id, channel, mode default COUNT_ONLY, updated_by; unique(account_id, channel) |
| `bill_topup_pack` | code unique, name, channel, quantity > 0, price_minor >= 0, validity_type, validity_days?, active |
| `bill_grant` | as section 5.9 |
| `bill_feature_price` | channel, feature_key, credits int, effective_from date (AI credit price list, staff editable) |
| `bill_ai_request` | idempotency_key unique, account_id, feature_key, status (RESERVED/SETTLED/FAILED/EXPIRED/DENIED/FREE_REPEAT), credits_reserved, credits_charged, input/output/cache tokens, model, provider_cost_micro_usd, latency_ms, content_sha256, error_code, created_at, settled_at |

### 6.6 Operations
| Table | Columns |
|---|---|
| `bill_job_run` | job_key, run_key, started_at, finished_at, outcome; unique(job_key, run_key) |
| `bill_audit` | actor, action, entity, entity_id, old_value, new_value, reason, created_at |
| `bill_webhook_event` | gateway, event_id unique, payload (text), received_at, processed_at?, outcome |

### 6.7 Indexes that matter
`bill_invoice(account_id, status)`, `bill_invoice(period_start)`, `bill_payment(invoice_id)`, `bill_wallet_txn(account_id, created_at desc)`,
`bill_usage_event(account_id, created_at)`, partial unique on active overrides, partial unique `bill_grant(invoice_id)`.
SQLite supports partial indexes; write them with `knex.raw`.

---

## 7. REST contract

Base paths: staff `/api/billing/admin/**`, customer `/api/billing/my/**`, public `/billing/webhook/razorpay` (PLAN 6; `/billing/webhook` belongs to the old licence-server client until B4 removes it). All JSON. Errors: `{ error, code, field? }` with HTTP status; codes below are stable and the UI maps them to text.

### 7.1 Customer (`/api/billing/my`, billing admin)
| Method and path | Purpose |
|---|---|
| `GET /subscription` | plan, cycle, paid-until, status, next renewal, quote preview, lock state, scheduled change, cancel state |
| `GET /plans` | public plans with features, limits and the price for this account |
| `POST /checkout` `{planCode, cycle, couponCode?, taxId?, address?}` | start paying; returns gateway order and draft invoice id |
| `POST /checkout/verify` | gateway callback; returns `{status: CAPTURED|REJECTED, invoiceId, walletCredited?}` (HTTP 200 for both) |
| `POST /plan/upgrade`, `/plan/downgrade`, `/plan/cancel`, `/plan/undo` | lifecycle |
| `GET /plan/history` | from audit |
| `GET /invoices`, `GET /invoices/{id}`, `GET /invoices/{id}/pdf` | invoices (never drafts) |
| `GET /payments` | `CAPTURED` only |
| `POST /invoices/{id}/pay/wallet` | pay from wallet (Idempotency-Key) |
| `GET /wallet`, `GET /wallet/ledger`, `POST /wallet/recharge` | wallet |
| `GET /usage?channel&period`, `GET /usage/log`, `GET /packs`, `GET /grants`, `POST /topups/wallet`, `POST /topups/gateway-order` | metering |
| `GET /access` | `{locked, expiredOn, canPay}` |

### 7.2 Staff (`/api/billing/admin`, platform admin)
`GET/POST/PUT` for `tax-rates`, `price-book`, `cycle-discounts`, `coupons`, `plans`, `plans/{code}/features`, `plans/{code}/limits`;
`GET /subscriptions` (paged), `GET/PUT /subscriptions/{accountId}`, `POST .../cancel`, `.../reactivate`, `DELETE ...`,
`GET/POST/PUT/DELETE /subscriptions/{accountId}/discounts`, `GET /subscriptions/{accountId}/quote`;
`GET/POST /invoices`, `POST /invoices/{id}/issue`, `/void`, `/payments`, `POST /subscriptions/{accountId}/history`;
`GET /wallets`, `GET /wallets/{accountId}`, `POST /wallets/{accountId}/credit`, `/debit`, `/reverse`;
`GET /perks/plans`, `PUT /perks/plans/{plan}/{channel}`, `POST .../preview`, `GET /perks/history`, `GET/PUT/DELETE /perks/accounts/{id}/{channel}`;
`GET /usage`, `GET /usage/{accountId}`, `GET /usage/{accountId}/log`, `GET /usage/summary`, `PUT /usage/policy/{accountId}`;
`GET/POST/PUT /packs`, `GET/POST /grants`;
`GET/PUT /access-settings`, `GET/PUT /accounts/{id}/access`;
`GET /reports/mrr`, `/reports/ageing`, `/reports/collections`.

### 7.3 Stable error codes
400 `invalidamount`, `invalidcycle`, `reasonrequired`, `invalidvalidity`, `nopaidperiod`, `nocontract`, `notadowngrade`, `invalidmode`, `invalidchannel`;
402 `subscriptionexpired`, `limitreached`, `featurenotinplan`, `quotaexhausted` (one code list with platform 13.3);
403 (no access); 404 (not found, drafts, other account's ids);
409 `alreadyinvoiced`, `openinvoiceexists`, `invoicebusy`, `invoicepartiallypaid`, `idempotencykeyreused`, `contractcancelled`, `cancelalreadyeffective`, `grantconsumed`, `grantexpired`, `alreadyvoid`, `notreversible`, `insufficientfunds`;
429 rate limited; 503 `notconfigured` when the gateway is not set up (the old client's `NOT_CONFIGURED` goes away with it in B4).

---

## 8. Scheduled jobs (IST, one run per day key)

| Time | Job | Does |
|---|---|---|
| 02:00 | `invoice-generation` | apply due scheduled downgrades and refresh effective plans; raise invoices for subscriptions whose period or trial ended and have no invoice for the next period (idempotent on `SUB:{account}:{periodStart}`); skip if a young checkout draft exists; per-item try/catch |
| 03:00 | `wallet-reconciliation` | balance vs ledger, read-only, error on drift |
| 08:00 | `reminders` | expiry D-30/15/5/2/1, due D-7/1/0, overdue +3/+7, plan-change notices |
| 09:00 | `quota-alerts` | 80% and 100% alerts for `WARN` and `ENFORCE` accounts |
| every 15 min | `checkout-expiry` | void drafts unpaid for 2 hours; expire stale AI reservations |
| 04:00 | `lapse` | drop cached plan after lockout, audited, once |
| monthly | `usage-cleanup` | delete usage events older than 13 months |

Each job: claims `bill_job_run`, logs a one-line summary with counts, swallows per-item errors, never throws out of the scheduler.

---

## 9. Configuration (env)

| Variable | Default | Meaning |
|---|---|---|
| `BILLING_ENABLED` | **false** (PLAN N4; overrides the earlier "true on server edition") | master switch for routes and jobs; the owner switches it on |
| `BILLING_CURRENCY` | INR | |
| `BILLING_INVOICE_PREFIX` | RXS | invoice number prefix |
| `BILLING_DUE_DAYS` | 7 | due date offset |
| `BILLING_SELLER_NAME / ADDRESS / GSTIN / EMAIL / PHONE` | | printed on invoices |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | | gateway; unset = checkout answers 503 `NOT_CONFIGURED` |
| `BILLING_LOCKOUT_ENABLED` | **false** until trialled | kill switch for lockout |
| `BILLING_LOCKOUT_GRACE_DAYS` | 3 | default grace |
| `BILLING_ENFORCEMENT_ENABLED` | **false** | kill switch for quota enforcement |
| `BILLING_CHECK_TIMEOUT_MS` | 500 | quota check wait |
| `BILLING_AI_ENABLED` | false | AI credit metering |
| `BILLING_WALLET_STAFF_CAP_MINOR` | 100000000 | per staff entry |

Every kill switch ships **off**. Turning one on is a deliberate, logged act.

---

## 10. Logging and observability
- One-line logs with a tag: `[BILLING_JOB]`, `[BILLING_CAPTURE]`, `[BILLING_WALLET]`, `[BILLING_QUOTA]`. Counts, no personal data.
- Log an ERROR for: reconciliation drift, a rejected capture, a webhook with an unknown order, a held-back dropped event, a quota check timeout rate above 5%.
- Health endpoint exposes: last run time per job, number of drafts older than 2 hours, number of rejected payments in 24 hours.

---

## 11. Integration with Nexus

### 11.1 What exists today (read before changing)
- `services/entitlements.js`: `DEFAULT_PLANS`, `decide(org, plan)`, grace of 3 days, `saas_plans` config override; reads `organizations.plan`, `plan_status`, `paid_until`, `trial_ends_at`.
- `services/billing.js` + `routes/billing.js`: asks an **external billing service** (`BILLING_URL`, `BILLING_SECRET`, `BILLING_APP_ID`), signs requests `X-SNX-Time` / `X-SNX-Signature`, mirrors plan state onto `organizations`.
- `services/aiQuota.js`: in-memory per-process counters (abuse limits, not billing).
- `middleware/license.js`, `services/license/*`: desktop licence, untouched.
- Migrations `20261113000001_saas_signup.js`, `...000002_business_plans.js`, `...000004_billing_checkout.js` add the organisation columns.

### 11.2 Strangler approach (**superseded by PLAN N1**)
**Not used in Nexus.** Production never configured the external service and nobody pays through it, so the built-in module is the only provider and `services/billing.js` is removed in B4. The text below is kept for other products that may need it.
Do not rip out the external service on day one.
1. Build the module beside it behind `BILLING_ENABLED` and the `ports`.
2. Keep `organizations.plan`, `plan_status`, `paid_until`, `trial_ends_at` as the **mirror** that `entitlements.js` reads. The module's subscription service writes the mirror after every change through one adapter (`ports/accountsMirror`).
3. Add a `LicenseServerAdapter` implementing the same service interface that calls the existing external service, selected by `BILLING_PROVIDER=license-server|builtin` per environment.
4. Migrate customers one at a time: import their state from the external service into `bill_subscription`, flip `BILLING_PROVIDER` for that account (`bill_account_flag`), watch a full cycle, then the next.
5. Remove the adapter only after every account has run one invoice cycle on the built-in module.
**Do not** double-bill: an account is served by exactly one provider at a time, and the nightly check reports any account with active subscriptions on both.

### 11.3 Mapping
| Billing concept | Nexus |
|---|---|
| account | `organizations.id` |
| billing admin | org roles `owner` and `billing` (Billing admin) through the `billing.*` permissions (`ACCESS-REQUIREMENTS.md` 5.2); staff through `platform.billing.manage` |
| seat unit (`PER_UNIT`) | workspaces for `agency`, users for others, **Default**: one `countSeatUnits` returning workspaces; decide per plan in the price book |
| entitlement feature keys | the canonical list in `ACCESS-REQUIREMENTS.md` 4.1 |
| limit keys | `workspaces`, `users`, `seo_sites` (current), add more as screens need them |
| channels | `AI_CREDIT` first; `WHATSAPP` (Sellbird / WhatsApp suite) and `EMAIL` next |
| notifier | `services/smtpSettings.js` and email repo |
| files | `services/mediaStore.js` |
| platform admin | `services/platformAdmin.js`, `isPlatformAdminEmail` |

### 11.4 Where Nexus code calls billing
- `entitlements.can/limit` replaces the plan lookups inside `services/entitlements.js` **without changing its return shape**.
- Create workspace, invite user, add SEO site go through `access.check` (step 8) and return 402 `limitreached`.
- AI calls (`services/aiHelper.js`, `platformAi.js`, `aiAssist.js`) call `metering.reserve` / `settle` / `release` when `BILLING_AI_ENABLED`.
- Scheduler (`services/scheduler.js`) registers the billing jobs on the server edition only.
- The signup flow creates the `TRIAL` subscription (today `trial_ends_at`).

---

## 12. Phases (each ships on its own, each with a version bump, release notes and tests)

**The order and the final split of work are in `docs/platform/ROADMAP.md`.** Mapping: B1 below is delivered as ROADMAP **A0** (engine, adapter, characterization) plus **B1** (feature gate and menu); B5 is split into **B5a** (expiry and overdue alerts, early) and **B5b** (lifecycle, paired with **P1**); AI usage counting starts early as **L2a**, and B7 pairs with **L2b** (enforcement); B6 follows **L1**. Scope and "Done when" below still apply.

| Phase | Scope | Ships dark? | Done when |
|---|---|---|---|
| **B0 Foundations** | module skeleton, ports, boundary test, migrations for 6.1 and 6.2, `PriceCalculator`, `BillingPeriods`, `AllowanceCalculator` (pure), seeder (plans from `DEFAULT_PLANS`, tax GST 0%, no coupons), staff pricing setup screens, subscription import script from `organizations` | yes (`BILLING_ENABLED` off) | unit tests for every model x cycle x discount, tax 0% and 18%, rounding, period edges, leap year; boundary test passes |
| **B1 Entitlements** | `entitlements.can/limit`, effective plan, overrides, cache and eviction, adapter into `services/entitlements.js` with identical output | yes | characterization tests prove old and new `decide()` give identical results for every plan and state before the swap |
| **B2 Wallet** | 6.4 wallet tables, credit, debit, reverse, ledger, reconciliation job, staff and customer screens | yes | 10 concurrent debits of 30 on balance 100 = exactly 3 succeed, balance 10, ledger consistent (run on SQLite and Postgres); idempotent retry; negative and zero rejected |
| **B3 Invoices and offline payments** | invoice, lines, sequence, PDF, issue, void, partial payment, staff record payment, generate history, invoice generation job | yes | scheduler run twice or in parallel = one invoice; numbers sequential per FY including 1 April IST rollover; overlap rule; PDF renders Indic text |
| **B4 Online payments and checkout** | gateway port, Razorpay adapter, checkout, capture, webhook, abandoned-draft expiry, wallet pay, customer Billing tab | gateway keys unset = 503 | webhook replay x3 and concurrent = one payment; amount mismatch rejected; money goes to wallet when the invoice cannot take it; draft leaves nothing behind |
| **B5 Lifecycle and lockout** | upgrade, downgrade, cancel, undo, grace, lockout filter (publishing/sending only), reminders, lapse job, plan history | lockout switch off | upgrade proration worked example (60493 paise) passes; downgrade scheduled and applied by the job; cancel then undo; locked account can still export |
| **B6 Metering** | `bill_quota_period`, usage events and recorder queue, allowances, staff perks screens, usage screens | count-only | usage never delays an action (inject a slow database); numbers compared with the provider for one month |
| **B7 Top-ups, AI credits, enforcement** | packs, grants on PAID, `AI_TOPUP`, AI reserve/settle/release, policy modes, alerts, kill switch | enforcement switch off | grant exactly once on every payment path; void rules; fail-open tests (timeout, error, missing data); no row locks on the send path |
| **B8 Reports and polish** | MRR, ageing, collections, margin report, credit notes if GST registered, i18n, mobile pass | | numbers tie to invoices and ledger |

**Order matters.** B1 comes before anything enforces; B5 lockout and B7 enforcement stay off until a month of data is compared. Never enable a kill switch in the same release that introduces the behaviour.

### 12.1 Definition of done (every phase)
1. Migration is idempotent and runs on empty SQLite, empty Postgres, and a copy of production data.
2. Unit tests for the pure maths; integration tests for each endpoint including the role matrix and a cross-account access test (account A cannot read or change account B).
3. Concurrency test for any write that uses a guarded update.
4. A webhook or capture replay test for anything touching payments.
5. No customer response contains internal notes, staff logins or gateway failure text (JSON key assertion).
6. Release notes (customer-safe text; staff-only items kept separate) and a changelog entry.
7. A rollback note in the migration header.
8. Staff UAT checklist and the list of what has never run for real (gateway live mode, real e-mail, real PDF fonts).

---

## 13. Lessons from UrbanSociety (read before writing any money code)

1. **Two payments for one invoice** appeared because every abandoned checkout leaves a `CREATED` row. Hide or label abandoned attempts; never count them in any total.
2. **A checkout that created invoices before payment** produced numbered invoices nobody paid. Issue at capture.
3. **Overlap checks compared only `period_start`** and missed periods with different start dates. Check real date overlap.
4. **A scheduler invoice that was voided was regenerated** the next night. A void must cancel the schedule.
5. **A failed gateway attempt silently stopped billing** because its void was treated as a waiver. Distinguish voids by cause.
6. **Throwing inside a transaction after a captured payment rolled the capture back** and lost the money. Never throw after money is captured; credit the wallet.
7. **Holding a row lock across a gateway call** starved the pool. No network inside a transaction.
8. **Quota checks inside the send path** can stall every message. Fail open, short timeout, own thread pool, no locks.
9. **A password in a fallback message** would have been stored in a notification tray. Anything secret belongs to a never-blocked category and is never put in a fallback.
10. **Hibernate floors a 1-second transaction timeout to 0**, so every check failed open and limits silently never applied. Test that enforcement actually blocks in one case.
11. **A top-up granted at order time** was granted for abandoned purchases. Grant only on PAID.
12. **A grant born expired** after a late payment. Decide validity at payment, never create an expired grant.
13. **Reusing one top-up type for two channels** credited the wrong channel. One invoice type per channel.
14. **A payment screenshot that duplicated a bank reference** was approved twice. Check the reference for duplicates (no AI needed).
15. **An overpaid bill from a rate change** left 300 INR unexplained. Show how a bill was built (separate discount lines) and keep prior rates by date.
16. **Dashboards that sum floats** drift. Integer minor units only.
17. **The migration seeded a contract for every existing customer**, which switched billing on for all of them at the next 02:00 run. A seeder must not create live contracts; importing customers is a deliberate staff action.
18. **Deploying a jar that needs a table before the table exists** takes the site down when the old process is already stopped. Run migrations first, then deploy; the deploy script stops the old process last.
19. **A 200 response is not success.** Return `CAPTURED` or `REJECTED` in the body and read it.
20. **PDFs showed "?" for Indic names** until an embedded font was added.

---

## 14. Test plan (summary)
- **Pure unit tests:** price calculator (each model, each cycle, discount stacking, floor at zero, tax 0 and 18, rounding half-up, CUSTOM months), billing periods (month ends, leap year, FY boundary 31 Mar to 1 Apr IST), allowance calculator (per-unit, per-account, clamp, override), state machine transitions, proration.
- **Integration (SQLite and Postgres):** every endpoint x role (anonymous, customer member, billing admin, platform admin) x own and other account.
- **Concurrency:** wallet debits; two invoice generations; capture and webhook racing; two grants for one invoice.
- **Failure injection:** gateway timeout, DB error in recorder, slow quota check, crash between reserve and settle.
- **Characterization tests** before replacing `entitlements.decide()`: record current outputs for every plan and state, assert equality after.
- **Security:** customer routes never read `account_id` from input; response scrubbing; webhook with bad signature, old timestamp, replayed event.
- **Manual QA script:** staff create plan and coupon; customer subscribes and pays; upgrade; downgrade; cancel and undo; wallet credit and invoice pay; quota count and top-up; lockout and export; invoice PDF with Hindi name.

---

## 15. Open decisions (defaults applied unless the owner says otherwise)

| # | Question | Default |
|---|---|---|
| D1 | Build embedded or as a standalone service? | Embedded module with ports; extract later if a second product needs it |
| D2 | Keep the external license server? | **No (PLAN N1):** not configured on production; removed in B4 |
| D3 | Seat unit for per-unit pricing in Nexus | Workspaces (the price unit; the separate seat **limit** `users` counts people, platform 6.4) |
| D4 | Tax | Single `GST` line at 0% until the seller is registered and the CA confirms CGST/SGST/IGST |
| D5 | Credit notes | Not before GST registration |
| D6 | Money type | Integer minor units |
| D7 | AI credits | Metering built in B7; enforcement only after a month of counts |
| D8 | Trial length and trial AI credits | Keep today's trial length; trial AI credits seeded unlimited until the owner sets a number (PLAN N5; platform 7.3 proposes 100 once) |
| D9 | Lockout scope | As platform 5.2 step 5: when locked, reading, export, billing, account and viewing settings work; publishing, sending, automation, AI, creating and uploading are refused. Login always works |
| D10 | Refunds to card | Manual by staff outside the system; recorded as a wallet debit with a reason |
| D11 | Partner commission / referrals | Out of scope |
| D12 | Languages | English first; keys structured for more |
