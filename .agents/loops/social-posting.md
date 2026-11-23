# Loop: Social posting (NexaDrip's own accounts)

**Cadence:** daily, 09:00 IST. **Skills:** social, copywriting, copy-editing, image.
**Purpose:** keep NexaDrip visible with steady, useful posts.

**Acts when:** the calendar has fewer than 3 days of scheduled posts for a connected platform, and no `STOP` file exists.

**Body**
1. Read `.agents/product-marketing.md`, the last 14 days of the log, and `docs/RELEASE-NOTES.md` (Unreleased and latest release).
2. Pick today's angle from: a shipped feature in customer words, a festival or seasonal hook (Indian calendar), a how-to from the blog, a tip for agencies. Do not repeat an angle used in the last 14 days.
3. Draft one post per connected platform in that platform's format, with first comment and hashtags.
4. Self-check: every fact appears in the product docs; no pricing unless it matches the landing page; passes the writing gate; not a duplicate of a post already scheduled.
5. Schedule through NexaDrip's own scheduler (the app's posts API) for the owner's brand workspace, at the platform's best time. Publish without approval only if all checks pass.

**State:** `.agents/loops/social-posting.log`; dedupe key = angle + date.
**Stop / bail-out:** `STOP` file; a platform token error (log it, skip that platform); two failures in a row (halt and note in the weekly report). If a failed check can't be fixed, save as a draft instead of scheduling.
**Never autonomous:** replies to comments or DMs, complaints, newsjacking, price changes, testimonials, anything naming a competitor.
**Output:** scheduled posts plus one log line. Weekly summary lines go into `.agents/seo/reports/` weekly report.
