// X (Twitter): text with up to 4 photos (API v2, OAuth 1.0a user context).
const axios = require('axios');
const FormData = require('form-data');
const { authHeader } = require('./oauth1');
const { mediaList } = require('./media');

const X_API = 'https://api.x.com/2';
const xKeys = (token, tokenSecret) => ({
  consumerKey: process.env.TWITTER_API_KEY, consumerSecret: process.env.TWITTER_API_SECRET, token, tokenSecret,
});

async function uploadXImage(keys, media) {
  let file;
  try { file = await media.file(); } catch (err) { throw new Error(`X: ${err.message}`); }
  if (file.kind !== 'image') throw new Error('X: videos can’t be posted to X yet. Use a photo, or post the video from the X app.');
  if (file.buffer.length > 5 * 1024 * 1024) throw new Error('X: pictures must be under 5 MB.');
  const url = `${X_API}/media/upload`;
  const form = new FormData();
  form.append('media', file.buffer, { filename: `photo.${file.ext}`, contentType: file.mime });
  form.append('media_category', 'tweet_image');
  const res = await axios.post(url, form, {
    headers: { ...form.getHeaders(), Authorization: authHeader('POST', url, keys) },
    maxBodyLength: Infinity,
  });
  const id = res.data?.data?.id || res.data?.media_id_string;
  if (!id) throw new Error('X did not accept the picture. Try again later.');
  return id;
}

async function postToTwitter(token, tokenSecret, content, imageRef = null, { workspaceId = null, options = {} } = {}) {
  const keys = xKeys(token, tokenSecret);
  const items = mediaList(imageRef, options, workspaceId);
  const body = { text: content.substring(0, 280) };
  const ids = [];
  for (const m of items.slice(0, 4)) ids.push(await uploadXImage(keys, m));
  if (ids.length) body.media = { media_ids: ids };

  const url = `${X_API}/tweets`;
  const res = await axios.post(url, body, {
    headers: { Authorization: authHeader('POST', url, keys), 'Content-Type': 'application/json' },
  });
  return {
    success: true, id: res.data?.data?.id, platform: 'twitter',
    ...(items.length > 4 ? { warning: 'X posts hold 4 photos: only the first 4 were used.' } : {}),
  };
}

module.exports = { postToTwitter };
