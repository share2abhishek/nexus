// Kept for the many callers that import { brandContext, shortestLimit, CHAR_LIMITS }.
// The brand now lives in one place — services/brand.js — and this just re-exports it,
// so there is a single source of brand truth for copy, design, images and the rest.
const brand = require('./brand');

module.exports = {
  brandContext: brand.context,
  shortestLimit: brand.shortestLimit,
  CHAR_LIMITS: brand.CHAR_LIMITS,
};
