// RSS / Atom feeds: each new article on your blog or news page becomes a post —
// a draft to check (default) or scheduled 15 minutes later.
//
// First check of a feed only remembers what's already there, so adding a feed
// never floods the calendar with old articles. At most 3 new posts per feed per check.

const axios = require('axios');

const now = () => Math.floor(Date.now() / 1000);
const MAX_NEW_PER_CHECK = 3;
const SCHEDULE_DELAY = 15 * 60;
const EVERY = 30 * 60 * 1000;

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const stripTags = (s) => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function tag(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1]).trim() : '';
}
function attr(block, name, attribute) {
  const m = new RegExp(`<${name}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, 'i').exec(block);
  return m ? decode(m[1]) : '';
}

// Items from RSS 2.0 or Atom, newest first as the feed lists them
function parseFeed(xml) {
  const text = String(xml || '');
  const title = stripTags(tag(text.replace(/<(item|entry)\b[\s\S]*$/i, ''), 'title'));
  const blocks = text.match(/<item\b[\s\S]*?<\/item>/gi) || text.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const items = blocks.map((b) => {
    const isAtom = /^<entry/i.test(b);
    const link = isAtom ? (attr(b, 'link[^>]*rel=["\']alternate["\']', 'href') || attr(b, 'link', 'href')) : (tag(b, 'link') || attr(b, 'link', 'href'));
    const image = attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url')
      || (/type=["']image\//i.test(b) ? attr(b, 'enclosure', 'url') : '')
      || (/<img[^>]+src=["']([^"']+)["']/i.exec(decode(tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'content'))) || [])[1] || '';
    return {
      guid: (tag(b, 'guid') || tag(b, 'id') || link || tag(b, 'title')).slice(0, 500),
      title: stripTags(tag(b, 'title')).slice(0, 300),
      link: link.trim(),
      summary: stripTags(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 600),
      image: /^https:\/\//i.test(image) ? image : '',
    };
  }).filter((i) => i.guid && (i.title || i.link));
  return { title, items };
}

// Feeds live on the public internet; never fetch this PC or the local network
// (on a hosted server that could reach internal services)
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1' || h === '0.0.0.0'
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}

async function fetchFeed(url) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('The feed address must start with http:// or https://');
  let host = '';
  try { host = new URL(url).hostname; } catch { throw new Error('That doesn’t look like a web address.'); }
  if (isPrivateHost(host)) throw new Error('Use the feed’s public web address (not one on this PC or your local network).');
  const r = await axios.get(url, {
    maxRedirects: 3,
    beforeRedirect: (opts) => { if (isPrivateHost(opts.hostname)) throw new Error('The feed redirected to a local address.'); },
    timeout: 15000, maxContentLength: 3 * 1024 * 1024, responseType: 'text',
    headers: { 'User-Agent': 'Social-Nexus feed reader', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
  });
  const parsed = parseFeed(r.data);
  if (!parsed.items.length && !/<(rss|feed|rdf)/i.test(String(r.data))) {
    throw new Error('This address is a web page, not a feed. Look for an “RSS” link on the site (often /feed or /rss.xml).');
  }
  return parsed;
}

// The post text for one article
function postText(item, signature) {
  const summary = item.summary && item.summary !== item.title
    ? (item.summary.length > 220 ? `${item.summary.slice(0, 217).replace(/\s+\S*$/, '')}…` : item.summary) : '';
  return [item.title, summary, item.link, signature].filter(Boolean).join('\n\n');
}

async function checkFeed(db, feed, { seedOnly = false } = {}) {
  let parsed;
  try { parsed = await fetchFeed(feed.url); } catch (err) {
    const msg = err.response?.status ? `The site answered with error ${err.response.status}.` : err.message;
    await db('rss_feeds').where({ id: feed.id }).update({ last_checked_at: now(), last_error: msg.slice(0, 300) });
    return { created: 0, error: msg };
  }
  const known = new Set(await db('rss_seen').where({ feed_id: feed.id }).pluck('guid'));
  const firstCheck = !feed.last_checked_at || seedOnly;
  const fresh = parsed.items.filter((i) => !known.has(i.guid));
  const toPost = firstCheck ? [] : fresh.slice(0, MAX_NEW_PER_CHECK).reverse(); // oldest of the new first

  let signature = '';
  if (feed.add_signature) {
    signature = (await db('post_signatures').where({ workspace_id: feed.workspace_id, is_default: true }).first('text'))?.text || '';
  }
  const platforms = (() => { try { return JSON.parse(feed.platforms_json || '[]'); } catch { return []; } })();
  const repo = require('../repos/contentRepo')(db);
  let created = 0;
  for (const item of toPost) {
    const id = await repo.create(feed.workspace_id, feed.created_by, {
      title: `From your feed: ${item.title}`.slice(0, 200), body: postText(item, signature),
      platforms, image_url: item.image || null,
    });
    if (feed.mode === 'schedule') {
      await db('content_items').where({ id }).update({ status: 'scheduled', scheduled_at: now() + SCHEDULE_DELAY + created * 60 });
    }
    created++;
  }
  for (const item of fresh) {
    await db('rss_seen').insert({ feed_id: feed.id, guid: item.guid, created_at: now() }).onConflict(['feed_id', 'guid']).ignore();
  }
  await db('rss_feeds').where({ id: feed.id }).update({
    last_checked_at: now(), last_error: null, posts_created: (feed.posts_created || 0) + created,
    ...(feed.name ? {} : { name: (parsed.title || '').slice(0, 200) || null }),
  });
  return { created, new_items: fresh.length, first_check: firstCheck, title: parsed.title };
}

async function checkAll(db) {
  if (!(await db.schema.hasTable('rss_feeds'))) return;
  const feeds = await db('rss_feeds').where({ enabled: true });
  for (const f of feeds) await checkFeed(db, f).catch((err) => console.warn('[RSS]', err.message));
}

let timer = null;
function start(db) {
  setTimeout(() => checkAll(db), 2 * 60 * 1000);
  timer = setInterval(() => checkAll(db), EVERY);
  timer.unref?.();
}

module.exports = { parseFeed, fetchFeed, postText, checkFeed, checkAll, start, MAX_NEW_PER_CHECK, SCHEDULE_DELAY };
