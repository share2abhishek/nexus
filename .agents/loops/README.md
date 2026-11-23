# NexaDrip marketing loops

Authorized by the owner on 2026-11-22: less human intervention. Context: `.agents/product-marketing.md`.
Rules come from `.claude/skills/marketing-loops/references/loop-guardrails.md`.

## What runs unattended

| Loop | Cadence | Autonomous (Tier 1 + authorized Tier 2) | Needs the owner |
|------|---------|------------------------------------------|-----------------|
| [Social posting](social-posting.md) | Daily | Draft and schedule NexaDrip's own posts; publish within caps | Complaints, crisis, newsjacking, pricing or legal claims |
| [Ad creation](ad-creation.md) | Weekly | Write ad copy, angles and image briefs into drafts | Launching or spending: no ad account connected, so nothing is spent |
| [Continuous SEO](seo-continuous.md) | Daily crawl, weekly report | Fix titles, descriptions, schema, internal links, sitemap; commit to `master` after tests pass | Deleting, noindexing or redirecting a page with traffic; product or pricing changes |
| [Blog posting](blog-posting.md) | 2 posts a week | Write, check and publish a post (add a file in `server/blog/posts/`), commit to `master` after tests pass | Posts that name a competitor, quote a customer, or claim a result |

## Shared rules

1. **The product is the source of truth.** Facts come from the code, `docs/RELEASE-NOTES.md` and the landing page. Never invent customers, metrics, testimonials or prices.
2. **Writing gate.** Plain words, no "it's not X, it's Y", no "no X, no Y, no Z" lists, no "fully autonomous", no guaranteed-ranking claims. Check against the Brand Voice table.
3. **Commit, never push.** Commit to local `master`. Pushing and deploying stay with the owner (Bitbucket only, never the `github` remote; a deploy runs from the release tag).
4. **Tests first.** `npx jest --runInBand` must pass before any commit. If it fails twice, stop and log it.
5. **State.** Each loop appends one line per run to `.agents/loops/<loop>.log` (date, acted or skipped, why, ids only, no personal data).
6. **Caps.** Social: max 1 post per platform per day, 5 per platform per week. Blog: max 2 posts per week, 1 per day. Ads: no spend at all.
7. **Kill switch.** Create the file `.agents/loops/STOP` to halt every loop. Each run checks for it first and exits. Disable the schedules in the scheduler to stop them entirely.
8. **Always escalate:** negative mentions, complaints, legal, medical or financial topics, revenue or spend anomalies, anything that would delete data.
