// Threads (Meta): text up to 500 characters, one photo or video, or a carousel.
// Connected through Radixile's approved app (Meta only allows https sign-in
// addresses, which an app on a PC doesn't have). The login lasts 60 days and is
// renewed here without needing the app secret.
const axios = require('axios');
const { mediaList, kindOf, sleep, hostOnFacebook, workspaceFacebookPage } = require('./media');

const API = 'https://graph.threads.net/v1.0';

async function waitForContainer(id, token) {
  for (let i = 0; i < 60; i++) {
    const r = await axios.get(`${API}/${id}`, { params: { fields: 'status,error_message', access_token: token } });
    const s = r?.data?.status;
    if (!s || s === 'FINISHED' || s === 'PUBLISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`Threads could not use this media${r.data.error_message ? ` (${r.data.error_message})` : ''}.`);
    await sleep(module.exports._pollDelay ?? 3000);
  }
  throw new Error('Threads is still preparing the media. Press Retry in a few minutes.');
}

// Threads fetches media from public links; library photos borrow the Facebook Page
async function publicUrl(m, ctx) {
  if (m.url) return m.url;
  const file = await m.file();
  if (file.kind !== 'image') throw new Error('Threads: videos from the media library need a web link for now. Use a photo, or a video link.');
  const fb = ctx.workspaceId ? await workspaceFacebookPage(ctx.workspaceId) : null;
  if (!fb) throw new Error('Threads takes pictures from a public link. Paste a web link to the picture, or connect a Facebook Page (Social-Nexus uses it to share library photos).');
  const h = await hostOnFacebook(fb.pageToken, fb.pageId, file, { workspaceId: ctx.workspaceId });
  ctx.hosted.push(h);
  return h.url;
}

async function postToThreads(acc, content, imageRef = null, { workspaceId = null, options = {} } = {}) {
  const token = acc.access_token;
  const user = acc.external_id;
  const text = Array.from(String(content || '')).slice(0, 500).join(''); // never cuts an emoji in half
  const items = mediaList(imageRef, options, workspaceId);
  const ctx = { workspaceId, hosted: [] };
  try {
    let creation;
    if (!items.length) {
      creation = (await axios.post(`${API}/${user}/threads`, { media_type: 'TEXT', text, access_token: token })).data.id;
    } else if (items.length === 1) {
      const isVideo = (await kindOf(items[0])) === 'video';
      creation = (await axios.post(`${API}/${user}/threads`, {
        media_type: isVideo ? 'VIDEO' : 'IMAGE', [isVideo ? 'video_url' : 'image_url']: await publicUrl(items[0], ctx), text, access_token: token,
      })).data.id;
    } else {
      const children = [];
      for (const m of items.slice(0, 20)) {
        const isVideo = (await kindOf(m)) === 'video';
        const c = (await axios.post(`${API}/${user}/threads`, {
          media_type: isVideo ? 'VIDEO' : 'IMAGE', [isVideo ? 'video_url' : 'image_url']: await publicUrl(m, ctx), is_carousel_item: true, access_token: token,
        })).data.id;
        await waitForContainer(c, token);
        children.push(c);
      }
      creation = (await axios.post(`${API}/${user}/threads`, { media_type: 'CAROUSEL', children: children.join(','), text, access_token: token })).data.id;
    }
    await waitForContainer(creation, token);
    const r = await axios.post(`${API}/${user}/threads_publish`, { creation_id: creation, access_token: token });
    return {
      success: true, id: r.data.id, platform: 'threads',
      ...(text !== content ? { warning: 'Threads posts hold 500 characters: the text was shortened.' } : {}),
    };
  } finally {
    for (const h of ctx.hosted) await h.cleanup();
  }
}

// Renew the 60-day login (no app secret needed)
async function refreshThreads(acc) {
  const r = await axios.get('https://graph.threads.net/refresh_access_token', { params: { grant_type: 'th_refresh_token', access_token: acc.access_token } });
  return { access_token: r.data.access_token, expires_at: Math.floor(Date.now() / 1000) + (r.data.expires_in || 60 * 86400) };
}

async function threadsStats(acc, id) {
  const r = await axios.get(`${API}/${id}/insights`, { params: { metric: 'views,likes,replies,reposts,quotes', access_token: acc.access_token } });
  const v = Object.fromEntries((r.data.data || []).map(m => [m.name, Number(m.values?.[0]?.value ?? m.total_value?.value) || 0]));
  return { likes: v.likes || 0, comments: v.replies || 0, shares: (v.reposts || 0) + (v.quotes || 0), impressions: v.views || 0 };
}

module.exports = { postToThreads, refreshThreads, threadsStats };
