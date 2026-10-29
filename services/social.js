// Posting to the platforms. Each platform lives in services/platforms/<name>.js;
// this file picks the right one and turns raw failures into plain messages.
//
// postToPlatform(platform, account, text, picture, options)
//   picture: a web link or a media library item ("media:<id>")
//   options: { media: [...] (several photos/videos), ig_format, first_comment }
const { postToLinkedIn, linkedInText } = require('./platforms/linkedin');
const { postToFacebook } = require('./platforms/facebook');
const { postToInstagram, instagramError } = require('./platforms/instagram');
const { postToPinterest } = require('./platforms/pinterest');
const { postToTwitter } = require('./platforms/twitter');
const { postToGoogleBusiness } = require('./platforms/googleBusiness');
const { postToBluesky } = require('./platforms/bluesky');
const { postToThreads } = require('./platforms/threads');
const { asMedia, hostOnFacebook, cleanupHostedPhotos } = require('./platforms/media');

async function postToYouTube() {
  // YouTube's public Data API has no way to create Community posts (text/image
  // posts); it only supports uploading videos, which Social-Nexus doesn't do yet.
  throw new Error('Posting text or images to YouTube is not possible through the public YouTube API. Publish there from YouTube Studio for now.');
}

async function postToTikTok() {
  // Kept for later: posting needs video upload and TikTok's app audit
  throw new Error('Posting to TikTok is not available yet. Publish there from the TikTok app for now.');
}

async function dispatchPost(platform, tokenData, content, imageRef, options = {}) {
  const ctx = { workspaceId: tokenData.workspace_id || null, options: options || {} };
  switch (platform) {
    case 'linkedin':
      return postToLinkedIn(tokenData.access_token, content, imageRef, tokenData.external_id, ctx);
    case 'facebook':
      return postToFacebook(tokenData.page_token, tokenData.page_id, content, imageRef, ctx);
    case 'instagram':
      return postToInstagram(tokenData.page_token || tokenData.access_token, tokenData.ig_account_id, content, imageRef,
        { ...ctx, pageId: tokenData.page_id || null });
    case 'pinterest':
      return postToPinterest(tokenData.access_token, tokenData.board_id, content, imageRef, ctx);
    case 'twitter':
      return postToTwitter(tokenData.access_token, tokenData.refresh_token, content, imageRef, ctx);
    case 'google_business':
      return postToGoogleBusiness(tokenData.access_token, tokenData.page_id, content, imageRef, ctx);
    case 'threads':
      return postToThreads(tokenData, content, imageRef, ctx);
    case 'bluesky':
      return postToBluesky(tokenData, content, imageRef, ctx);
    case 'youtube':
      return postToYouTube();
    case 'tiktok':
      return postToTikTok();
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

// Turn raw HTTP failures into a message the user can act on; adapter-specific
// messages (e.g. Facebook's) already pass through unchanged.
const PLATFORM_NAMES = {
  linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram', pinterest: 'Pinterest',
  twitter: 'Twitter/X', youtube: 'YouTube', google_business: 'Google Business', tiktok: 'TikTok',
  threads: 'Threads', bluesky: 'Bluesky',
};

async function postToPlatform(platform, tokenData, content, imageRef, options = {}) {
  try {
    return await dispatchPost(platform, tokenData, content, imageRef, options);
  } catch (err) {
    const name = PLATFORM_NAMES[platform] || platform;
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      throw new Error(`${name} rejected the connection (${status}) — the login has expired or lacks permission. Reconnect ${name} in Settings.`);
    }
    // The platform retired the API version this copy of Social-Nexus uses
    if (status === 426) throw new Error(`${name} no longer accepts posts from this version of Social-Nexus. Update Social-Nexus to keep posting to ${name}.`);
    if (status === 429) throw new Error(`${name} rate limit reached — try again later.`);
    if (status >= 500) throw new Error(`${name} is having problems (${status}) — try again later.`);
    if (status) {
      const d = err.response.data || {};
      const apiMsg = d.message || d.error?.message || d.error_description || d.detail || d.errors?.[0]?.message;
      throw new Error(`${name} error ${status}${apiMsg ? `: ${apiMsg}` : ''}`);
    }
    throw err;
  }
}

module.exports = {
  postToPlatform,
  postToLinkedIn, linkedInText, postToFacebook, postToInstagram,
  postToPinterest, postToTwitter,
  postToYouTube, postToGoogleBusiness, postToTikTok,
  asMedia, hostOnFacebook, cleanupHostedPhotos, instagramError,
};
