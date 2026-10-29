// Shared AI instructions: the workspace's Brand Kit plus the rules every post
// prompt gets (don't invent facts, plain text). Used by Write, Improve/Shorter
// and the Calendar's AI Assist so they all sound like the same brand.
const brandKitRepoFactory = require('../repos/brandKitRepo');

// `db`: the knex instance the calling router uses (defaults to the app database)
async function brandContext(workspaceId, db = null) {
  let brand = {};
  try {
    const repo = brandKitRepoFactory(db || require('./knex'));
    brand = (await repo.get(workspaceId)) || {};
  } catch { brand = {}; }
  const lines = [
    brand.company_name && `Brand name: ${brand.company_name}`,
    brand.tagline && `Tagline: ${brand.tagline}`,
    brand.brand_voice && `Brand voice: ${brand.brand_voice}`,
    brand.target_audience && `Target audience: ${brand.target_audience}`,
  ].filter(Boolean);
  let text = lines.length ? `BRAND:\n${lines.join('\n')}\n` : '';
  text += 'Only state facts given in the request or brand details — do not invent locations, prices, dates or claims.' +
    '\nWrite plain text only: no Markdown (no ** or # headings).';
  return text;
}

// Shortest character limit among the chosen platforms (for "one post for all")
const CHAR_LIMITS = {
  twitter: 280, pinterest: 500, google_business: 1500, instagram: 2200,
  tiktok: 2200, linkedin: 3000, youtube: 5000, facebook: 63206, threads: 500, bluesky: 300,
};
function shortestLimit(platforms) {
  const limits = (Array.isArray(platforms) ? platforms : []).map(p => CHAR_LIMITS[p]).filter(Boolean);
  return limits.length ? Math.min(...limits) : null;
}

module.exports = { brandContext, shortestLimit, CHAR_LIMITS };
