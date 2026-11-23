# Loop: Blog posting

**Cadence:** Tuesday and Friday, 08:00 IST (max 2 per week). **Skills:** content-strategy, copywriting, copy-editing, seo-audit, schema, ai-seo.
**Purpose:** rank for what Indian small businesses and agencies search, and turn readers into trials.

**Acts when:** `.agents/seo/queries.csv` has a `gap` query, no `STOP` file, and fewer than 2 posts published this week.

**Body**
1. Pick the top gap query. One primary query per post; if a page already owns it, improve that page instead.
2. Research the query's results and answers. Write a post that is more useful than what ranks: concrete steps, Indian examples, honest limits. 700–1,400 words. A link to a relevant NexaDrip feature, and one next step (start the free trial).
3. Writing gate: plain words, no AI tells, every product claim sourced from the code or release notes, no invented numbers, quotes or customers, no competitor named unless factual and fair.
4. Create `server/blog/posts/<slug>.html` with the header (`title`, `description` under 160 characters, `date`). Body is plain HTML. Link internally from the landing page or a related post.
5. Run `npx jest --runInBand`. Load `/blog/<slug>` and check title, canonical, structured data and the sitemap entry.
6. If everything passes, commit to local `master`: `feat(blog): <title>`. Otherwise save with `draft: true`.
7. Add a social post angle for the social loop and a log line.

**Escalate (draft only, owner reviews):** posts naming a competitor, quoting a customer, claiming a result, or touching legal, tax or medical advice.
**State:** `.agents/loops/blog-posting.log`; dedupe key = primary query and slug.
**Stop / bail-out:** `STOP` file; tests fail twice; a post would duplicate an existing page.
**Publish note:** committing makes the post part of the next release. The owner pushes to Bitbucket and deploys; the loop never pushes.
