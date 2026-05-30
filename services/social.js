const axios = require('axios');
const FormData = require('form-data');

// ── LinkedIn ──────────────────────────────────────────────────────────────────

async function postToLinkedIn(token, content, imageUrl = null) {
  const profileRes = await axios.get('https://api.linkedin.com/v2/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const urn = `urn:li:person:${profileRes.data.id}`;

  const body = {
    author: urn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: content },
        shareMediaCategory: imageUrl ? 'IMAGE' : 'NONE',
        ...(imageUrl && {
          media: [{
            status: 'READY',
            description: { text: 'Shared via NEXUS' },
            originalUrl: imageUrl,
          }],
        }),
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const res = await axios.post('https://api.linkedin.com/v2/ugcPosts', body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });

  return { success: true, id: res.data.id, platform: 'linkedin' };
}

// ── Facebook ──────────────────────────────────────────────────────────────────

async function postToFacebook(pageToken, pageId, content, imageUrl = null) {
  if (!pageToken) throw new Error('Facebook Page token missing. Reconnect Facebook in Settings.');
  if (!pageId)    throw new Error('Facebook Page ID missing. Select a page in Settings → Facebook → Select Facebook Page.');

  let endpoint, params;
  if (imageUrl) {
    endpoint = `https://graph.facebook.com/v18.0/${pageId}/photos`;
    params = { url: imageUrl, caption: content, access_token: pageToken };
  } else {
    endpoint = `https://graph.facebook.com/v18.0/${pageId}/feed`;
    params = { message: content, access_token: pageToken };
  }

  try {
    const res = await axios.post(endpoint, params);
    return { success: true, id: res.data.id, platform: 'facebook' };
  } catch (err) {
    const fb = err.response?.data?.error;
    if (fb) {
      // Map Facebook error codes to helpful messages
      const msg = fb.code === 190  ? `Token expired or invalid. Go to Graph API Explorer, generate a new token with pages_manage_posts permission, and reconnect in Settings.`
                : fb.code === 200  ? `Missing permission: pages_manage_posts. Regenerate token with that permission in Graph API Explorer.`
                : fb.code === 10   ? `App permission denied. Make sure pages_manage_posts is added to your Nexus app in Meta Developer Console.`
                : `Facebook error ${fb.code}: ${fb.message}`;
      throw new Error(msg);
    }
    throw err;
  }
}

// ── Instagram ─────────────────────────────────────────────────────────────────

async function postToInstagram(pageToken, igAccountId, content, imageUrl) {
  if (!imageUrl) {
    throw new Error('Instagram requires an image URL — text-only posts are not supported.');
  }

  // Step 1: Create media container
  const containerRes = await axios.post(
    `https://graph.facebook.com/v18.0/${igAccountId}/media`,
    { image_url: imageUrl, caption: content, access_token: pageToken }
  );

  const creationId = containerRes.data.id;

  // Step 2: Publish the container
  const publishRes = await axios.post(
    `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`,
    { creation_id: creationId, access_token: pageToken }
  );

  return { success: true, id: publishRes.data.id, platform: 'instagram' };
}

// ── Pinterest ─────────────────────────────────────────────────────────────────

async function postToPinterest(token, boardId, content, imageUrl = null) {
  const body = {
    board_id: boardId,
    title: content.substring(0, 100),
    description: content,
    link: null,
    ...(imageUrl && { media_source: { source_type: 'image_url', url: imageUrl } }),
  };

  const res = await axios.post('https://api.pinterest.com/v5/pins', body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  return { success: true, id: res.data.id, platform: 'pinterest' };
}

// ── Twitter / X ───────────────────────────────────────────────────────────────

async function postToTwitter(token, tokenSecret, content, imageUrl = null) {
  // Using Twitter API v2 with OAuth 1.0a
  const OAuth = require('oauth').OAuth;

  const oa = new OAuth(
    'https://api.twitter.com/oauth/request_token',
    'https://api.twitter.com/oauth/access_token',
    process.env.TWITTER_API_KEY,
    process.env.TWITTER_API_SECRET,
    '1.0A',
    null,
    'HMAC-SHA1'
  );

  return new Promise((resolve, reject) => {
    oa.post(
      'https://api.twitter.com/2/tweets',
      token,
      tokenSecret,
      JSON.stringify({ text: content.substring(0, 280) }),
      'application/json',
      (err, data) => {
        if (err) return reject(new Error(err.data || err.message || JSON.stringify(err)));
        const parsed = JSON.parse(data);
        resolve({ success: true, id: parsed.data?.id, platform: 'twitter' });
      }
    );
  });
}

// ── YouTube Community Post ────────────────────────────────────────────────────

async function postToYouTube(token, channelId, content, imageUrl = null) {
  // YouTube Community Posts via Data API v3
  // Note: requires channel with 500+ subscribers; posts as a community post
  const body = {
    snippet: {
      type: imageUrl ? 'textOriginal' : 'textOriginal',
      textOriginal: content,
      ...(imageUrl && {
        type: 'imagePost',
        imagePost: { url: imageUrl },
      }),
    },
  };

  const res = await axios.post(
    'https://www.googleapis.com/youtube/v3/communityPosts?part=snippet',
    body,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return { success: true, id: res.data.id, platform: 'youtube' };
}

// ── Google Business Profile Post ──────────────────────────────────────────────

async function postToGoogleBusiness(token, accountName, content, imageUrl = null) {
  // First get locations for this account
  const locRes = await axios.get(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`,
    { headers: { Authorization: `Bearer ${token}` }, params: { readMask: 'name,title' } }
  );
  const locations = locRes.data.locations || [];
  if (!locations.length) throw new Error('No Google Business locations found for this account');

  const locationName = locations[0].name;
  const postBody = {
    languageCode: 'en',
    summary: content,
    callToAction: { actionType: 'LEARN_MORE' },
    ...(imageUrl && { media: [{ mediaFormat: 'PHOTO', sourceUrl: imageUrl }] }),
  };

  const res = await axios.post(
    `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
    postBody,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return { success: true, id: res.data.name, platform: 'google_business' };
}

// ── TikTok Post ───────────────────────────────────────────────────────────────

async function postToTikTok(token, content, videoUrl = null) {
  // TikTok requires video content — text-only posts are not supported
  if (!videoUrl) throw new Error('TikTok requires a video URL. Text-only posts are not supported.');

  // Initialize upload
  const initRes = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      post_info: {
        title: content.substring(0, 150),
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );

  return { success: true, id: initRes.data.data?.publish_id, platform: 'tiktok', status: 'processing' };
}

// ── Master post dispatcher ────────────────────────────────────────────────────

async function postToPlatform(platform, tokenData, content, imageUrl) {
  switch (platform) {
    case 'linkedin':
      return postToLinkedIn(tokenData.access_token, content, imageUrl);

    case 'facebook':
      return postToFacebook(
        tokenData.page_token || tokenData.access_token,
        tokenData.page_id,
        content,
        imageUrl
      );

    case 'instagram':
      return postToInstagram(
        tokenData.page_token || tokenData.access_token,
        tokenData.ig_account_id,
        content,
        imageUrl
      );

    case 'pinterest':
      return postToPinterest(tokenData.access_token, tokenData.board_id, content, imageUrl);

    case 'twitter':
      return postToTwitter(tokenData.access_token, tokenData.refresh_token, content, imageUrl);

    case 'youtube':
      return postToYouTube(tokenData.access_token, tokenData.page_id, content, imageUrl);

    case 'google_business':
      return postToGoogleBusiness(tokenData.access_token, tokenData.page_id, content, imageUrl);

    case 'tiktok':
      return postToTikTok(tokenData.access_token, content, imageUrl);

    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

module.exports = {
  postToPlatform,
  postToLinkedIn, postToFacebook, postToInstagram,
  postToPinterest, postToTwitter,
  postToYouTube, postToGoogleBusiness, postToTikTok,
};
