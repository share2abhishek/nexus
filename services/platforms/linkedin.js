// LinkedIn Posts API (/rest/posts): text, one photo, or several photos.
const axios = require('axios');
const { LINKEDIN_VERSION } = require('./apiVersions');
const { mediaList } = require('./media');

// LinkedIn treats some characters as formatting ("little text"): an unescaped ( or
// @ can cut the post short. Hashtags (#small_business, #दिवाली) pass through
// whole; everything else is escaped.
function linkedInText(text) {
  return String(text || '').split(/(#[\p{L}\p{M}\p{N}_]+)/u)
    .map((part, i) => (i % 2 ? part : part.replace(/[\\|{}@[\]()<>*_~#]/g, (c) => '\\' + c)))
    .join('');
}

// LinkedIn needs the picture itself, not a link: upload it first
async function uploadLinkedInImage(headers, ownerUrn, media) {
  let file;
  try { file = await media.file(); } catch (err) { throw new Error(`LinkedIn: ${err.message} Check the picture, then press Retry.`); }
  if (file.kind !== 'image') throw new Error('LinkedIn: videos can’t be posted to LinkedIn yet. Use a photo, or post the video from LinkedIn.');
  if (file.mime === 'image/webp') throw new Error('LinkedIn: WEBP pictures aren’t accepted. Use a JPG or PNG.');

  const init = await axios.post('https://api.linkedin.com/rest/images?action=initializeUpload',
    { initializeUploadRequest: { owner: ownerUrn } }, { headers });
  const { uploadUrl, image } = init.data?.value || {};
  if (!uploadUrl || !image) throw new Error('LinkedIn did not accept the image upload. Try again later.');
  await axios.put(uploadUrl, file.buffer, {
    headers: { Authorization: headers.Authorization, 'Content-Type': file.mime },
    maxBodyLength: Infinity,
  });
  return image; // urn:li:image:...
}

// memberId: the OpenID "sub" saved when the account was connected
async function postToLinkedIn(token, content, imageRef = null, memberId = null, { workspaceId = null, options = {} } = {}) {
  const items = mediaList(imageRef, options, workspaceId);
  let id = memberId;
  if (!id) {
    id = (await axios.get('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } })).data.sub;
  }
  const author = `urn:li:person:${id}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
    'Linkedin-Version': LINKEDIN_VERSION,
  };

  const body = {
    author,
    commentary: linkedInText(content),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (items.length === 1) {
    body.content = { media: { id: await uploadLinkedInImage(headers, author, items[0]) } };
  } else if (items.length > 1) {
    const images = [];
    for (const m of items.slice(0, 20)) images.push({ id: await uploadLinkedInImage(headers, author, m), altText: '' });
    body.content = { multiImage: { images } };
  }

  const res = await axios.post('https://api.linkedin.com/rest/posts', body, { headers });
  // The new post's id comes back in a header, e.g. urn:li:share:123
  return { success: true, id: res.headers?.['x-restli-id'] || res.data?.id || null, platform: 'linkedin' };
}

module.exports = { postToLinkedIn, linkedInText };
