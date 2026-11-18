// The look of a workspace's website chat (the embeddable widget and the share page).
// Stored as JSON in meta_lead_configs.webchat_profile:
//   { name, description, color, avatar: "data:image/png;base64,…", whatsapp }
// Only these fields are ever sent to the public widget.

const MAX_AVATAR = 300 * 1024; // characters of the data: URL
const AVATAR_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

function parse(config) {
  let p = {};
  try { p = config?.webchat_profile ? JSON.parse(config.webchat_profile) : {}; } catch { p = {}; }
  return p && typeof p === 'object' ? p : {};
}

const text = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

// What the public widget may see. avatarUrl is the address of the avatar image.
function publicProfile(config, avatarUrl) {
  const p = parse(config);
  const color = /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : null;
  return {
    name: text(p.name, 60) || null,
    description: text(p.description, 400) || null,
    color,
    avatar_url: avatar(config) ? avatarUrl : null,
    whatsapp: String(p.whatsapp || '').replace(/[^0-9]/g, '').slice(0, 15) || null,
    placeholder: text(p.placeholder, 80) || null,
  };
}

// { mime, buffer } of the stored avatar, or null
function avatar(config) {
  const p = parse(config);
  const s = typeof p.avatar === 'string' && p.avatar.length <= MAX_AVATAR ? p.avatar : '';
  const m = s.match(AVATAR_RE);
  return m ? { mime: m[1], buffer: Buffer.from(m[2], 'base64') } : null;
}

module.exports = { parse, publicProfile, avatar, MAX_AVATAR };
