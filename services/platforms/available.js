// Platforms Social-Nexus can post to today. YouTube (the public API can't create
// Community posts) and TikTok (needs video upload and TikTok's app audit) are left
// out until they work end to end; the AI tools can still write for them.
const PUBLISHABLE = ['linkedin', 'facebook', 'instagram', 'pinterest', 'twitter', 'google_business', 'threads', 'bluesky'];

const NAMES = { youtube: 'YouTube', tiktok: 'TikTok' };

const isPublishable = (platform) => PUBLISHABLE.includes(platform);

const notAvailableMessage = (platform) =>
  `Posting to ${NAMES[platform] || platform} is not available yet. Copy the text and post it from the ${NAMES[platform] || platform} app.`;

// For routes that create or schedule posts: an error message, or null when all are fine
function checkPlatforms(platforms) {
  const bad = (Array.isArray(platforms) ? platforms : []).filter(p => !isPublishable(p));
  return bad.length ? notAvailableMessage(bad[0]) : null;
}

module.exports = { PUBLISHABLE, isPublishable, notAvailableMessage, checkPlatforms };
