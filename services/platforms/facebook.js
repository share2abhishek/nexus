// Facebook Page posts: text, one photo or video, several photos in one post, and
// an optional first comment.
const axios = require('axios');
const FormData = require('form-data');
const { GRAPH } = require('./apiVersions');
const { mediaList, kindOf } = require('./media');

function facebookError(err) {
  const fb = err.response?.data?.error;
  if (!fb) return err;
  return new Error(fb.code === 190 ? 'Token expired or invalid. Reconnect Facebook in Settings.'
    : fb.code === 200 ? 'Missing permission: pages_manage_posts. Reconnect Facebook in Settings.'
    : fb.code === 10 ? 'App permission denied. Make sure pages_manage_posts is enabled on your app.'
    : `Facebook error ${fb.code}: ${fb.message}`);
}

// One photo or video; published=false adds it to the Page for a multi-photo post
async function uploadOne(pageId, token, m, { caption = null, published = true } = {}) {
  if (m.url && !m.linkIsVideo) {
    return axios.post(`${GRAPH}/${pageId}/photos`, { url: m.url, ...(caption ? { caption } : {}), published, access_token: token });
  }
  const file = await m.file();
  const form = new FormData();
  form.append('access_token', token);
  if (!published) form.append('published', 'false');
  if (caption) form.append(file.kind === 'video' ? 'description' : 'caption', caption);
  form.append('source', file.buffer, { filename: `upload.${file.ext}`, contentType: file.mime });
  const edge = file.kind === 'video' ? 'videos' : 'photos';
  return axios.post(`${GRAPH}/${pageId}/${edge}`, form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 10 * 60 * 1000 });
}

async function postToFacebook(pageToken, pageId, content, imageRef = null, { workspaceId = null, options = {} } = {}) {
  // Posting needs a Page token + Page ID. Personal-profile posting (/me/feed) was
  // removed by Meta in 2018, and guessing a page could post to the wrong one.
  if (!pageToken) throw new Error('Facebook Page token missing. Reconnect Facebook in Settings.');
  if (!pageId)    throw new Error('No Facebook Page selected. Choose one in Settings → Facebook → Select page.');
  const items = mediaList(imageRef, options, workspaceId);

  try {
    let res;
    let warning = null;
    if (!items.length) {
      res = await axios.post(`${GRAPH}/${pageId}/feed`, { message: content, access_token: pageToken });
    } else if (items.length === 1) {
      res = await uploadOne(pageId, pageToken, items[0], { caption: content });
    } else {
      // Several items: photos go into one post; a video can't be mixed in
      const kinds = await Promise.all(items.map(kindOf));
      const photos = items.filter((_, i) => kinds[i] === 'image');
      if (photos.length < 2) {
        res = await uploadOne(pageId, pageToken, items[0], { caption: content });
        warning = 'Facebook can’t mix several videos or photos with videos in one post: only the first one was posted.';
      } else {
        const ids = [];
        for (const m of photos.slice(0, 30)) ids.push((await uploadOne(pageId, pageToken, m, { published: false })).data.id);
        res = await axios.post(`${GRAPH}/${pageId}/feed`, {
          message: content, attached_media: ids.map(id => ({ media_fbid: id })), access_token: pageToken,
        });
        if (photos.length < items.length) warning = 'Videos can’t be mixed with photos in one Facebook post: only the photos were posted.';
      }
    }
    const postId = res.data.post_id || res.data.id;
    const result = { success: true, id: postId, platform: 'facebook', ...(warning ? { warning } : {}) };

    if (options.first_comment) {
      try {
        await axios.post(`${GRAPH}/${postId}/comments`, { message: options.first_comment, access_token: pageToken });
      } catch {
        result.warning = [result.warning, 'Posted, but the first comment could not be added (sign in to Facebook again from Settings to allow comments).'].filter(Boolean).join(' ');
      }
    }
    return result;
  } catch (err) {
    throw facebookError(err);
  }
}

module.exports = { postToFacebook, facebookError };
