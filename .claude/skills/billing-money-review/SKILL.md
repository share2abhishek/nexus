---
name: billing-money-review
description: >-
  Review checklist for money-touching billing code in Nexus (invoices, payments, wallet, grants, quota,
  entitlements, webhooks). Use this when reviewing or self-checking any change under modules/billing, any
  payment or webhook code, or before releasing a billing phase.
---

# Billing money review

Review the diff against each question. A "no" or "unsure" is a finding. Report file and line, the failing scenario with concrete inputs, and the fix.

## Who and what
- Does every customer route take the account only from the session? Is there any read of `account_id` from body, query or header?
- Does every state-changing route check the role through the central access service? Do existing endpoints gain a side effect that a lower role can now trigger?
- Can account A read, change or pay anything of account B by guessing an id? Do drafts and other accounts' ids return 404?
- Do customer responses and PDFs leave out internal notes, staff logins, gateway failure text?

## Money
- Any float, decimal column, or `Number` arithmetic on rupees instead of integer paise? Any percentage applied twice or rounded more than once per line?
- Do invoice lines add up exactly to the total? Is the total stored, not recomputed?
- Is tax taken at the issue date and the price at the period start?

## Concurrency and idempotency
- Does every money write carry an idempotency key, and does a different payload with the same key give 409?
- Is each state change a guarded `UPDATE ... WHERE <expected state>` with the affected-row count checked? Could two requests both succeed?
- Does correctness depend on a row lock? (It must not; SQLite has none.)
- Could a retry, a double tap, a webhook replay or a webhook racing the callback create a second payment, invoice, grant or wallet entry?

## Transactions
- Any gateway, email, S3 or other network call inside a transaction?
- Any throw after money was captured that would roll the capture back?
- Is anything created before payment that an abandoned checkout would leave behind (numbered invoice, coupon use, grant)?
- If a captured payment cannot be applied, does the money reach the wallet?

## Lifecycle
- Can paying an old invoice change the plan, reactivate a cancelled subscription or move dates backwards?
- Does an upgrade, downgrade or cancel cut a paid period short or refund anything? (It must not.)
- Is overlap checked on real date ranges? Does voiding a scheduler invoice stop it being recreated, while a checkout supersede does not?
- Is the effective plan the highest paid plan covering today?

## Limits and enforcement
- Does the check fail open on error, timeout and missing data? Is there a test that proves ENFORCE blocks in one case?
- No locks and no network call in the check? Are security, account and password messages never blocked? Does any fallback message contain a secret?
- Is the kill switch default off, and is it not enabled in the same release?
- Are usage events written after the action and unable to delay or fail it?

## Rollout
- Is the migration idempotent, safe to run twice, and runnable before the new code? Is there a rollback note?
- Does the seeder avoid creating live subscriptions and overwriting staff edits?
- Is there a before/after comparison of totals for this release?

Output: findings most severe first, each with a concrete failing scenario. Do not report style.
