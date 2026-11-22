// Content Studio: turn pages, text files or pasted text into ready-to-schedule posts for each
// social network: a heading, the post text and hashtags, written for that platform.
//
//   readSource()   HTML or text in, plain readable text (and a title) out
//   buildPrompt()  the AI request for ONE source and the chosen platforms
//   parsePosts()   what the AI answered, checked and tidied
//   compose()      heading + text + hashtags as the final post, within the platform's limit
//   planTimes()    when each post goes out
const { neutralize, fence, looksLikeInjection } = require('./aiSafety');
const { CHAR_LIMITS } = require('./brand');

const MAX_SOURCES = 10;
const MAX_SOURCE_CHARS = 12000;
const MAX_TOTAL_CHARS = 60000;

// How hashtags and headings are used on each network
const STYLE = {
  linkedin:        { hashtags: 5, note: 'professional, insight-led; short paragraphs; a clear first line' },
  facebook:        { hashtags: 3, note: 'friendly and conversational; 1-3 hashtags at most' },
  instagram:       { hashtags: 10, note: 'visual, upbeat; line breaks; a block of relevant hashtags at the end' },
  twitter:         { hashtags: 2, note: 'one sharp idea, very short; 1-2 hashtags' },
  threads:         { hashtags: 1, note: 'casual and short; at most 1 hashtag' },
  bluesky:         { hashtags: 2, note: 'casual and short; 1-2 hashtags' },
  pinterest:       { hashtags: 5, note: 'descriptive, searchable keywords; a clear title' },
  google_business: { hashtags: 0, note: 'plain local business update; no hashtags' },
  youtube:         { hashtags: 5, note: 'community post, engaging question' },
  tiktok:          { hashtags: 5, note: 'trendy, short, hook in the first line' },
};

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“', '&ndash;': '–', '&mdash;': '—', '&hellip;': '…' };
const decode = (s) => s
  .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/g, (m) => ENTITIES[m] || m)
  .replace(/&#(\d{1,6});/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ' '; } });

/** { name, text } from a file name and its content. HTML is reduced to the words a reader sees. */
function readSource({ name = '', text = '' } = {}) {
  let raw = String(text == null ? '' : text);
  const looksHtml = /\.html?$/i.test(name) || /<\s*(html|body|head|p|div|h[1-6]|article|section)\b/i.test(raw.slice(0, 5000));
  let title = '';
  if (looksHtml) {
    const t = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const h = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const strip = (x) => decode(x.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    title = (h && strip(h[1])) || (t && strip(t[1])) || '';
    raw = raw
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)\s*>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    raw = decode(raw);
  }
  const body = raw.replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { name: String(name || 'Pasted text').slice(0, 120), title, text: body.slice(0, MAX_SOURCE_CHARS) };
}

/** Clean list of {name, text}: unreadable or empty ones dropped, size capped */
function prepareSources(sources) {
  const list = (Array.isArray(sources) ? sources : []).slice(0, MAX_SOURCES).map(readSource).filter((s) => s.text.length >= 20);
  let budget = MAX_TOTAL_CHARS;
  return list.filter((s) => { if (budget <= 0) return false; s.text = s.text.slice(0, budget); budget -= s.text.length; return true; });
}

function platformLines(platforms) {
  return platforms.map((p) => {
    const st = STYLE[p] || { hashtags: 3, note: 'clear and engaging' };
    return `- ${p}: ${st.note}. Up to ${st.hashtags} hashtags. Keep the whole post under ${CHAR_LIMITS[p] || 2000} characters.`;
  }).join('\n');
}

const MAX_POSTS_PER_PLATFORM = 30;
const MAX_POSTS_PER_RUN = 60; // posts x networks, so one run stays quick
function cleanCount(n, platformCount = 1) {
  const c = Math.floor(Number(n)) || 1;
  return Math.max(1, Math.min(MAX_POSTS_PER_PLATFORM, c, Math.floor(MAX_POSTS_PER_RUN / Math.max(1, platformCount))));
}

function buildPrompt(source, platforms, { brand = '', language = '', count = 1 } = {}) {
  const n = cleanCount(count, platforms.length);
  const f = fence('SOURCE', `${source.title ? `Title: ${source.title}\n` : ''}${source.text}`, MAX_SOURCE_CHARS + 300);
  const many = n > 1;
  return `You are a social media manager. Turn the source material below into ${many ? `${n} different posts` : 'one effective post'} for EACH of these platforms:
${platformLines(platforms)}

Rules:${many ? `
- Write exactly ${n} posts per platform. Each one takes a different angle (for example the offer, a tip, a short story, a question, a reminder, a behind-the-scenes look) so no two posts repeat each other. Order them so they can go out one after another.` : ''}
- Base every post only on facts in the source. Do not invent prices, dates, offers, names or links.
- Each post needs a short, strong "heading": a hook line of at most 90 characters.
- "body" is the post text without the heading and without hashtags.
- "hashtags": relevant ones, written as words without spaces, no leading # needed. Mix specific and broader topics.
- Each platform's post must read differently, not the same text repeated.
${language ? `- Write in ${language}.\n` : ''}${brand ? `\nBrand voice and facts:\n${brand}\n` : ''}
${f.rule}

${f.block}

Return ONLY a JSON array, one object per post (${many ? `${n} per platform` : 'one per platform'}), with no commentary:
[{"platform":"${platforms[0]}","heading":"...","body":"...","hashtags":["...","..."]}]`;
}

const cleanTag = (t) => String(t || '').replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 40);

/** Checked posts from the AI's list: only the asked-for platforms, each once, tags tidied */
function parsePosts(list, platforms, sourceName, count = 1) {
  const out = [];
  const seen = {};
  const per = cleanCount(count, platforms.length);
  for (const x of Array.isArray(list) ? list : []) {
    const platform = String(x?.platform || '').toLowerCase().replace(/[\s-]/g, '_');
    if (!platforms.includes(platform) || (seen[platform] || 0) >= per) continue;
    const heading = neutralize(x.heading || '', 120).replace(/\s+/g, ' ');
    const body = neutralize(x.body || x.text || '', 6000);
    if (!body) continue;
    const max = (STYLE[platform] || { hashtags: 3 }).hashtags;
    const hashtags = [...new Set((Array.isArray(x.hashtags) ? x.hashtags : String(x.hashtags || '').split(/[\s,]+/)).map(cleanTag).filter(Boolean))].slice(0, max);
    seen[platform] = (seen[platform] || 0) + 1;
    out.push({ platform, heading, body, hashtags, source: sourceName });
  }
  return out;
}

/** The final text of a post: heading, text, hashtags; shortened to fit the platform */
function compose(post, platform = post.platform) {
  const limit = CHAR_LIMITS[platform] || 2000;
  const head = (post.heading || '').trim();
  let tags = (post.hashtags || []).map(cleanTag).filter(Boolean).map((t) => `#${t}`);
  let body = String(post.body || '').trim();
  const join = () => [head, body, tags.join(' ')].filter(Boolean).join('\n\n');
  if (join().length <= limit) return join();
  // Too long: drop hashtags from the end while there are many, then shorten the text itself
  while (tags.length > 3 && join().length > limit) tags.pop();
  if (join().length > limit) {
    const room = Math.max(20, limit - (join().length - body.length) - 1);
    body = body.slice(0, room).replace(/\s+\S*$/, '') + '…';
  }
  return join().length > limit ? join().slice(0, limit) : join();
}

/** Times for `count` posts: the first at `start` (epoch seconds), then one every `intervalHours` */
function planTimes(count, start, intervalHours = 24) {
  const step = Math.max(0.25, Number(intervalHours) || 24) * 3600;
  return Array.from({ length: count }, (_, i) => Math.floor(Number(start) + i * step));
}

module.exports = { readSource, prepareSources, buildPrompt, parsePosts, compose, planTimes, cleanCount, looksLikeInjection, STYLE, MAX_SOURCES, MAX_POSTS_PER_PLATFORM };
