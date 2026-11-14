// SEO autopilot: re-checks the workspace's website on a schedule (or when asked),
// keeps each page's results, and turns problems into a short to-do list in plain
// words. It never changes the website and never posts by itself: a Google Business
// post it suggests waits in the Calendar for someone's OK.
const seoCheck = require('./seoCheck');

const DAY = 86400;
const FREQUENCIES = { daily: DAY, weekly: 7 * DAY };
const now = () => Math.floor(Date.now() / 1000);
const json = (v, fallback) => { if (!v) return fallback; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return fallback; } };

// ── Which pages to check ────────────────────────────────────────────────────
function sameSite(a, b) {
  try { return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, ''); } catch { return false; }
}

const locs = (xml) => (String(xml).match(/<loc>\s*([^<\s]+)\s*<\/loc>/gi) || []).map((m) => m.replace(/<\/?loc>/gi, '').trim());

async function fromSitemap(home, sitemapUrl, max) {
  const out = [];
  const r = await seoCheck.fetchText(sitemapUrl, { accept: 'application/xml,text/xml,*/*', maxBytes: 5 * 1024 * 1024, timeout: 12000 });
  if (r.status < 200 || r.status >= 300) return out;
  if (/<sitemapindex\b/i.test(r.body)) {
    // An index of sitemaps: read the first few
    for (const child of locs(r.body).slice(0, 3)) {
      if (out.length >= max) break;
      try { out.push(...(await fromSitemap(home, child, max - out.length))); } catch {}
    }
  } else {
    for (const u of locs(r.body)) if (sameSite(u, home) && !out.includes(u)) out.push(u);
  }
  return out.slice(0, max);
}

// Links on the home page that stay on the same site (when there's no sitemap)
function internalLinks(html, base) {
  const out = [];
  for (const m of String(html).match(/<a\b[^>]*href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi) || []) {
    const href = m.replace(/^.*href\s*=\s*/i, '').replace(/^["']|["']$/g, '');
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      u.hash = '';
      if (!/^https?:$/.test(u.protocol) || !sameSite(u.href, base)) continue;
      if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js)$/i.test(u.pathname)) continue;
      if (!out.includes(u.href)) out.push(u.href);
    } catch {}
  }
  return out;
}

// The pages to check, home page first; pages.fromSitemap lists the ones a sitemap named
async function discoverPages(siteUrl, max = 20) {
  const home = seoCheck.normaliseUrl(siteUrl);
  const pages = [home];
  pages.fromSitemap = new Set();
  const origin = new URL(home).origin;
  // robots.txt "Sitemap:" lines, then /sitemap.xml
  let sitemaps = [];
  try {
    const r = await seoCheck.fetchText(`${origin}/robots.txt`, { accept: 'text/plain,*/*', maxBytes: 512 * 1024, timeout: 8000 });
    if (r.status >= 200 && r.status < 300) sitemaps = seoCheck.robotsRules(r.body).sitemaps;
  } catch {}
  if (!sitemaps.length) sitemaps = [`${origin}/sitemap.xml`];
  for (const sm of sitemaps.slice(0, 2)) {
    if (pages.length >= max) break;
    try {
      for (const u of await fromSitemap(home, sm, max)) {
        pages.fromSitemap.add(u);
        if (!pages.includes(u) && pages.length < max) pages.push(u);
      }
    } catch {}
  }
  if (pages.length === 1) {
    try {
      const r = await seoCheck.fetchText(home, { timeout: 30000 });
      for (const u of internalLinks(r.body, r.finalUrl)) if (!pages.includes(u) && pages.length < max) pages.push(u);
    } catch {}
  }
  return pages;
}

// ── From check results to to-dos ────────────────────────────────────────────
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// One rule per check: how urgent, and the to-do's wording for N pages
const RULES = {
  status:      { status: 'bad',  priority: 1, title: (n) => `${plural(n, 'page doesn’t', 'pages don’t')} open for Google`, detail: 'Google can’t list a page that answers with an error. Fix or remove links to it.' },
  robots_txt:  { status: 'bad',  priority: 1, title: (n) => `robots.txt blocks Google from ${plural(n, 'page', 'pages')}`, detail: 'Your robots.txt file tells Google not to read these pages. Ask whoever manages your website to allow them, unless you hid them on purpose.' },
  noindex:     { status: 'bad',  priority: 1, title: (n) => `${plural(n, 'page is', 'pages are')} hidden from Google (“noindex”)`, detail: 'These pages ask Google not to show them. In WordPress this is often a “Discourage search engines” or SEO-plugin setting.' },
  https:       { status: 'warn', priority: 2, site: true, title: () => 'Your website isn’t secure (no https)', detail: 'Browsers mark it “Not secure” and Google prefers https. Most hosts offer a free certificate: turn it on in your hosting settings.' },
  sitemap:     { status: 'warn', priority: 2, site: true, title: () => 'No sitemap found', detail: 'A sitemap lists your pages for Google. Most website builders and SEO plugins make one: turn it on, then add it in Google Search Console.' },
  canonical:   { status: 'warn', priority: 2, title: (n) => `${plural(n, 'page points', 'pages point')} Google to a different address`, detail: 'Their “canonical” address is another page, so Google may list that one instead. Check this is intended.' },
  title:       { status: 'bad',  priority: 2, title: (n) => `${plural(n, 'page has', 'pages have')} no title`, detail: 'The title is the blue link people click on Google. Social-Nexus can write one for each page.', draft: 'meta' },
  title_len:   { status: 'warn', check: 'title', priority: 3, title: (n) => `${plural(n, 'page title is', 'page titles are')} too short or too long`, detail: 'Aim for 30–60 characters, with your main search phrase near the start.', draft: 'meta' },
  description: { status: 'bad',  priority: 2, title: (n) => `${plural(n, 'page has', 'pages have')} no description`, detail: 'Without one, Google picks a random bit of the page. Social-Nexus can write one for each page.', draft: 'meta' },
  desc_len:    { status: 'warn', check: 'description', priority: 3, title: (n) => `${plural(n, 'page description is', 'page descriptions are')} too short or too long`, detail: 'Aim for 70–160 characters that make people want to click.', draft: 'meta' },
  h1:          { status: 'warn', priority: 3, title: (n) => `${plural(n, 'page has', 'pages have')} no clear main heading`, detail: 'Give each page one main heading (H1) that says what it is about.' },
  words:       { status: 'warn', priority: 3, title: (n) => `${plural(n, 'page has', 'pages have')} very little text`, detail: 'Pages with only a few words are hard for Google to understand. Add a few useful paragraphs.' },
  alt:         { status: 'warn', priority: 3, title: (n) => `${plural(n, 'page has', 'pages have')} pictures without descriptions`, detail: 'Describe each picture in its “alt text”: it helps Google Images and people using screen readers.' },
  mobile:      { status: 'warn', priority: 2, title: (n) => `${plural(n, 'page isn’t', 'pages aren’t')} set up for phones`, detail: 'Most searches happen on phones and Google ranks the phone version. Ask your website builder for a “responsive” or mobile layout.' },
  social:      { status: 'warn', priority: 3, title: (n) => `${plural(n, 'page has', 'pages have')} no share preview`, detail: 'When shared on WhatsApp or Facebook these pages show no picture or title (og:image / og:title). Most SEO plugins add them.' },
};

// Which rule a failed check belongs to
function ruleFor(check) {
  if (check.status === 'good') return null;
  if (check.id === 'title') return check.status === 'bad' ? 'title' : 'title_len';
  if (check.id === 'description') return check.status === 'bad' ? 'description' : 'desc_len';
  if (RULES[check.id] && (RULES[check.id].status === check.status || check.status === 'bad')) return check.id;
  return null;
}

function buildIssues(results, phrases, previous) {
  const issues = new Map();
  const add = (key, base, url, extra = {}) => {
    const it = issues.get(key) || { key, kind: 'fix', priority: base.priority, pages: [], draft: base.draft || null, rule: base, ...extra };
    if (url && !it.pages.includes(url)) it.pages.push(url);
    issues.set(key, it);
  };
  for (const r of results) {
    if (r.error) { add('status', RULES.status, r.url); continue; }
    const before = previous.get(r.url);
    for (const c of r.checks) {
      const ruleKey = ruleFor(c);
      if (!ruleKey) continue;
      const rule = RULES[ruleKey];
      add(ruleKey, rule, rule.site ? null : r.url);
      // Worse than last time: move it up and say so
      const was = before?.find((x) => x.id === c.id);
      if (was && was.status === 'good') {
        const it = issues.get(ruleKey);
        it.priority = 1;
        it.changed = true;
      }
    }
  }
  for (const it of issues.values()) {
    const n = it.pages.length || 1;
    it.title = it.rule.title(n);
    it.detail = `${it.rule.detail}${it.changed ? ' This appeared since the last check.' : ''}`;
    delete it.rule;
  }

  // Search phrases no page is about: every word of the phrase (except small words
  // like "in", "for") in the page's title or main heading
  const ok = results.filter((r) => !r.error);
  const SMALL = new Set(['in', 'for', 'the', 'a', 'an', 'of', 'and', 'to', 'near', 'me', 'at', 'on', 'with', 'best']);
  const wordsOf = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  for (const phrase of phrases) {
    const p = phrase.toLowerCase();
    const need = wordsOf(phrase).filter((w) => !SMALL.has(w));
    const covered = ok.some((r) => {
      const have = new Set(wordsOf(`${r.title || ''} ${(r.h1 || []).join(' ')}`));
      return need.length ? need.every((w) => have.has(w)) : false;
    });
    if (!covered && ok.length) {
      issues.set(`phrase:${p}`, {
        key: `phrase:${p}`, kind: 'idea', priority: 2, pages: [], draft: 'page',
        title: `No page is about “${phrase}”`,
        detail: 'Google matches searches to pages mainly by their title and main heading. Make a page for this phrase (or rename a page that fits). Social-Nexus can draft one.',
        phrase,
      });
    }
  }
  return [...issues.values()];
}

// ── Saving to-dos ───────────────────────────────────────────────────────────
async function saveTasks(db, site, issues) {
  const t = now();
  const existing = await db('seo_tasks').where({ workspace_id: site.workspace_id }).whereIn('kind', ['fix', 'idea']);
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const seen = new Set();
  for (const it of issues) {
    seen.add(it.key);
    const row = {
      site_id: site.id, kind: it.kind, priority: it.priority, title: it.title, detail: it.detail,
      pages_json: JSON.stringify(it.pages || []), updated_at: t,
    };
    const old = byKey.get(it.key);
    if (!old) {
      await db('seo_tasks').insert({ workspace_id: site.workspace_id, key: it.key, status: 'open', created_at: t, draft_json: it.phrase ? JSON.stringify({ phrase: it.phrase }) : null, ...row });
    } else if (old.status === 'dismissed') {
      await db('seo_tasks').where({ id: old.id }).update({ pages_json: row.pages_json, updated_at: t }); // you said it doesn't matter: stays hidden
    } else if (old.status === 'done' || old.status === 'resolved') {
      // Marked fixed, but the check still finds it
      await db('seo_tasks').where({ id: old.id }).update({ ...row, status: 'open', closed_at: null, detail: `${it.detail} Still found on the latest check.` });
    } else {
      await db('seo_tasks').where({ id: old.id }).update(row);
    }
  }
  // Gone from the latest check: fixed
  for (const e of existing) {
    if (!seen.has(e.key) && (e.status === 'open' || e.status === 'done')) {
      await db('seo_tasks').where({ id: e.id }).update({ status: 'resolved', closed_at: t, updated_at: t });
    }
  }
}

// ── Keeping the Google Business profile active ──────────────────────────────
// The business's own AI keys on the server; the install's .env keys on the desktop app
function aiDefaults(workspaceId, given) {
  return require('./businessSettings').aiOptionsFor(workspaceId, given);
}

async function writeGooglePost({ business, about, phrases, workspaceId }) {
  const { aiGenerate } = require('./aiHelper');
  const prompt = `Write a short Google Business Profile update for ${business || 'a local business'}.
What they do: ${about || '(see the phrases)'}
Search phrases they want to be found for: ${phrases.join(', ') || '(none)'}
Rules: 2–4 short sentences, friendly and specific, use one of the phrases naturally, no prices, dates, offers or claims that aren't given above, no hashtags, no placeholders like [Name]. Reply with the post text only.`;
  const opts = await aiDefaults(workspaceId);
  const r = await aiGenerate(prompt, opts.googleKey, 300, null, opts);
  const text = String(r.text || '').trim().replace(/^"([\s\S]*)"$/, '$1').trim();
  if (!text || /\[[^\]]+\]|\{\{/.test(text)) throw new Error('The AI draft wasn’t usable.');
  return text.slice(0, 1500);
}

async function googleQuiet(db, site, phrases, homeResult) {
  const t = now();
  const openTask = await db('seo_tasks').where({ workspace_id: site.workspace_id, kind: 'post' }).whereIn('status', ['open']).first();
  if (openTask) {
    // The suggested post was published, scheduled or removed: done
    const item = openTask.content_item_id ? await db('content_items').where({ id: openTask.content_item_id }).first() : null;
    if (openTask.content_item_id && (!item || ['scheduled', 'published', 'approved'].includes(item.status))) {
      await db('seo_tasks').where({ id: openTask.id }).update({ status: 'resolved', closed_at: t, updated_at: t });
    }
    return;
  }
  if (!site.gbp_quiet_days) return;
  const account = await db('social_accounts').where({ workspace_id: site.workspace_id, platform: 'google_business' }).whereNotNull('access_token').first();
  if (!account) return;
  const since = t - site.gbp_quiet_days * DAY;
  const recent = await db('content_items').where({ workspace_id: site.workspace_id })
    .where('platforms', 'like', '%google_business%')
    .where((q) => q.where('created_at', '>=', since).orWhere('scheduled_at', '>=', since).orWhere('published_at', '>=', since))
    .first('id').catch(() => null);
  if (recent) return;

  const brand = await require('./brand').profile(site.workspace_id, db);
  let contentId = null;
  let detail;
  try {
    const body = await writeGooglePost({ business: brand?.company_name, about: homeResult?.description || homeResult?.title, phrases, workspaceId: site.workspace_id });
    const [row] = await db('content_items').insert({
      workspace_id: site.workspace_id, title: 'Google update (suggested by SEO autopilot)', body,
      platforms: JSON.stringify(['google_business']), social_account_ids: JSON.stringify([account.id]),
      status: 'in_review', created_at: t, updated_at: t,
    }).returning('id');
    contentId = row?.id ?? row;
    detail = 'A short update is waiting for your OK on the Calendar (“In review”). Edit it if you like, then approve and publish or schedule it. Regular posts keep your profile active on Search and Maps.';
  } catch {
    detail = 'Write a short update in Create post (tick Google Biz). Regular posts keep your profile active on Search and Maps. (Social-Nexus couldn’t write a draft: no AI was available.)';
  }
  await db('seo_tasks').insert({
    workspace_id: site.workspace_id, site_id: site.id, key: `gbp-quiet:${t}`, kind: 'post', priority: 2,
    title: `Your Google Business profile has had no post for ${site.gbp_quiet_days} days`, detail,
    content_item_id: contentId, status: 'open', created_at: t, updated_at: t,
  });
}

// ── One run ─────────────────────────────────────────────────────────────────
const running = new Set();

async function runSite(db, site, options = {}) {
  if (running.has(site.id)) return { skipped: true };
  running.add(site.id);
  const t = now();
  try {
    await db('seo_sites').where({ id: site.id }).update({ last_status: 'running', updated_at: t });
    const pages = await discoverPages(site.url, site.max_pages || 20);
    const tracked = await db('seo_keywords').where({ workspace_id: site.workspace_id }).pluck('keyword').catch(() => []);
    const phrases = [...new Set([...json(site.phrases_json, []), ...tracked].map((p) => String(p).trim()).filter(Boolean))].slice(0, 20);

    // The last results for each page, to spot what got worse
    const previous = new Map();
    for (const url of pages) {
      const last = await db('seo_page_checks').where({ site_id: site.id, url }).orderBy('checked_at', 'desc').first();
      if (last) previous.set(url, json(last.checks_json, []));
    }

    const results = [];
    for (const url of pages) {
      if (results.length > 0) await new Promise((res) => setTimeout(res, 100));
      try {
        const r = await seoCheck.checkPage(url);
        // A page that doesn't open: only that matters (not its missing title etc.)
        if (r.status >= 400) throw new Error(`answers ${r.status}`);
        const checks = r.checks.map(({ id, status, label, detail }) => ({ id, status, label, detail }));
        results.push({
          url, checks, title: r.page.title, description: r.page.description, h1: r.page.h1,
          status: r.status, redirects: r.redirects, canonical: r.page.canonical, json_ld: r.page.json_ld, links: r.page.links,
          fromSitemap: pages.fromSitemap?.has(url),
        });
        await db('seo_page_checks').insert({
          workspace_id: site.workspace_id, site_id: site.id, url, checked_at: t, http_status: r.status,
          title: r.page.title || null, description: r.page.description || null, checks_json: JSON.stringify(checks),
          good: r.counts.good, warn: r.counts.warn, bad: r.counts.bad,
        });
      } catch (err) {
        results.push({ url, error: err.message, checks: [], fromSitemap: pages.fromSitemap?.has(url) });
        await db('seo_page_checks').insert({ workspace_id: site.workspace_id, site_id: site.id, url, checked_at: t, error: err.message, bad: 1, good: 0, warn: 0 });
      }
    }
    // If the home page failed on first pass, retry it once before declaring total run failure
    if (results[0]?.error && results.every((r) => r.error)) {
      try {
        const r = await seoCheck.checkPage(pages[0], { timeout: 35000 });
        if (r.status < 400) {
          const checks = r.checks.map(({ id, status, label, detail }) => ({ id, status, label, detail }));
          results[0] = {
            url: pages[0], checks, title: r.page.title, description: r.page.description, h1: r.page.h1,
            status: r.status, redirects: r.redirects, canonical: r.page.canonical, json_ld: r.page.json_ld, links: r.page.links,
            fromSitemap: pages.fromSitemap?.has(pages[0]),
          };
          await db('seo_page_checks').where({ site_id: site.id, url: pages[0], checked_at: t }).del();
          await db('seo_page_checks').insert({
            workspace_id: site.workspace_id, site_id: site.id, url: pages[0], checked_at: t, http_status: r.status,
            title: r.page.title || null, description: r.page.description || null, checks_json: JSON.stringify(checks),
            good: r.counts.good, warn: r.counts.warn, bad: r.counts.bad,
          });
        }
      } catch {}
    }
    // The home page not opening at all is the run failing, not a to-do
    if (results[0]?.error && results.every((r) => r.error)) throw new Error(results[0].error);

    // Whole-site checks: broken links, duplicates, soft 404s, page speed…
    const site_ = await require('./seoSiteChecks').runAll(results, pages[0], { pageSpeed: options.pageSpeed !== false });
    const issues = buildIssues(results, phrases, previous);
    for (const it of site_.issues) if (!issues.some((x) => x.key === it.key)) issues.push(it);
    await saveTasks(db, site, issues);
    if (site_.vitals) await db('seo_sites').where({ id: site.id }).update({ vitals_json: JSON.stringify({ ...site_.vitals, measured_at: t }) });
    await googleQuiet(db, site, phrases, results[0]);

    // Keep the last 10 checks per page
    const old = await db('seo_page_checks').where({ site_id: site.id }).orderBy('checked_at', 'desc').offset(10 * Math.max(pages.length, 1)).pluck('id');
    if (old.length) await db('seo_page_checks').whereIn('id', old).del();

    const next = t + (FREQUENCIES[site.frequency] || FREQUENCIES.weekly);
    await db('seo_sites').where({ id: site.id }).update({ last_status: 'ok', last_error: null, last_run_at: t, next_run_at: next, updated_at: now() });
    return { pages: pages.length, ok: true };
  } catch (err) {
    // Try again in a few hours
    await db('seo_sites').where({ id: site.id }).update({ last_status: 'error', last_error: err.message, last_run_at: t, next_run_at: t + 6 * 3600, updated_at: now() });
    return { ok: false, error: err.message };
  } finally {
    running.delete(site.id);
  }
}

// Sites whose next check is due (called by the scheduler)
async function processDue(db) {
  if (!require('./edition').isServer()) return; // server edition only (runs all the time)
  if (!(await db.schema.hasTable('seo_sites'))) return;
  const due = await db('seo_sites').where({ enabled: true }).where((q) => q.whereNull('next_run_at').orWhere('next_run_at', '<=', now())).limit(3);
  for (const site of due) {
    // Only for businesses whose trial or plan is active
    if (!(await require('./entitlements').canPublish(site.workspace_id))) continue;
    await runSite(db, site);
  }
}

// ── AI suggestions for a to-do (only when someone asks) ─────────────────────
async function draftFor(db, task, aiArgs = {}) {
  const { aiJSON } = require('./aiHelper');
  const opts = await aiDefaults(task.workspace_id, aiArgs.options);
  const key = aiArgs.apiKey || opts.googleKey;
  const brand = await require('./brand').profile(task.workspace_id, db);
  const business = brand.company_name || '';
  const site = await db('seo_sites').where({ workspace_id: task.workspace_id }).first();
  const phrases = json(site?.phrases_json, []);

  if (json(task.draft_json, {}).phrase || task.kind === 'idea') {
    const phrase = json(task.draft_json, {}).phrase || task.title;
    const { data } = await aiJSON(`Plan a web page for ${business || 'a business'} that should be found on Google for "${phrase}".
Only use facts a business like this would have; don't invent prices, awards or numbers.
Reply with JSON only: {"title":"50-60 characters","description":"140-160 characters","h1":"main heading","headings":["...","...","..."],"intro":"a first paragraph of 60-100 words"}`, key, 1200, opts, aiArgs.model || null);
    const draft = { type: 'page', phrase, ...pickStrings(data, ['title', 'description', 'h1', 'intro']), headings: (data.headings || []).map(String).slice(0, 8) };
    // Small AI models sometimes ignore the phrase: the page must be about it
    const need = (phrase.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2);
    const has = (s) => need.every((w) => String(s || '').toLowerCase().includes(w));
    const Phrase = phrase.charAt(0).toUpperCase() + phrase.slice(1);
    if (!has(draft.title)) draft.title = `${Phrase}${business ? ` | ${business}` : ''}`.slice(0, 60);
    if (!has(draft.h1)) draft.h1 = Phrase;
    if (!has(`${draft.description} ${draft.intro}`)) draft.note = 'The AI’s text didn’t mention this phrase: write the description and first paragraph yourself, or pick a stronger AI model in Settings → AI.';
    return draft;
  }

  // Titles and descriptions for the affected pages (up to 5)
  const pages = json(task.pages_json, []).slice(0, 5);
  const out = [];
  for (const url of pages) {
    let page = null;
    try { page = (await seoCheck.checkPage(url)).page; } catch { continue; }
    const { data } = await aiJSON(`Write the Google search title and description for this page of ${business || 'a business'}.
Search phrases the business wants: ${phrases.join(', ') || '(none)'}
Page title now: ${page.title || '(none)'}
Main heading: ${page.h1[0] || '(none)'}
What the page says: ${page.text_sample.slice(0, 1200)}
Only say what the page really offers. Title 50-60 characters, description 140-160 characters.
Reply with JSON only: {"title":"...","description":"..."}`, key, 600, opts, aiArgs.model || null);
    out.push({ url, now_title: page.title || '', now_description: page.description || '', ...pickStrings(data, ['title', 'description']) });
  }
  return { type: 'meta', pages: out };
}

function pickStrings(o, keys) {
  const r = {};
  for (const k of keys) r[k] = typeof o?.[k] === 'string' ? o[k].trim() : '';
  return r;
}

module.exports = { discoverPages, buildIssues, saveTasks, runSite, processDue, draftFor, googleQuiet, internalLinks, FREQUENCIES, RULES };
