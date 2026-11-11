// Website SEO: read a page the way Google's crawler would and measure it.
// Everything here is measured from the page itself, not guessed by AI.
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (compatible; Social-Nexus SEO check; +https://radixile.com)';

function isPrivateIp(ip) {
  const h = String(ip || '').toLowerCase();
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(h)) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe80:/.test(h) || /^::ffff:/.test(h) && isPrivateIp(h.replace(/^::ffff:/, ''));
  return false;
}

function isPrivateName(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return !h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || isPrivateIp(h);
}

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

async function fetchText(url, { accept = 'text/html,application/xhtml+xml,*/*;q=0.8', maxBytes = 3 * 1024 * 1024 } = {}) {
  await assertPublic(url);
  const redirects = [];
  const res = await axios.get(url, {
    timeout: 15000,
    maxContentLength: maxBytes,
    maxRedirects: 5,
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: () => true,
    headers: { 'User-Agent': UA, Accept: accept },
    beforeRedirect: (opts) => {
      if (isPrivateName(opts.hostname)) throw new Error('The page redirected to a local address.');
      redirects.push(`${opts.protocol}//${opts.hostname}${opts.path || ''}`);
    },
  });
  const finalUrl = res.request?.res?.responseUrl || redirects[redirects.length - 1] || url;
  return { status: res.status, headers: res.headers || {}, body: typeof res.data === 'string' ? res.data : '', finalUrl, redirects };
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
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href');
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try { (new URL(href, baseUrl).hostname === host ? internal++ : external++); } catch {}
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

async function checkPage(input, { keyword = '' } = {}) {
  const url = normaliseUrl(input);
  let res;
  try { res = await fetchText(url); } catch (err) {
    if (/timeout/i.test(err.message)) throw new Error('The page took too long to answer (15 seconds).');
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
    const r = await fetchText(`${final.origin}/robots.txt`, { accept: 'text/plain,*/*', maxBytes: 512 * 1024 });
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
      const s = await fetchText(`${final.origin}/sitemap.xml`, { accept: 'application/xml,text/xml,*/*', maxBytes: 5 * 1024 * 1024 });
      if (s.status >= 200 && s.status < 300 && /<(urlset|sitemapindex)\b/i.test(s.body)) sitemap = `${final.origin}/sitemap.xml`;
    } catch {}
  }
  add(sitemap
    ? { id: 'sitemap', status: 'good', label: 'Sitemap', detail: `Found: ${sitemap}` }
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

module.exports = { checkPage, analyzeText, readHtml, robotsRules, robotsAllows, isPrivateName, isPrivateIp, normaliseUrl, fetchText };
