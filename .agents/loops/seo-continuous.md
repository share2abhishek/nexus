# Loop: Continuous SEO

Follows `.claude/skills/marketing-loops/references/seo-operator.md`. Site: https://nexus.radixile.com. Conversion: free-trial start.
**Cadence:** daily crawl; weekly report on Mondays. **Skills:** seo-audit, schema, ai-seo, site-architecture, content-strategy.

**Body (each run)**
1. Fetch `/sitemap.xml`, `/robots.txt`, `/`, `/blog`, every post. Check status codes, titles, descriptions, canonicals, `noindex`, broken internal links, structured data, and that main content is in the server-rendered HTML.
2. Claim drift: compare prices and features on the landing page, blog and help page against `public/landing.html` and `docs/RELEASE-NOTES.md`.
3. Ship the top queue item in `.agents/seo/queue.md`. One change at a time; finish before starting the next.
4. Weekly: striking-distance queries (if Search Console is connected), internal linking, AI-answer check, competitor sitemap diff, report in `.agents/seo/reports/<date>.md`.

**Self-check before shipping:** `npx jest --runInBand` passes; load the changed page and read it; the product is the source of truth.
**Acts autonomously:** titles, descriptions, schema, internal links, sitemap, new pages that match the query map, claim fixes on marketing pages.
**Needs the owner:** deleting, noindexing or redirecting a page with traffic or backlinks; any change to the product or pricing; domain, DNS or robots changes that block crawling.
**Data not connected:** Search Console, analytics, rank and backlink tools. Report "not verified" and never estimate.
**State:** `.agents/seo/` files and `.agents/loops/seo-continuous.log`.
**Stop / bail-out:** `STOP` file; the same fix failing twice (record and raise in the report).
