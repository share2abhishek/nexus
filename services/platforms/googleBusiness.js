// Google Business Profile posts (v4 localPosts): text with one photo.
const axios = require('axios');
const { mediaList, hostOnFacebook, workspaceFacebookPage } = require('./media');

const ACCOUNTS = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';

// Google's errors in words people can act on
function googleError(err) {
  const g = err.response?.data?.error || {};
  const status = err.response?.status;
  const msg = String(g.message || err.message || '');
  if (status === 429 || /quota/i.test(msg)) {
    return new Error('Google hasn’t given your Google Cloud project access to the Business Profile APIs yet (its limit is 0). Request access at developers.google.com/my-business/content/prereqs, then connect again.');
  }
  if (status === 403 && /has not been used|is disabled|not enabled/i.test(msg)) {
    return new Error('Turn on the “My Business Account Management API” and “My Business Business Information API” for your project in Google Cloud Console, then connect again.');
  }
  if (status === 403) return new Error(`Google refused: ${msg || 'no permission for this Business Profile.'} Check that this Google account manages the profile.`);
  if (status === 401) return new Error('The Google sign-in has ended. Connect Google Business again.');
  return new Error(msg || 'Google didn’t answer.');
}

function addressLine(a) {
  if (!a) return '';
  return [...(a.addressLines || []), a.locality, a.postalCode].filter(Boolean).join(', ');
}

// Every business location this Google login manages, across all its accounts
// (the first account is often the person's own, with no locations)
async function listLocations(token) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  let accounts = [];
  try {
    let pageToken;
    do {
      const r = await axios.get(ACCOUNTS, { ...auth, params: { pageSize: 20, pageToken } });
      accounts.push(...(r.data.accounts || []));
      pageToken = r.data.nextPageToken;
    } while (pageToken && accounts.length < 100);
  } catch (err) { throw googleError(err); }

  const out = [];
  for (const a of accounts) {
    let pageToken;
    do {
      let r;
      try {
        r = await axios.get(`${INFO}/${a.name}/locations`, { ...auth, params: { readMask: 'name,title,storefrontAddress', pageSize: 100, pageToken } });
      } catch (err) { throw googleError(err); }
      for (const l of r.data.locations || []) {
        out.push({ account: a.name, account_title: a.accountName || '', location: l.name, title: l.title || l.name, address: addressLine(l.storefrontAddress) });
      }
      pageToken = r.data.nextPageToken;
    } while (pageToken && out.length < 500);
  }
  return out;
}

async function postToGoogleBusiness(token, accountName, content, imageRef = null, { workspaceId = null, options = {}, location = null } = {}) {
  const items = mediaList(imageRef, options, workspaceId);
  const media = items[0] || null;
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  // The location chosen in Settings; without one, only an account with exactly one location is safe to guess
  let target = location && accountName ? `${accountName}/${location}` : null;
  if (!target) {
    const all = await listLocations(token);
    if (!all.length) throw new Error('No Google Business locations found for this Google account.');
    if (all.length > 1) throw new Error('You manage several Google Business locations: choose one on the Google Business card in Settings → Connected accounts.');
    target = `${all[0].account}/${all[0].location}`;
  }

  // Google fetches the picture from a public link: library photos borrow the
  // Facebook Page (kept 2 days, since Google may fetch it a while later)
  let url = media?.url || null;
  if (media && !url) {
    const fb = workspaceId ? await workspaceFacebookPage(workspaceId) : null;
    if (!fb) throw new Error('Google Business needs a public picture link. Paste a web link to the picture, or connect a Facebook Page (Social-Nexus uses it to share library photos).');
    url = (await hostOnFacebook(fb.pageToken, fb.pageId, await media.file(), { workspaceId, keepFor: 2 * 86400 })).url;
  }

  let res;
  try {
    res = await axios.post(`https://mybusiness.googleapis.com/v4/${target}/localPosts`, {
      languageCode: 'en',
      summary: content.substring(0, 1500),
      topicType: 'STANDARD',
      ...(url && { media: [{ mediaFormat: 'PHOTO', sourceUrl: url }] }),
    }, { headers: { ...auth.headers, 'Content-Type': 'application/json' } });
  } catch (err) { throw googleError(err); }
  return {
    success: true, id: res.data.name, platform: 'google_business',
    ...(content.length > 1500 ? { warning: 'Google Business posts are at most 1500 characters: the end was cut off.' } : {}),
    ...(items.length > 1 ? { warning: 'Google Business posts have one photo: only the first was used.' } : {}),
  };
}

module.exports = { postToGoogleBusiness, listLocations, googleError };
