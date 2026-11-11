// Bluesky (AT Protocol): text up to 300 characters with up to 4 photos, links
// and hashtags made clickable. Connects with the account's handle and an app
// password (Settings → Privacy and security → App passwords on Bluesky) — no
// developer app, nothing passes through Radixile.
const axios = require('axios');
const { mediaList } = require('./media');

const DEFAULT_SERVICE = 'https://bsky.social';
const MAX_IMAGE = 976 * 1024; // Bluesky's limit per picture
const MAX_GRAPHEMES = 300;

const service = (acc) => (acc.page_id && /^https:\/\//.test(acc.page_id) ? acc.page_id : DEFAULT_SERVICE).replace(/\/$/, '');

async function login(serviceUrl, identifier, password) {
  const r = await axios.post(`${serviceUrl}/xrpc/com.atproto.server.createSession`, { identifier, password }, { timeout: 20000 })
    .catch((err) => {
      const e = err.response?.data?.error;
      if (e === 'AuthenticationRequired' || err.response?.status === 401) throw new Error('Bluesky did not accept the handle and app password. Make a new app password on Bluesky (Settings → Privacy and security → App passwords) and connect again.');
      if (e === 'RateLimitExceeded') throw new Error('Bluesky is limiting sign-ins right now. Try again in a few minutes.');
      throw err;
    });
  return r.data; // { did, handle, accessJwt, refreshJwt }
}

// Clickable links and #hashtags: Bluesky wants their byte positions (UTF-8)
function facets(text) {
  const out = [];
  const enc = new TextEncoder();
  const byteAt = (i) => enc.encode(text.slice(0, i)).length;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g)) {
    out.push({ index: { byteStart: byteAt(m.index), byteEnd: byteAt(m.index + m[0].length) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  }
  for (const m of text.matchAll(/(^|\s)(#[\p{L}\p{M}\p{N}_]+)/gu)) {
    const start = m.index + m[1].length;
    out.push({ index: { byteStart: byteAt(start), byteEnd: byteAt(start + m[2].length) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2].slice(1) }] });
  }
  return out;
}

function fitText(text) {
  const parts = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(String(text || ''))].map(s => s.segment);
  return parts.length <= MAX_GRAPHEMES ? text : parts.slice(0, MAX_GRAPHEMES - 1).join('') + '…';
}

async function postToBluesky(acc, content, imageRef = null, { workspaceId = null, options = {} } = {}) {
  const base = service(acc);
  if (base !== DEFAULT_SERVICE) await require('../mediaStore').assertPublicUrl(base);
  const session = await login(base, acc.external_id, acc.access_token);
  const auth = { Authorization: `Bearer ${session.accessJwt}` };
  const text = fitText(content);
  // Language labels help Bluesky show the post to the right people
  const langs = /[\u0900-\u097F]/.test(text) ? ['hi'] : /[\u0B80-\u0BFF]/.test(text) ? ['ta'] : /[\u0980-\u09FF]/.test(text) ? ['bn'] : ['en'];
  const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(), langs };
  const f = facets(text);
  if (f.length) record.facets = f;

  const items = mediaList(imageRef, options, workspaceId);
  if (items.length) {
    const images = [];
    for (const m of items.slice(0, 4)) {
      const file = await m.file();
      if (file.kind !== 'image') throw new Error('Bluesky: videos aren’t supported yet. Use a photo.');
      if (file.buffer.length > MAX_IMAGE) throw new Error('Bluesky accepts pictures up to about 1 MB. Use a smaller JPG.');
      const up = await axios.post(`${base}/xrpc/com.atproto.repo.uploadBlob`, file.buffer, { headers: { ...auth, 'Content-Type': file.mime }, maxBodyLength: Infinity, timeout: 60000 });
      images.push({ alt: '', image: up.data.blob });
    }
    record.embed = { $type: 'app.bsky.embed.images', images };
  }

  const r = await axios.post(`${base}/xrpc/com.atproto.repo.createRecord`,
    { repo: session.did, collection: 'app.bsky.feed.post', record }, { headers: auth, timeout: 30000 });
  const notes = [
    text !== content ? 'Bluesky posts hold 300 characters: the text was shortened.' : '',
    items.length > 4 ? 'Bluesky posts hold 4 photos: only the first 4 were used.' : '',
  ].filter(Boolean);
  return { success: true, id: r.data.uri, platform: 'bluesky', ...(notes.length ? { warning: notes.join(' ') } : {}) };
}

// Likes, reposts and replies (public, no login needed)
async function blueskyStats(uri) {
  const r = await axios.get('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts', { params: { uris: uri }, timeout: 15000 });
  const p = r.data?.posts?.[0] || {};
  return { likes: p.likeCount || 0, comments: p.replyCount || 0, shares: (p.repostCount || 0) + (p.quoteCount || 0) };
}

module.exports = { postToBluesky, login, facets, blueskyStats, DEFAULT_SERVICE };
