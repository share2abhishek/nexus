# Billing rules and traps (distilled from UrbanSociety production)

Read the matching section of `docs/billing/REQUIREMENTS.md` for the full rule. This is the quick list of
things that went wrong before.

## Invoices
- Number is allocated inside the issuing transaction, gapless per financial year (April to March, IST) from the issue date.
- Overlap check is on real date ranges, not `period_start` equality.
- Voiding a scheduler invoice cancels it (the job will not recreate it); a void caused by a checkout superseding it does not.
- Backdated invoices never advance the subscription and checkout never supersedes them.
- Paying an old invoice never changes the plan, reactivates a cancelled subscription or moves dates backwards.
- Overdue is derived, never stored.

## Payments
- Capture is one function used by callback and webhook, idempotent on the gateway payment id.
- Amount mismatch or a different payment id for the same order: REJECTED, recorded, not applied.
- If a capture cannot be applied, the money goes to the wallet. Never throw after money is captured.
- Hide or label abandoned `CREATED` attempts; they must not look like duplicate payments or enter any total.
- `verify` returns HTTP 200 with `CAPTURED` or `REJECTED` in the body; the UI reads the body.

## Wallet
- Debit with `UPDATE ... SET balance = balance - a WHERE balance >= a`; zero rows means insufficient funds.
- Ledger is append-only; fix mistakes with a REVERSAL entry (once per entry).
- Staff per-entry cap does not apply to system postings.

## Metering and enforcement
- Record usage after the action, through a bounded queue; a failure in recording never affects the action.
- Enforcement check: no locks, no network, short timeout, own small thread pool, fails open.
- A 1-second transaction timeout can floor to 0 in some stacks and make every check fail open: test that
  ENFORCE really blocks in one case.
- Missing allowance data means allow. Never block security, account or password messages.
- Grants are created only when the top-up invoice is paid, in the same transaction, once (unique invoice link).
- A grant is never born expired; validity is decided at payment.
- One top-up invoice type per channel.
- Show the server's `used`, `remaining` and `percentUsed`; never derive them from `total`.

## Entitlements
- Effective plan = highest plan among paid periods covering today, not the last clicked plan.
- Cache per account for 60 s and evict on every write.
- Expired customers can still log in, view and export. Block publishing, sending and automation only.

## Rollout
- Seeders never create live subscriptions or overwrite staff-edited rows. Importing customers is a deliberate staff action.
- Migrations run before the new code is deployed. The old process stops last.
- Kill switches ship off. Never enable one in the release that introduces the behaviour.
- Run the nightly comparison (billing totals before and after each release) and stop on any unexplained change.
