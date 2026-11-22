---
name: usage-limits
description: >-
  How Nexus counts and limits usage per plan: count limits (workspaces, seats, sites, contacts), period
  limits (posts and messages per month), AI credits (reserve, settle, release, daily and per-user caps,
  platform cost cap, BYOK), and storage (file registry, org counter, upload checks, reconciliation). Use this
  whenever adding a countable thing, an AI call, a file upload or storage path, a limit or quota, a usage
  screen, or an over-limit message, even if the request only says "cap", "quota", "credits" or "storage".
---

# Usage limits (Nexus)

Spec: `docs/platform/ACCESS-AND-ENTITLEMENTS.md` section 10; metering and top-ups in
`docs/billing/REQUIREMENTS.md` section 5.9.

## One framework
- Each limit is in `modules/access/limits.js`: key, type (count | rate | size | speed), unit, period, measure,
  `blocks`, thresholds 80/100.
- Checks happen in `access.check` step 8 with `{ quantity }` or `{ bytes }`. The usage screen uses the same
  counting code, so numbers always agree.
- Measurement errors fail open (allow, log). Lowering a limit never deletes data.
- Notices at 80% and 100%, once per period, deduped by `LIMIT:{org}:{key}:{period}:{threshold}`.

## AI
- Every AI call (text, image, video, assistant, knowledge base, SEO, bots) goes through
  reserve → call (no transaction open) → settle or release. Errors, refusals, empty output and timeouts cost 0.
- Platform keys cost credits; BYOK is counted and rate-limited but not charged.
- Caps: org monthly allowance (+ top-ups), org daily cap, per-user daily cap, speed guard, platform monthly
  cost cap (pauses platform-key AI only). A new AI call site without metering fails a test.
- Never log full prompts or outputs on the platform; hashes and token counts only.

## Storage
- Every stored file is registered in `stored_file` through the files service; no module writes to disk or S3
  directly. `org_storage` changes in the same transaction; nightly reconciliation corrects drift.
- Upload: check Content-Length against file limit and remaining quota before reading; abort while streaming;
  register after write. 413 `filetoolarge` or `storagefull`. A race may overrun by at most one file.
- Trash counts for 30 days. Nothing is deleted automatically to get under a limit.

## Tests every change needs
- Limit reached → refused with the right code; under → allowed; measurement error → allowed and logged.
- Concurrency near the limit; reconciliation equals counter; other org's usage never counted.
