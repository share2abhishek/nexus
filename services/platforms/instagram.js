// Instagram (through the Facebook Graph API): photo, carousel (2–10 photos or
// videos), Reel, Story, and an optional first comment.
//
// Photos: Instagram fetches them from a public link; library photos get one from
// the Facebook Page for a moment (hostOnFacebook). Videos from the library are
// uploaded to Instagram directly (resumable upload), so they need no link.
const axios = require('axios');
const { GRAPH } = require('./apiVersions');
const { mediaList, kindOf, sleep, hostOnFacebook } = require('./media');

// Instagram prepares the photo/video first; publishing too early fails ("not ready")
async function waitForContainer(containerId, token, { video = false } = {}) {
  const tries = video ? 90 : 30; // videos can take a few minutes
  for (let i = 0; i < tries; i++) {
    const r = await axios.get(`${GRAPH}/${containerId}`, { params: { fields: 'status_code,status', access_token: token } });
    const s = r?.data?.status_code;
    if (s === 'FINISHED' || s === 'PUBLISHED' || !s) return;
    if (s === 'ERROR' || s === 'EXPIRED') {
      throw new Error(`Instagram could not use this ${r.data.status ? `media (${r.data.status})` : 'media'}. Check its size and shape, then press Retry.`);
    }
    await sleep(module.exports._pollDelay ?? (video ? 4000 : 2000));
  }
  throw new Error('Instagram is still preparing the media. Press Retry in a few minutes.');
}

// Instagram's common refusals, in words a person can act on
function instagramError(err) {
  const e = err.response?.data?.error;
  if (!e) return err;
  const sub = e.error_subcode;
  if (e.code === 36003 || sub === 2207009) return new Error('Instagram only accepts photos between portrait (4:5) and wide (1.91:1). Crop the photo, then press Retry.');
  if (e.code === 9004 || sub === 2207052) return new Error('Instagram could not download the picture. Use a JPG under 8 MB, then press Retry.');
  if (sub === 2207026) return new Error('Instagram did not accept this video format. Use an MP4 (H.264) under 1 GB, 3 to 90 seconds long.');
  if (e.code === 9007 || sub === 2207027) return new Error('Instagram is still preparing the media. Press Retry in a minute.');
  if (e.code === 4 || e.code === 17 || sub === 2207042) return new Error('Instagram’s daily posting limit for this account was reached (about 50 posts a day). Try again tomorrow.');
  if (e.code === 190) return new Error('The Instagram login expired. Click Connect on the Instagram card in Settings, then press Retry.');
  return new Error(`Instagram error ${e.code}${sub ? `/${sub}` : ''}: ${e.error_user_msg || e.message}`);
}

// One media container (a single post, a carousel item, a Reel or a Story)
async function makeContainer(ctx, m, { caption = null, carouselItem = false, format = 'feed' } = {}) {
  const { igId, token } = ctx;
  const kind = await kindOf(m);
  const params = { access_token: token };
  if (caption) params.caption = caption;
  if (carouselItem) params.is_carousel_item = true;

  if (kind === 'video') {
    params.media_type = carouselItem ? 'VIDEO' : format === 'story' ? 'STORIES' : 'REELS';
    if (params.media_type === 'REELS') params.share_to_feed = true;
    if (m.url) {
      params.video_url = m.url;
      const c = await axios.post(`${GRAPH}/${igId}/media`, params);
      return { id: c.data.id, video: true };
    }
    // Library video: upload the file itself
    const file = await m.file();
    params.upload_type = 'resumable';
    const c = await axios.post(`${GRAPH}/${igId}/media`, params);
    const uploadUrl = c.data.uri || `https://rupload.facebook.com/ig-api-upload/${GRAPH.split('/').pop()}/${c.data.id}`;
    await axios.post(uploadUrl, file.buffer, {
      headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(file.buffer.length), 'Content-Type': 'application/octet-stream' },
      maxBodyLength: Infinity, timeout: 15 * 60 * 1000,
    });
    return { id: c.data.id, video: true };
  }

  if (format === 'reel' && !carouselItem) throw new Error('Instagram Reels need a video. Choose a video, or post this as a normal photo post.');
  let url = m.url;
  if (!url) {
    const hosted = await hostOnFacebook(token, ctx.pageId, await m.file(), { workspaceId: ctx.workspaceId });
    ctx.hosted.push(hosted);
    url = hosted.url;
  }
  params.image_url = url;
  if (format === 'story' && !carouselItem) params.media_type = 'STORIES';
  const c = await axios.post(`${GRAPH}/${igId}/media`, params);
  return { id: c.data.id, video: false };
}

async function postToInstagram(pageToken, igAccountId, content, imageRef, { pageId = null, workspaceId = null, options = {} } = {}) {
  const items = mediaList(imageRef, options, workspaceId);
  if (!items.length) throw new Error('Instagram needs a photo or video: text-only posts aren’t possible. Add one, then press Retry.');
  const format = options.ig_format || 'feed';
  const ctx = { igId: igAccountId, token: pageToken, pageId, workspaceId, hosted: [] };

  try {
    let container;
    if (items.length > 1 && format === 'feed') {
      // Carousel: up to 10 items, each prepared first
      const children = [];
      for (const m of items.slice(0, 10)) {
        const c = await makeContainer(ctx, m, { carouselItem: true });
        await waitForContainer(c.id, pageToken, { video: c.video });
        children.push(c.id);
      }
      const parent = await axios.post(`${GRAPH}/${igAccountId}/media`, {
        media_type: 'CAROUSEL', children: children.join(','), caption: content, access_token: pageToken,
      });
      container = { id: parent.data.id, video: false };
    } else {
      container = await makeContainer(ctx, items[0], { caption: format === 'story' ? null : content, format });
    }
    await waitForContainer(container.id, pageToken, { video: container.video });
    const published = await axios.post(`${GRAPH}/${igAccountId}/media_publish`, { creation_id: container.id, access_token: pageToken });
    const result = { success: true, id: published.data.id, platform: 'instagram' };

    // First comment (often used for hashtags). A failure here doesn't undo the post.
    if (options.first_comment && format !== 'story') {
      try {
        await axios.post(`${GRAPH}/${published.data.id}/comments`, { message: options.first_comment, access_token: pageToken });
      } catch {
        result.warning = 'Posted, but the first comment could not be added (sign in to Instagram again from Settings to allow comments).';
      }
    }
    if (items.length > 1 && format !== 'feed') result.warning = `Only the first ${format === 'reel' ? 'video' : 'item'} was used: a ${format} has one photo or video.`;
    return result;
  } catch (err) {
    throw instagramError(err);
  } finally {
    for (const h of ctx.hosted) await h.cleanup();
  }
}

module.exports = { postToInstagram, waitForContainer, instagramError };
