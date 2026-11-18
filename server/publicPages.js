// The public pages search engines see: the landing page (with its address,
// share tags and FAQ structured data filled in), robots.txt and sitemap.xml.
// The app itself and the sign-in page are kept out of search results.
const express = require('express');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

// Addresses that must never appear in search results (the app, sign-in, one-time links, data routes)
const NOT_FOR_SEARCH = ['/api/', '/users/', '/auth/', '/admin', '/app', '/login.html', '/invite.html', '/setup.html', '/a/', '/relay/', '/v1/', '/ollama/'];
const noindexPath = (p) => NOT_FOR_SEARCH.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x || p.startsWith(`${x}/`))) || p === '/index.html';
function noindexMiddleware(req, res, next) {
  if (noindexPath(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

// A page that doesn't exist: a real 404 (not the app's page with a 200), and not for search
function sendNotFound(req, res) {
  res.status(404).set('X-Robots-Tag', 'noindex').type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Page not found | NexaDrip</title><meta name="robots" content="noindex" /><link rel="icon" type="image/svg+xml" href="/icon.svg" />
<style>body{font-family:system-ui,sans-serif;background:#f6f9fc;color:#334155;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}h1{color:#0f2338}a{color:#2563eb}</style></head>
<body><main><img src="/icon.svg" alt="NexaDrip" width="56" height="56" /><h1>We can’t find that page</h1><p>The address may have changed. <a href="/">Go to the NexaDrip home page</a> or <a href="/help.html">open the help guides</a>.</p></main></body></html>`);
}

// The site's own address: APP_URL when set (the hosted service), else the
// address the page was opened on.
function siteUrl(req) {
  return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// FAQ structured data built from the questions on the page, so it always matches them
function faqJsonLd(html) {
  const items = [...html.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)]
    .map(([, q, a]) => ({ '@type': 'Question', name: strip(q), acceptedAnswer: { '@type': 'Answer', text: strip(a) } }));
  if (!items.length) return '';
  const json = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

// Parts of the landing page that can be switched off without a deploy (platform_config):
//   registration_mode = closed   → sign-up buttons, trial notes and the trial FAQ are left out
//   show_pricing      = off      → the Pricing section, its menu link and the prices in the
//                                   structured data are left out
// In landing.html a part is wrapped in <!--IF:name--> … <!--/IF:name--> (or IF:!name for
// what shows when it is off). Parts that are off are not sent at all, so search engines
// don't see them either.
function applySwitches(html, on) {
  return html.replace(/<!--IF:(!?)(\w+)-->([\s\S]*?)<!--\/IF:\1\2-->/g,
    (m, not, name, body) => ((!!on[name]) !== !!not ? body : ''));
}

let switchesCache = { at: 0, value: { signup: true, pricing: true } };
async function landingSwitches() {
  if (Date.now() - switchesCache.at < 30_000) return switchesCache.value;
  let value = { signup: true, pricing: true };
  try {
    const knex = require('../services/knex');
    const rows = await knex('platform_config').whereIn('key', ['registration_mode', 'show_pricing']).select('key', 'value');
    const get = (k) => String(rows.find((r) => r.key === k)?.value ?? '').trim().toLowerCase();
    value = { signup: get('registration_mode') !== 'closed', pricing: !['off', 'false', '0', 'no', 'hidden'].includes(get('show_pricing')) };
  } catch { /* keep the defaults */ }
  switchesCache = { at: Date.now(), value };
  return value;
}

let cache = { key: '', html: '' };
function landingHtml(on = { signup: true, pricing: true }) {
  const file = path.join(PUBLIC, 'landing.html');
  const key = `${fs.statSync(file).mtimeMs}:${on.signup}:${on.pricing}`;
  if (key !== cache.key) {
    const html = applySwitches(fs.readFileSync(file, 'utf8'), on);
    cache = { key, html: html.replace('<!--FAQ_JSONLD-->', faqJsonLd(html)) };
  }
  return cache.html;
}

async function sendLanding(req, res) {
  const url = siteUrl(req);
  res.type('html').send(landingHtml(await landingSwitches()).split('%SITE_URL%').join(url));
}

const router = express.Router();

// One address for the landing page (search engines shouldn't see two copies)
router.get('/landing.html', (req, res) => res.redirect(301, '/'));

// The help guides, with the site's own address filled in (canonical and share tags)
router.get('/help.html', (req, res) => {
  res.type('html').send(fs.readFileSync(path.join(PUBLIC, 'help.html'), 'utf8').split('%SITE_URL%').join(siteUrl(req)));
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /$',
    'Allow: /help.html',
    'Allow: /legal',
    // The app, sign-in and the private links are not for search results
    ...NOT_FOR_SEARCH.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${siteUrl(req)}/sitemap.xml`,
    '',
  ].join('\n'));
});

router.get('/sitemap.xml', (req, res) => {
  const url = siteUrl(req);
  const pages = [['/', '1.0'], ['/help.html', '0.6'], ...LEGAL_PAGES.map(([p]) => [`/legal${p ? `/${p}` : ''}`, '0.3'])];
  const lastmod = (p) => {
    const file = p === '/' ? path.join(PUBLIC, 'landing.html') : p.startsWith('/legal') ? path.join(LEGAL_DIR, `${p.slice(7) || 'index'}.html`) : path.join(PUBLIC, p);
    try { return new Date(fs.statSync(file).mtimeMs).toISOString().slice(0, 10); } catch { return null; }
  };
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(([p, pr]) => `  <url><loc>${url}${p}</loc>${lastmod(p) ? `<lastmod>${lastmod(p)}</lastmod>` : ''}<priority>${pr}</priority></url>`).join('\n')}
</urlset>
`);
});

// ── Legal pages ─────────────────────────────────────────────────────────────
// Text in server/legal/<page>.html; this adds the menu, sidebar and footer and
// fills in the company details. Defaults below; .env can override them:
//   LEGAL_ADDRESS            registered office address
//   LEGAL_GRIEVANCE_OFFICER  name of the Grievance Officer (IT Rules, DPDP Act)
//   LEGAL_CITY               city whose courts handle disputes
const LEGAL_DIR = path.join(__dirname, 'legal');
const LEGAL_PAGES = [
  ['', 'Legal'],
  ['terms', 'Terms of Service'],
  ['privacy', 'Privacy Policy'],
  ['refunds', 'Refund & Cancellation'],
  ['acceptable-use', 'Acceptable Use'],
  ['cookies', 'Cookies'],
  ['data-deletion', 'Delete your data'],
  ['dpa', 'Data Processing Addendum'],
];
const LEGAL_UPDATED = '11 November 2026';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function legalTokens(req) {
  return {
    '%SITE_URL%': siteUrl(req),
    '%COMPANY%': 'Radixile Technology Solutions LLP',
    '%EMAIL%': 'info@radixile.com',
    '%ADDRESS%': esc(process.env.LEGAL_ADDRESS || 'Pune, Maharashtra, India'),
    '%GRIEVANCE%': esc(process.env.LEGAL_GRIEVANCE_OFFICER || 'Kajal Aher'),
    '%CITY%': esc(process.env.LEGAL_CITY || 'Pune, Maharashtra'),
    '%UPDATED%': LEGAL_UPDATED,
  };
}

function legalPage(req, slug) {
  const entry = LEGAL_PAGES.find(([s]) => s === slug);
  if (!entry) return null;
  const file = path.join(LEGAL_DIR, `${slug || 'index'}.html`);
  if (!fs.existsSync(file)) return null;
  let body = fs.readFileSync(file, 'utf8');
  const desc = (body.match(/<!--\s*description:\s*([\s\S]*?)-->/) || [])[1]?.trim() || `${entry[1]} for NexaDrip by Radixile Technology Solutions.`;
  const title = entry[1];
  const nav = LEGAL_PAGES.filter(([s]) => s).map(([s, t]) => `<li><a href="/legal/${s}"${s === slug ? ' aria-current="page"' : ''}>${esc(t)}</a></li>`).join('');
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} | NexaDrip</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="%SITE_URL%/legal${slug ? `/${slug}` : ''}" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <link rel="stylesheet" href="/legal/legal.css" />
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"><img src="/icon.svg" style="width:20px;height:20px;vertical-align:middle;margin-right:6px;object-fit:contain;" alt="" /></span>Nexa<span style="color:#00d2ff">Drip</span></a>
  <nav class="top-links"><a class="btn" href="/">Home</a><a class="btn btn-primary" href="/login.html">Sign in</a></nav>
</div></header>
<main class="wrap layout">
  <aside class="side" aria-label="Legal documents"><h2>Legal</h2><ul>${nav}</ul></aside>
  <article class="doc">
${body}
  </article>
</main>
<footer><div class="wrap"><span>© 2026 %COMPANY%</span><span><a href="/legal">Legal</a> · <a href="mailto:%EMAIL%">%EMAIL%</a></span></div></footer>
</body>
</html>`;
  for (const [k, v] of Object.entries(legalTokens(req))) html = html.split(k).join(v);
  return html;
}

router.get(['/legal', '/legal/'], (req, res) => res.type('html').send(legalPage(req, '')));
router.get('/legal/:page', (req, res, next) => {
  const slug = req.params.page.replace(/\.html$/, '');
  if (slug !== req.params.page) return res.redirect(301, `/legal/${slug}`);
  const html = legalPage(req, slug);
  if (!html) return next();
  res.type('html').send(html);
});

module.exports = { router, sendLanding, applySwitches, sendNotFound, noindexMiddleware, noindexPath, siteUrl, faqJsonLd, LEGAL_PAGES, NOT_FOR_SEARCH };
