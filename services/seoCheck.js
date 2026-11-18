// Website SEO: read a page the way Google's crawler would and measure it.
// Everything here is measured from the page itself, not guessed by AI.
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 (compatible; Social-Nexus SEO check; +https://radixile.com)';

const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// Classification lives in services/safeNet.js (one rule for the whole app)
const safeNet = require('./safeNet');
const isPrivateIp = safeNet.isPrivateIp;
const isPrivateName = safeNet.isPrivateName;

// A public web address only: not this PC or the local network (also after DNS)
async function assertPublic(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('That doesn’t look like a web address.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('The address must start with http:// or https://');
  if (isPrivateName(u.hostname)) throw new Error('Use your page’s public web address (not one on this PC or your local network).');
  if (!net.isIP(u.hostname)) {
    let addrs = [];
    try { addrs = await dns.lookup(u.hostname, { all: true }); } catch { throw new Error(`Couldn’t find ${u.hostname}. Check the address.`); }
    if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('That address points to a local network, so it can’t be checked.');
  }
  return u;
}

function normaliseUrl(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('Type the address of the page to check.');
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

async function fetchText(url, { accept = 'text/html,application/xhtml+xml,*/*;q=0.8', maxBytes = 3 * 1024 * 1024, timeout = 30000, retries = 1 } = {}) {
  await assertPublic(url);
  let attempt = 0;
  while (true) {
    try {
      const redirects = [];
      const res = await axios.get(url, {
        timeout,
        maxContentLength: maxBytes,
        maxRedirects: 5,
        responseType: 'text',
        transformResponse: [(d) => d],
        validateStatus: () => true,
        headers: { ...BROWSER_HEADERS, Accept: accept },
        httpAgent: safeNet.httpAgent, httpsAgent: safeNet.httpsAgent, proxy: false, // refuse private addresses at connect time
        beforeRedirect: (opts) => {
          if (isPrivateName(opts.hostname)) throw new Error('The page redirected to a local address.');
          redirects.push(`${opts.protocol}//${opts.hostname}${opts.path || ''}`);
        },
      });
      const finalUrl = res.request?.res?.responseUrl || redirects[redirects.length - 1] || url;
      return { status: res.status, headers: res.headers || {}, body: typeof res.data === 'string' ? res.data : '', finalUrl, redirects };
    } catch (err) {
      const isTimeout = /timeout/i.test(err.message) || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
      const isConnReset = err.code === 'ECONNRESET';
      if (attempt < retries && (isTimeout || isConnReset)) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      throw err;
    }
  }
}

// ── Reading HTML ────────────────────────────────────────────────────────────
const decode = (s) => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const clean = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function metaContent(html, key, value) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if ((attr(tag, key) || '').toLowerCase() === value) return attr(tag, 'content');
  }
  return null;
}

function visibleText(html) {
  return clean(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, ' '));
}

function words(text) { return (String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []); }

function countPhrase(text, phrase) {
  const p = words(phrase); const w = words(text);
  if (!p.length) return 0;
  let n = 0;
  for (let i = 0; i + p.length <= w.length; i++) if (p.every((x, j) => w[i + j] === x)) n++;
  return n;
}

function readHtml(html, baseUrl) {
  const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [html])[0];
  const title = clean((head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const h1 = (html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || []).map(clean).filter(Boolean);
  const h2 = (html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi) || []).map(clean).filter(Boolean);
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter((t) => { const a = attr(t, 'alt'); return a === null || !a.trim(); }).length;
  let canonical = null;
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) if ((attr(tag, 'rel') || '').toLowerCase().split(/\s+/).includes('canonical')) canonical = attr(tag, 'href');
  let host = ''; try { host = new URL(baseUrl).hostname; } catch {}
  let internal = 0; let external = 0;
  const links = []; // up to 300 distinct links, for the broken-link check
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href');
    if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const u = new URL(href, baseUrl);
      u.hash = '';
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hostname === host ? internal++ : external++;
      if (links.length < 300 && !links.includes(u.href)) links.push(u.href);
    } catch {}
  }
  // Structured data (JSON-LD): how many blocks, which types, and any that aren't valid JSON
  const jsonLd = { count: 0, invalid: 0, types: [] };
  for (const m of html.match(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>[\s\S]*?<\/script>/gi) || []) {
    jsonLd.count++;
    const body = m.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try {
      const data = JSON.parse(body);
      const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const it of items) for (const t of [].concat(it?.['@type'] || [])) if (!jsonLd.types.includes(t)) jsonLd.types.push(String(t));
    } catch { jsonLd.invalid++; }
  }
  const text = visibleText(html);
  return {
    title,
    description: metaContent(head, 'name', 'description'),
    robots: [metaContent(head, 'name', 'robots'), metaContent(head, 'name', 'googlebot')].filter(Boolean).join(', ') || null,
    canonical: canonical ? (() => { try { return new URL(canonical, baseUrl).href; } catch { return canonical; } })() : null,
    lang: attr((html.match(/<html\b[^>]*>/i) || [''])[0], 'lang'),
    viewport: !!metaContent(head, 'name', 'viewport'),
    og_title: metaContent(head, 'property', 'og:title'),
    og_description: metaContent(head, 'property', 'og:description'),
    og_image: metaContent(head, 'property', 'og:image'),
    h1, h2,
    images: imgs.length, images_without_alt: noAlt,
    links_internal: internal, links_external: external,
    text,
    word_count: words(text).length,
    links,
    json_ld: jsonLd,
  };
}

// ── robots.txt ──────────────────────────────────────────────────────────────
// Rules for Googlebot (its own group if there is one, else "*")
function robotsRules(txt) {
  const groups = []; let cur = null; const sitemaps = [];
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'sitemap') { sitemaps.push(val); continue; }
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const pick = groups.filter((g) => g.agents.some((a) => a === 'googlebot'));
  const rules = (pick.length ? pick : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  return { rules, sitemaps };
}

function pathMatches(rulePath, path) {
  if (!rulePath) return false;
  const re = new RegExp('^' + rulePath.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(path);
}

// Longest matching rule wins; Allow wins a tie (Google's rule)
function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!pathMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

// ── Pages that need JavaScript to show any text ─────────────────────────────
// Almost no text in the HTML, plus a sign of a script-built app (an empty app root,
// or an "enable JavaScript" message)
function looksJsOnly(html, wordCount) {
  if (wordCount >= 50) return false;
  return /enable\s+javascript|<app-root\b|id\s*=\s*["'](root|__next|app|__nuxt)["']|<noscript\b/i.test(String(html));
}

// Does this address open as a sitemap? Remembered for 10 minutes per address so a
// 50-page check asks once.
const sitemapCache = new Map();
async function sitemapOpens(url) {
  const hit = sitemapCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.ok;
  let ok = false;
  try {
    const s = await fetchText(url, { accept: 'application/xml,text/xml,*/*', maxBytes: 5 * 1024 * 1024, timeout: 15000, retries: 0 });
    ok = s.status >= 200 && s.status < 300 && /<(urlset|sitemapindex)\b/i.test(s.body);
  } catch { ok = false; }
  if (sitemapCache.size > 200) sitemapCache.clear();
  sitemapCache.set(url, { ok, at: Date.now() });
  return ok;
}

// ── The check ───────────────────────────────────────────────────────────────
function lenCheck(id, label, value, min, max, what) {
  if (!value) return { id, status: 'bad', label, detail: `No ${what}. Google will make one up from the page.` };
  const n = value.length;
  if (n < min) return { id, status: 'warn', label, detail: `${n} characters: a bit short (aim for ${min}–${max}).` };
  if (n > max) return { id, status: 'warn', label, detail: `${n} characters: Google may cut it off (aim for ${min}–${max}).` };
  return { id, status: 'good', label, detail: `${n} characters.` };
}

function keywordChecks(page, keyword) {
  if (!keyword) return [];
  const k = keyword.toLowerCase();
  const inText = (s) => String(s || '').toLowerCase().includes(k);
  const first100 = words(page.text).slice(0, 100).join(' ');
  const count = countPhrase(page.text, keyword);
  const density = page.word_count ? Math.round((count * words(keyword).length / page.word_count) * 1000) / 10 : 0;
  return [
    { id: 'kw_title', status: inText(page.title) ? 'good' : 'warn', label: `“${keyword}” in the title`, detail: inText(page.title) ? 'Yes.' : 'No. Put it near the start of the title.' },
    { id: 'kw_desc', status: inText(page.description) ? 'good' : 'warn', label: `“${keyword}” in the description`, detail: inText(page.description) ? 'Yes.' : 'No.' },
    { id: 'kw_h1', status: page.h1.some(inText) ? 'good' : 'warn', label: `“${keyword}” in the main heading`, detail: page.h1.some(inText) ? 'Yes.' : 'No.' },
    { id: 'kw_start', status: first100.includes(words(keyword).join(' ')) ? 'good' : 'warn', label: `“${keyword}” in the first 100 words`, detail: first100.includes(words(keyword).join(' ')) ? 'Yes.' : 'No. Mention it early.' },
    { id: 'kw_count', status: count === 0 ? 'bad' : density > 3 ? 'warn' : 'good', label: 'How often it appears in the page text', detail: `${count} time${count === 1 ? '' : 's'} (${density}% of the words)${density > 3 ? ': that may look like stuffing.' : '.'}` },
  ];
}

// Can this computer open a connection to the website at all? (only public addresses: safeNet.lookup)
function probeConnect(host, port, ms = 6000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let sock;
    const done = (ok, why) => { try { sock && sock.destroy(); } catch { /* closed */ } resolve({ ok, why, ms: Date.now() - t0 }); };
    try { sock = net.connect({ host, port, lookup: safeNet.lookup, timeout: ms }); } catch (e) { return done(false, e.code || 'error'); }
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false, 'timeout'));
    sock.once('error', (e) => done(false, e.code || 'error'));
  });
}

// A timeout can mean two different things: the website could not be reached at all, or it answered
// but slowly. Say which, with what to try.
function timeoutMessage(seconds, probe, host) {
  if (probe && !probe.ok) {
    return `NexaDrip could not connect to ${host} from this server (${probe.why === 'timeout' ? 'no answer' : probe.why}). ` +
      'If your website is hosted on the same server or network as NexaDrip, the server may not be able to open its own public address: ask whoever hosts it to allow this. ' +
      'If the site was being updated, it will work again once it is back.';
  }
  return `The page took too long to answer (${seconds} seconds). NexaDrip could connect, but the website was slow to send the page: check that it opens quickly in a browser.`;
}

async function checkPage(input, { keyword = '', timeout = 30000, probe = probeConnect } = {}) {
  const url = normaliseUrl(input);
  let res;
  try { res = await fetchText(url, { timeout }); } catch (err) {
    if (/timeout/i.test(err.message) || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      const u = new URL(url);
      const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
      const result = await probe(u.hostname, port).catch(() => null);
      throw new Error(timeoutMessage(Math.round(timeout / 1000), result, u.hostname));
    }
    if (err.code === 'ENOTFOUND') throw new Error('Couldn’t find that website. Check the address.');
    throw err;
  }
  const final = new URL(res.finalUrl);
  const checks = [];
  const add = (c) => checks.push(c);

  add(res.status >= 200 && res.status < 300
    ? { id: 'status', status: 'good', label: 'Page opens', detail: `Answered ${res.status}${res.redirects.length ? ` after ${res.redirects.length} redirect${res.redirects.length === 1 ? '' : 's'}` : ''}.` }
    : { id: 'status', status: 'bad', label: 'Page opens', detail: `Answered ${res.status}. Google won’t list a page that doesn’t open.` });
  add(final.protocol === 'https:'
    ? { id: 'https', status: 'good', label: 'Secure (https)', detail: 'Yes.' }
    : { id: 'https', status: 'warn', label: 'Secure (https)', detail: 'No. Browsers mark it “Not secure” and Google prefers https.' });

  // robots.txt and sitemap
  let robots = { rules: [], sitemaps: [] }; let robotsFound = false;
  try {
    const r = await fetchText(`${final.origin}/robots.txt`, { accept: 'text/plain,*/*', maxBytes: 512 * 1024, timeout: 15000 });
    if (r.status >= 200 && r.status < 300 && !/<html/i.test(r.body.slice(0, 500))) { robots = robotsRules(r.body); robotsFound = true; }
  } catch {}
  const allowed = robotsAllows(robots.rules, final.pathname + final.search);
  add(allowed
    ? { id: 'robots_txt', status: 'good', label: 'Google may read it (robots.txt)', detail: robotsFound ? 'robots.txt allows this page.' : 'No robots.txt, so everything is allowed.' }
    : { id: 'robots_txt', status: 'bad', label: 'Google may read it (robots.txt)', detail: 'robots.txt blocks Google from this page.' });

  const html = /html|xml/i.test(String(res.headers['content-type'] || 'text/html')) ? res.body : '';
  const page = readHtml(html, res.finalUrl);
  const xRobots = String(res.headers['x-robots-tag'] || '');
  const noindex = /noindex|none/i.test(`${page.robots || ''} ${xRobots}`);
  add(noindex
    ? { id: 'noindex', status: 'bad', label: 'Allowed in Google’s results', detail: `The page says “noindex” (${page.robots ? 'meta robots' : 'X-Robots-Tag header'}), so Google won’t show it.` }
    : { id: 'noindex', status: 'good', label: 'Allowed in Google’s results', detail: 'No “noindex”.' });

  let sitemap = robots.sitemaps[0] || null;
  if (!sitemap) {
    try {
      const s = await fetchText(`${final.origin}/sitemap.xml`, { accept: 'application/xml,text/xml,*/*', maxBytes: 5 * 1024 * 1024, timeout: 15000 });
      if (s.status >= 200 && s.status < 300 && /<(urlset|sitemapindex)\b/i.test(s.body)) sitemap = `${final.origin}/sitemap.xml`;
    } catch {}
  }
  // robots.txt may name a sitemap that doesn't open (a 404 or a page instead of a sitemap)
  const sitemapWorks = sitemap && robots.sitemaps[0] ? await sitemapOpens(sitemap) : true;
  add(sitemap && sitemapWorks
    ? { id: 'sitemap', status: 'good', label: 'Sitemap', detail: `Found: ${sitemap}` }
    : sitemap
      ? { id: 'sitemap', status: 'warn', label: 'Sitemap', detail: `robots.txt names ${sitemap}, but it doesn’t open as a sitemap. Google can’t use it: create it, or fix the address in robots.txt.` }
      : { id: 'sitemap', status: 'warn', label: 'Sitemap', detail: 'None found at /sitemap.xml or in robots.txt. A sitemap helps Google find all your pages.' });

  if (page.canonical) {
    const same = page.canonical.replace(/\/$/, '') === res.finalUrl.replace(/[#].*$/, '').replace(/\/$/, '');
    add(same
      ? { id: 'canonical', status: 'good', label: 'Main address (canonical)', detail: 'Points to this page.' }
      : { id: 'canonical', status: 'warn', label: 'Main address (canonical)', detail: `Points to another address: ${page.canonical}. Google may list that one instead.` });
  }

  add(lenCheck('title', 'Title', page.title, 30, 60, 'title'));
  add(lenCheck('description', 'Description', page.description, 70, 160, 'description'));
  add(page.h1.length === 1
    ? { id: 'h1', status: 'good', label: 'Main heading (H1)', detail: `“${page.h1[0].slice(0, 80)}”` }
    : page.h1.length === 0
      ? { id: 'h1', status: 'warn', label: 'Main heading (H1)', detail: 'None. Give the page one main heading.' }
      : { id: 'h1', status: 'warn', label: 'Main heading (H1)', detail: `${page.h1.length} of them. One is clearer.` });
  // A page whose text is built by JavaScript in the browser arrives nearly empty
  const jsOnly = looksJsOnly(html, page.word_count);
  if (jsOnly) add({ id: 'js_only', status: 'warn', label: 'Text in the page itself', detail: 'The page arrives almost empty and its text is added by JavaScript. Google may read it late or not at all, and other search tools and AI assistants usually can’t. Ask your developer to prerender it (server-side rendering).' });
  add(page.word_count >= 300
    ? { id: 'words', status: 'good', label: 'Amount of text', detail: `${page.word_count} words.` }
    : { id: 'words', status: 'warn', label: 'Amount of text', detail: `${page.word_count} words. Pages with very little text are hard for Google to understand${page.word_count < 50 ? ' (or the text is added later by JavaScript, which Google may read later)' : ''}.` });
  if (page.images) {
    add(page.images_without_alt
      ? { id: 'alt', status: 'warn', label: 'Picture descriptions (alt text)', detail: `${page.images_without_alt} of ${page.images} pictures have none.` }
      : { id: 'alt', status: 'good', label: 'Picture descriptions (alt text)', detail: page.images === 1 ? 'The picture has one.' : `All ${page.images} pictures have one.` });
  }
  add(page.viewport
    ? { id: 'mobile', status: 'good', label: 'Set up for phones', detail: 'Has a mobile viewport.' }
    : { id: 'mobile', status: 'warn', label: 'Set up for phones', detail: 'No mobile viewport tag: it may show tiny on phones.' });
  add(page.og_title && page.og_image
    ? { id: 'social', status: 'good', label: 'Preview when shared', detail: 'Has a share title and picture.' }
    : { id: 'social', status: 'warn', label: 'Preview when shared', detail: `Missing ${[!page.og_title && 'a share title (og:title)', !page.og_image && 'a share picture (og:image)'].filter(Boolean).join(' and ')}.` });
  keywordChecks(page, keyword.trim()).forEach(add);

  const { text, ...summary } = page;
  return {
    url: res.finalUrl,
    status: res.status,
    redirects: res.redirects,
    checks,
    counts: { good: checks.filter((c) => c.status === 'good').length, warn: checks.filter((c) => c.status === 'warn').length, bad: checks.filter((c) => c.status === 'bad').length },
    page: { ...summary, text_sample: text.slice(0, 2000) },
    sitemap,
  };
}

// Measured numbers for pasted text (Content check)
function analyzeText(content, keyword = '') {
  const text = String(content || '');
  const w = words(text);
  const sentences = (text.match(/[^.!?\n]+[.!?]+|[^.!?\n]+$/gm) || []).filter((s) => words(s).length);
  const syllables = w.reduce((n, x) => n + Math.max(1, (x.replace(/e$/, '').match(/[aeiouy]+/g) || []).length), 0);
  const avgSentence = sentences.length ? w.length / sentences.length : 0;
  // Flesch reading ease (English): 60+ is easy for most readers
  const flesch = w.length && sentences.length ? Math.round(206.835 - 1.015 * avgSentence - 84.6 * (syllables / w.length)) : null;
  const count = keyword ? countPhrase(text, keyword) : 0;
  const first100 = w.slice(0, 100).join(' ');
  return {
    word_count: w.length,
    sentence_count: sentences.length,
    avg_sentence_words: Math.round(avgSentence * 10) / 10,
    reading_ease: flesch === null ? null : Math.max(0, Math.min(100, flesch)),
    keyword_count: count,
    keyword_density: keyword && w.length ? Math.round((count * words(keyword).length / w.length) * 1000) / 10 : 0,
    keyword_in_first_100_words: keyword ? first100.includes(words(keyword).join(' ')) : null,
  };
}

module.exports = { checkPage, analyzeText, readHtml, looksJsOnly, sitemapOpens, robotsRules, robotsAllows, isPrivateName, isPrivateIp, normaliseUrl, fetchText, assertPublic, probeConnect, timeoutMessage };
