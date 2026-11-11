// The exact OAuth redirect ("callback") URL for each platform. It must match,
// character for character, what the user pastes into that platform's developer
// portal — so it's derived from the port the app really runs on, not hard-coded.
//
// X/Twitter recommends 127.0.0.1 rather than "localhost"; the others accept localhost.
// A *_CALLBACK_URL in .env is only honoured when it points somewhere other than
// this PC (e.g. a custom domain) — old values like localhost:3000 are ignored.
const PATHS = {
  linkedin: { env: 'LINKEDIN_CALLBACK_URL', path: 'linkedin', host: 'localhost' },
  facebook: { env: 'FACEBOOK_CALLBACK_URL', path: 'facebook', host: 'localhost' },
  instagram: { env: 'FACEBOOK_CALLBACK_URL', path: 'facebook', host: 'localhost' },
  pinterest: { env: 'PINTEREST_CALLBACK_URL', path: 'pinterest', host: 'localhost' },
  twitter: { env: 'TWITTER_CALLBACK_URL', path: 'twitter', host: '127.0.0.1' },
  google: { env: 'GOOGLE_CALLBACK_URL', path: 'google', host: 'localhost' },
  youtube: { env: 'GOOGLE_CALLBACK_URL', path: 'google', host: 'localhost' },
  google_business: { env: 'GOOGLE_CALLBACK_URL', path: 'google', host: 'localhost' },
  tiktok: { env: 'TIKTOK_CALLBACK_URL', path: 'tiktok', host: 'localhost' },
};

function callbackUrl(platform) {
  const p = PATHS[platform];
  if (!p) throw new Error(`Unknown platform ${platform}`);
  const custom = process.env[p.env];
  if (custom && !/\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(custom)) return custom;
  return `http://${p.host}:${process.env.PORT || 3000}/auth/${p.path}/callback`;
}

module.exports = { callbackUrl };
