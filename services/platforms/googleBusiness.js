// Google Business Profile posts (v4 localPosts): text with one photo.
const axios = require('axios');
const { mediaList, hostOnFacebook, workspaceFacebookPage } = require('./media');

async function postToGoogleBusiness(token, accountName, content, imageRef = null, { workspaceId = null, options = {} } = {}) {
  const items = mediaList(imageRef, options, workspaceId);
  const media = items[0] || null;
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const locRes = await axios.get(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`,
    { ...auth, params: { readMask: 'name,title' } });
  const locations = locRes.data.locations || [];
  if (!locations.length) throw new Error('No Google Business locations found for this account');
  // The posts API (v4) wants accounts/{a}/locations/{l}; the list gives locations/{l}
  const location = `${accountName}/${locations[0].name}`;

  // Google fetches the picture from a public link: library photos borrow the
  // Facebook Page (kept 2 days, since Google may fetch it a while later)
  let url = media?.url || null;
  if (media && !url) {
    const fb = workspaceId ? await workspaceFacebookPage(workspaceId) : null;
    if (!fb) throw new Error('Google Business needs a public picture link. Paste a web link to the picture, or connect a Facebook Page (Social-Nexus uses it to share library photos).');
    url = (await hostOnFacebook(fb.pageToken, fb.pageId, await media.file(), { workspaceId, keepFor: 2 * 86400 })).url;
  }

  const res = await axios.post(`https://mybusiness.googleapis.com/v4/${location}/localPosts`, {
    languageCode: 'en',
    summary: content.substring(0, 1500),
    topicType: 'STANDARD',
    ...(url && { media: [{ mediaFormat: 'PHOTO', sourceUrl: url }] }),
  }, { headers: { ...auth.headers, 'Content-Type': 'application/json' } });
  return {
    success: true, id: res.data.name, platform: 'google_business',
    ...(items.length > 1 ? { warning: 'Google Business posts have one photo: only the first was used.' } : {}),
  };
}

module.exports = { postToGoogleBusiness };
