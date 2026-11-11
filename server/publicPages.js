// The public pages search engines see: the landing page (with its address,
// share tags and FAQ structured data filled in), robots.txt and sitemap.xml.
// The app itself and the sign-in page are kept out of search results.
const express = require('express');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

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

let cache = { mtime: 0, html: '' };
function landingHtml() {
  const file = path.join(PUBLIC, 'landing.html');
  const mtime = fs.statSync(file).mtimeMs;
  if (mtime !== cache.mtime) {
    const raw = fs.readFileSync(file, 'utf8');
    cache = { mtime, html: raw.replace('<!--FAQ_JSONLD-->', faqJsonLd(raw)) };
  }
  return cache.html;
}

function sendLanding(req, res) {
  const url = siteUrl(req);
  res.type('html').send(landingHtml().split('%SITE_URL%').join(url));
}

const router = express.Router();

// One address for the landing page (search engines shouldn't see two copies)
router.get('/landing.html', (req, res) => res.redirect(301, '/'));

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Disallow: /api/',
    'Disallow: /users/',
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
  const desc = (body.match(/<!--\s*description:\s*([\s\S]*?)-->/) || [])[1]?.trim() || `${entry[1]} for Social-Nexus by Radixile Technology Solutions.`;
  const title = entry[1];
  const nav = LEGAL_PAGES.filter(([s]) => s).map(([s, t]) => `<li><a href="/legal/${s}"${s === slug ? ' aria-current="page"' : ''}>${esc(t)}</a></li>`).join('');
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} | Social-Nexus</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="%SITE_URL%/legal${slug ? `/${slug}` : ''}" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <link rel="stylesheet" href="/legal/legal.css" />
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">✦</span>Social-Nexus</a>
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

module.exports = { router, sendLanding, siteUrl, faqJsonLd, LEGAL_PAGES };
