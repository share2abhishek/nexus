// Platform API versions, in one place. Each one is retired by the platform after
// a while (Meta: about 2 years; LinkedIn: about 1 year). tests/platforms.test.js
// fails when one is getting old, so `npm test` before a release catches it.
//   Meta:     https://developers.facebook.com/docs/graph-api/changelog
//   LinkedIn: https://learn.microsoft.com/linkedin/marketing/versioning
const META_VERSION = 'v26.0';
const META_RELEASED = '2026-07-29';
const LINKEDIN_VERSION = '202610'; // YYYYMM: released that month

module.exports = {
  META_VERSION,
  META_RELEASED,
  LINKEDIN_VERSION,
  GRAPH: `https://graph.facebook.com/${META_VERSION}`,
  FB_DIALOG: `https://www.facebook.com/${META_VERSION}/dialog/oauth`,
};
