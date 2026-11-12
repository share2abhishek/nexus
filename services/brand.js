// The one place the whole app reads a workspace's brand from. Post design, AI copy,
// AI images, approval pages, reports, the chatbot and SEO all go through here so
// everything looks and sounds like the same brand. Add a consumer, don't re-query.
//
// - profile(): the full brand (name, voice, audience, colours, logo, font) with
//   sensible defaults, so design code never has to handle missing fields.
// - context(): the text block every AI copy prompt gets (brand + the house rules).
// - imagePromptStyle(): a brand-style suffix for AI image prompts (colours + mood;
//   never a fake logo — text-to-image can't reproduce a real one).
const brandKitRepoFactory = require('../repos/brandKitRepo');

// Matches the brand_kit column defaults (db/migrations/..._core_tables)
const DEFAULTS = { primary_color: '#7c3aed', secondary_color: '#3b82f6', accent_color: '#06b6d4', font_name: 'Inter' };
const FONTS = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Open Sans', 'Lato', 'Nunito', 'Space Grotesk'];

async function raw(workspaceId, db = null) {
  try {
    const repo = brandKitRepoFactory(db || require('./knex'));
    return (await repo.get(workspaceId)) || {};
  } catch { return {}; }
}

// Full brand for design/use. `configured` is the real "is the brand kit set up" signal.
async function profile(workspaceId, db = null) {
  const b = await raw(workspaceId, db);
  const font = FONTS.includes(b.font_name) ? b.font_name : DEFAULTS.font_name;
  return {
    company_name: b.company_name || '',
    tagline: b.tagline || '',
    brand_voice: b.brand_voice || '',
    target_audience: b.target_audience || '',
    primary_color: b.primary_color || DEFAULTS.primary_color,
    secondary_color: b.secondary_color || DEFAULTS.secondary_color,
    accent_color: b.accent_color || DEFAULTS.accent_color,
    logo_url: b.logo_url || '',
    font_name: font,
    configured: !!b.company_name,
  };
}

// The text block every AI copy prompt gets. Output kept stable: other prompts and
// tests depend on these exact lines.
async function context(workspaceId, db = null) {
  const b = await raw(workspaceId, db);
  const lines = [
    b.company_name && `Brand name: ${b.company_name}`,
    b.tagline && `Tagline: ${b.tagline}`,
    b.brand_voice && `Brand voice: ${b.brand_voice}`,
    b.target_audience && `Target audience: ${b.target_audience}`,
  ].filter(Boolean);
  let text = lines.length ? `BRAND:\n${lines.join('\n')}\n` : '';
  text += 'Only state facts given in the request or brand details — do not invent locations, prices, dates or claims.' +
    '\nWrite plain text only: no Markdown (no ** or # headings).';
  return text;
}

// A concise brand-style suffix to append to an AI image prompt. Empty when the
// brand kit isn't set up, so a plain prompt is left untouched.
function imagePromptStyle(brand) {
  if (!brand || !brand.company_name) return '';
  const colors = [brand.primary_color, brand.secondary_color, brand.accent_color].filter(Boolean);
  const parts = [];
  if (colors.length) parts.push(`use the brand colour palette ${colors.join(', ')} as the dominant and accent colours`);
  parts.push('clean, modern, professional look');
  return `Brand style: ${parts.join('; ')}. Keep it consistent with the "${brand.company_name}" brand. Do not add any text, words or logos to the image.`;
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

module.exports = { profile, context, imagePromptStyle, shortestLimit, CHAR_LIMITS, FONTS, DEFAULTS };
