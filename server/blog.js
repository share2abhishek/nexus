// The public blog. A post is one file in server/blog/posts/<slug>.html:
//
//   ---
//   title: Post title
//   description: One sentence for search results (under 160 characters)
//   date: 2026-11-22
//   draft: true          (optional: leave it out to publish)
//   ---
//   <p>Body as plain HTML…</p>
//
// Adding a file is publishing; no code change is needed. Posts marked draft are not
// sent, not listed and not in the sitemap.
const express = require('express');
const fs = require('fs');
const path = require('path');

const POSTS_DIR = path.join(__dirname, 'blog', 'posts');
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const siteUrl = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

function parse(slug, raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.title || !/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) return null;
  return { slug, title: meta.title, description: meta.description || '', date: meta.date, draft: /^(true|yes)$/i.test(meta.draft || ''), body: m[2] };
}

// All published posts, newest first. A post with no valid header is skipped.
function listPosts() {
  let files = [];
  try { files = fs.readdirSync(POSTS_DIR); } catch { return []; }
  const today = new Date().toISOString().slice(0, 10);
  return files
    .filter((f) => f.endsWith('.html') && SLUG.test(f.slice(0, -5)))
    .map((f) => parse(f.slice(0, -5), fs.readFileSync(path.join(POSTS_DIR, f), 'utf8')))
    .filter((p) => p && !p.draft && p.date <= today) // a future date means "not yet"
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

const CSS = 'body{font-family:system-ui,sans-serif;background:#f6f9fc;color:#334155;margin:0;line-height:1.65}main,header,footer{max-width:720px;margin:0 auto;padding:16px 20px}h1,h2,h3{color:#0f2338;line-height:1.25}a{color:#2563eb}.meta{color:#64748b;font-size:.9rem}footer{color:#64748b;font-size:.9rem}li{margin:6px 0}';

function page(req, { path: p, title, description, body, type = 'website', jsonLd = '' }) {
  const url = siteUrl(req);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${url}${p}" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<meta property="og:type" content="${type}" /><meta property="og:site_name" content="NexaDrip" /><meta property="og:locale" content="en_IN" />
<meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${url}${p}" /><meta property="og:image" content="${url}/og-image.png" />
<style>${CSS}</style>${jsonLd}</head>
<body><header><a href="/"><img src="/icon.svg" width="28" height="28" alt="" style="vertical-align:middle" /> <strong>NexaDrip</strong></a> · <a href="/blog">Blog</a></header>
<main>${body}</main>
<footer>© 2026 Radixile Technology Solutions LLP · <a href="/">Home</a> · <a href="/legal">Legal</a></footer></body></html>`;
}

const router = express.Router();

router.get(['/blog', '/blog/'], (req, res) => {
  const posts = listPosts();
  const list = posts.length
    ? `<ul>${posts.map((p) => `<li><a href="/blog/${p.slug}">${esc(p.title)}</a><div class="meta">${p.date}${p.description ? ` · ${esc(p.description)}` : ''}</div></li>`).join('')}</ul>`
    : '<p>No posts yet.</p>';
  res.type('html').send(page(req, {
    path: '/blog', title: 'Blog | NexaDrip',
    description: 'Social media, WhatsApp and SEO tips for Indian businesses and agencies, from NexaDrip.',
    body: `<h1>NexaDrip blog</h1>${list}`,
  }));
});

router.get('/blog/:slug', (req, res, next) => {
  const post = listPosts().find((p) => p.slug === req.params.slug);
  if (!post) return next();
  const url = siteUrl(req);
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, description: post.description,
    datePublished: post.date, dateModified: post.date, mainEntityOfPage: `${url}/blog/${post.slug}`,
    author: { '@type': 'Organization', name: 'NexaDrip' }, publisher: { '@type': 'Organization', name: 'Radixile Technology Solutions LLP' },
  }).replace(/</g, '\\u003c')}</script>`;
  res.type('html').send(page(req, {
    path: `/blog/${post.slug}`, title: `${post.title} | NexaDrip`, description: post.description, type: 'article', jsonLd,
    body: `<article><h1>${esc(post.title)}</h1><p class="meta">${post.date}</p>${post.body}</article><p><a href="/blog">← All posts</a></p>`,
  }));
});

module.exports = { router, listPosts, parse, POSTS_DIR };
