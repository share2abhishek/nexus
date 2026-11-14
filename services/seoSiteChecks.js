// Checks that look across a whole website (the SEO autopilot runs them after
// checking each page). Several are the same checks as in these MIT-licensed
// open-source projects, rewritten here with plain wording and the local-network
// protection of seoCheck:
//   - Seo-Promt-Master (github.com/umutxyp/Seo-Promt-Master): soft 404s, canonicals
//     pointing at redirects or errors, sitemap URLs that redirect or fail,
//     duplicate titles, JSON-LD errors, AI crawlers blocked in robots.txt
//   - linkinator (github.com/JustinBeckwith/linkinator): broken links
//   - crawlseo (github.com/crawlseo/crawlseo): Core Web Vitals from Google's
//     PageSpeed Insights API
const axios = require('axios');
const crypto = require('crypto');
const seoCheck = require('./seoCheck');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sameHost = (a, b) => { try { return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, ''); } catch { return false; } };

// Status of a link, without downloading the page (HEAD, then a short GET if HEAD isn't allowed)
async function statusOf(url) {
  try { await seoCheck.assertPublic(url); } catch { return { status: 0, error: 'not a public address' }; }
  const opts = {
    timeout: 20000, maxRedirects: 5, validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (compatible; Social-Nexus SEO check; +https://radixile.com)',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    beforeRedirect: (o) => { if (seoCheck.isPrivateName(o.hostname)) throw new Error('redirects to a local address'); },
  };
  try {
    let r = await axios.head(url, opts);
    if ([403, 405, 501].includes(r.status)) {
      r = await axios.get(url, { ...opts, responseType: 'stream' });
      r.data?.destroy?.();
    }
    const finalUrl = r.request?.res?.responseUrl || url;
    return { status: r.status, finalUrl };
  } catch (err) {
    return { status: 0, error: err.code === 'ENOTFOUND' ? 'the website doesn’t exist' : err.message };
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ── Broken links ────────────────────────────────────────────────────────────
async function brokenLinks(results, home) {
  const from = new Map(); // link -> first page it's on
  for (const r of results) for (const l of r.links || []) if (!from.has(l)) from.set(l, r.url);
  const checked = new Set(results.map((r) => r.url));
  const internal = [...from.keys()].filter((l) => sameHost(l, home) && !checked.has(l)).slice(0, 60);
  const external = [...from.keys()].filter((l) => !sameHost(l, home)).slice(0, 30);
  // Pages already checked give their status for free
  const broken = [];
  for (const r of results) if (r.error || (r.status && r.status >= 400)) for (const [l, p] of from) if (l === r.url && p !== r.url) broken.push({ link: l, page: p, why: r.error || `answers ${r.status}` });
  const statuses = await mapLimit([...internal, ...external], 3, async (l) => ({ l, s: await statusOf(l) }));
  for (const { l, s } of statuses) {
    const isExternal = !sameHost(l, home);
    // Other sites often refuse checkers (401/403/429): only count clear failures there
    const bad = s.status === 0 ? !/not a public/.test(s.error || '') : s.status === 404 || s.status === 410 || s.status >= 500 || (!isExternal && s.status >= 400);
    if (bad) broken.push({ link: l, page: from.get(l), why: s.error || `answers ${s.status}` });
  }
  if (!broken.length) return [];
  return [{
    key: 'broken-links', kind: 'fix', priority: broken.some((b) => sameHost(b.link, home)) ? 2 : 3,
    title: `${plural(broken.length, 'broken link', 'broken links')} on your website`,
    detail: `Links that lead nowhere annoy visitors and waste Google’s visit. Fix or remove: ${broken.slice(0, 8).map((b) => `${b.link} (${b.why}, on ${b.page})`).join('; ')}${broken.length > 8 ? '; …' : ''}.`,
    pages: [...new Set(broken.map((b) => b.page))],
  }];
}

// ── Same title / description on several pages ───────────────────────────────
function duplicates(results) {
  const issues = [];
  for (const [field, what] of [['title', 'title'], ['description', 'description']]) {
    const by = new Map();
    for (const r of results) {
      const v = (r[field] || '').trim().toLowerCase();
      if (v) by.set(v, [...(by.get(v) || []), r.url]);
    }
    const dup = [...by.values()].filter((urls) => urls.length > 1);
    if (dup.length) {
      const pages = dup.flat();
      issues.push({
        key: `duplicate-${field}`, kind: 'fix', priority: field === 'title' ? 2 : 3, draft: 'meta',
        title: `${plural(pages.length, 'page shares', 'pages share')} the same ${what} with another page`,
        detail: `Google may not know which page to show. Give each page its own ${what}. Social-Nexus can write them.`,
        pages,
      });
    }
  }
  return issues;
}

// ── Missing pages that pretend to exist ("soft 404") ─────────────────────────
async function soft404(home) {
  const origin = new URL(home).origin;
  const probe = `${origin}/${crypto.randomBytes(6).toString('hex')}-page-that-does-not-exist`;
  const s = await statusOf(probe);
  if (s.status >= 200 && s.status < 300) {
    return [{
      key: 'soft-404', kind: 'fix', priority: 2,
      title: 'Missing pages answer as if they exist',
      detail: 'A made-up address on your site answers “OK” instead of “not found” (a soft 404). Google can fill up on empty pages. Ask whoever manages the site to return a real 404 for missing pages.',
      pages: [],
    }];
  }
  return [];
}

// ── Canonical addresses that redirect or fail ───────────────────────────────
async function canonicalTargets(results) {
  const wrong = [];
  const targets = results.filter((r) => r.canonical && r.canonical.replace(/\/$/, '') !== r.url.replace(/\/$/, ''));
  for (const r of targets.slice(0, 20)) {
    const s = await statusOf(r.canonical);
    if (s.status === 0 || s.status >= 400) wrong.push(`${r.url} → ${r.canonical} (${s.error || s.status})`);
    else if (s.finalUrl && s.finalUrl.replace(/\/$/, '') !== r.canonical.replace(/\/$/, '')) wrong.push(`${r.url} → ${r.canonical} (redirects)`);
  }
  if (!wrong.length) return [];
  return [{
    key: 'canonical-broken', kind: 'fix', priority: 2,
    title: `${plural(wrong.length, 'page names', 'pages name')} a main address (canonical) that doesn’t work`,
    detail: `Google is told to use another address that redirects or fails: ${wrong.slice(0, 5).join('; ')}.`,
    pages: targets.map((r) => r.url),
  }];
}

// ── Sitemap URLs that redirect or fail ───────────────────────────────────────
function sitemapProblems(results) {
  const bad = results.filter((r) => r.fromSitemap && (r.error || r.status >= 300 || (r.redirects || []).length));
  if (!bad.length) return [];
  return [{
    key: 'sitemap-urls', kind: 'fix', priority: 3,
    title: `Your sitemap lists ${plural(bad.length, 'address', 'addresses')} that ${bad.length === 1 ? 'redirects or fails' : 'redirect or fail'}`,
    detail: 'A sitemap should only list the final address of pages that open. Update it (most SEO plugins do this when you re-save).',
    pages: bad.map((r) => r.url),
  }];
}

// ── Structured data (JSON-LD) ───────────────────────────────────────────────
function structuredData(results) {
  const issues = [];
  const broken = results.filter((r) => r.json_ld?.invalid);
  if (broken.length) {
    issues.push({
      key: 'jsonld-invalid', kind: 'fix', priority: 2,
      title: `${plural(broken.length, 'page has', 'pages have')} broken structured data`,
      detail: 'The JSON-LD block (business details for Google) has an error, so Google ignores it. Check it with Google’s Rich Results Test.',
      pages: broken.map((r) => r.url),
    });
  }
  const home = results[0];
  if (home && !home.error && !home.json_ld?.count) {
    issues.push({
      key: 'jsonld-missing', kind: 'idea', priority: 3,
      title: 'Tell Google your business details (structured data)',
      detail: 'Your home page has no structured data. Adding “LocalBusiness” details (name, address, phone, hours) helps Google show them in Search and Maps. Most SEO plugins have a setting for it.',
      pages: [home.url],
    });
  }
  return issues;
}

// ── AI assistants blocked from reading the site ─────────────────────────────
const AI_BOTS = { GPTBot: 'ChatGPT', 'Google-Extended': 'Google Gemini', ClaudeBot: 'Claude', PerplexityBot: 'Perplexity', CCBot: 'Common Crawl' };
async function aiCrawlers(home) {
  const origin = new URL(home).origin;
  let txt = '';
  try {
    const r = await seoCheck.fetchText(`${origin}/robots.txt`, { accept: 'text/plain,*/*', maxBytes: 512 * 1024 });
    if (r.status >= 200 && r.status < 300) txt = r.body;
  } catch { return []; }
  const blocked = [];
  // Groups naming each bot; "Disallow: /" there means it may not read anything
  const groups = String(txt).split(/\n(?=\s*user-agent\s*:)/i);
  for (const [bot, name] of Object.entries(AI_BOTS)) {
    const g = groups.find((x) => new RegExp(`user-agent\\s*:\\s*${bot}\\b`, 'i').test(x));
    if (g && /^\s*disallow\s*:\s*\/\s*$/im.test(g)) blocked.push(name);
  }
  if (!blocked.length) return [];
  return [{
    key: 'ai-crawlers', kind: 'idea', priority: 3,
    title: `AI assistants can’t read your site (${blocked.join(', ')})`,
    detail: 'Your robots.txt blocks them, so they can’t mention or recommend your business. That may be on purpose; if not, remove those lines.',
    pages: [],
  }];
}

// ── Page speed (Core Web Vitals) from Google PageSpeed Insights ─────────────
// Free; a key (PAGESPEED_API_KEY) gives a bigger daily allowance.
async function coreWebVitals(home) {
  const params = { url: home, strategy: 'mobile', category: 'performance' };
  if (process.env.PAGESPEED_API_KEY) params.key = process.env.PAGESPEED_API_KEY;
  let d;
  try {
    d = (await axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', { params, timeout: 90000 })).data;
  } catch (err) {
    // Google busy or its daily limit reached: say so, try again next time
    const limit = err.response?.status === 429;
    return { issues: [], vitals: { error: limit ? (process.env.PAGESPEED_API_KEY ? 'Google’s daily limit for page-speed checks was reached. It tries again next time.' : 'Page speed needs a free Google PageSpeed API key on the server (PAGESPEED_API_KEY): Google’s shared allowance is used up.') : 'Google’s page-speed service didn’t answer. It tries again next time.' } };
  }
  const field = d.loadingExperience?.metrics || {};
  const lab = d.lighthouseResult?.audits || {};
  const vitals = {
    source: field.LARGEST_CONTENTFUL_PAINT_MS ? 'real visitors (last 28 days)' : 'Google’s test',
    lcp_ms: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? Math.round(lab['largest-contentful-paint']?.numericValue || 0),
    cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : Math.round((lab['cumulative-layout-shift']?.numericValue || 0) * 100) / 100,
    inp_ms: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    score: d.lighthouseResult?.categories?.performance?.score != null ? Math.round(d.lighthouseResult.categories.performance.score * 100) : null,
  };
  const slow = [];
  if (vitals.lcp_ms > 4000) slow.push(`the main content takes ${(vitals.lcp_ms / 1000).toFixed(1)} s to appear (aim for under 2.5 s)`);
  if (vitals.cls > 0.25) slow.push('the page jumps around while loading');
  if (vitals.inp_ms != null && vitals.inp_ms > 500) slow.push(`taps take ${vitals.inp_ms} ms to respond (aim for under 200 ms)`);
  const meh = !slow.length && (vitals.lcp_ms > 2500 || vitals.cls > 0.1 || (vitals.inp_ms != null && vitals.inp_ms > 200));
  if (!slow.length && !meh) return { issues: [], vitals };
  return {
    vitals,
    issues: [{
      key: 'page-speed', kind: 'fix', priority: slow.length ? 2 : 3,
      title: slow.length ? 'Your home page is slow on phones' : 'Your home page could load faster on phones',
      detail: `${slow.length ? `On phones ${slow.join(', ')}.` : 'It’s a little slower than Google recommends.'} Measured by ${vitals.source}. Smaller pictures and fewer plugins usually help; Google’s PageSpeed Insights lists exactly what to change.`,
      pages: [home],
    }],
  };
}

async function runAll(results, home, { pageSpeed = true } = {}) {
  const issues = [...duplicates(results), ...sitemapProblems(results), ...structuredData(results)];
  const parts = await Promise.all([
    brokenLinks(results, home).catch(() => []),
    soft404(home).catch(() => []),
    canonicalTargets(results).catch(() => []),
    aiCrawlers(home).catch(() => []),
    pageSpeed ? coreWebVitals(home).catch(() => ({ issues: [] })) : { issues: [] },
  ]);
  const cwv = parts.pop();
  return { issues: [...issues, ...parts.flat(), ...cwv.issues], vitals: cwv.vitals || null };
}

module.exports = { runAll, statusOf, brokenLinks, duplicates, soft404, canonicalTargets, sitemapProblems, structuredData, aiCrawlers, coreWebVitals };
