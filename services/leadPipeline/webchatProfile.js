// The look of a workspace's website chat (the embeddable widget and the share page).
// Stored as JSON in meta_lead_configs.webchat_profile:
//   { name, description, color, avatar: "data:image/png;base64,…", whatsapp, placeholder,
//     footer_text, footer_url, privacy_url, privacy_label }
// Only these fields are ever sent to the public widget.

const MAX_AVATAR = 300 * 1024; // characters of the data: URL
const AVATAR_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

function parse(config) {
  let p = {};
  try { p = config?.webchat_profile ? JSON.parse(config.webchat_profile) : {}; } catch { p = {}; }
  return p && typeof p === 'object' ? p : {};
}

const text = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const oneLine = (v, max) => text(v, max).replace(/\s+/g, ' ');
// Only plain web addresses: never javascript:, data: or a relative path
const webUrl = (v) => {
  const s = String(v ?? '').trim();
  if (!s || s.length > 500) return '';
  try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
};
// The line at the bottom of the chat when the business hasn't set its own
const DEFAULT_FOOTER = { text: 'Powered by Radixile Technology', url: 'https://radixile.com' };

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
    footer_text: oneLine(p.footer_text, 60) || DEFAULT_FOOTER.text,
    footer_url: p.footer_text ? (webUrl(p.footer_url) || null) : (webUrl(p.footer_url) || DEFAULT_FOOTER.url),
    privacy_url: webUrl(p.privacy_url) || null,
    privacy_label: webUrl(p.privacy_url) ? (oneLine(p.privacy_label, 60) || 'Privacy policy') : null,
  };
}

// { mime, buffer } of the stored avatar, or null
function avatar(config) {
  const p = parse(config);
  const s = typeof p.avatar === 'string' && p.avatar.length <= MAX_AVATAR ? p.avatar : '';
  const m = s.match(AVATAR_RE);
  return m ? { mime: m[1], buffer: Buffer.from(m[2], 'base64') } : null;
}

// What the owner edits on the Auto-replies screen (avatar as its data: URL)
function editable(config) {
  const p = parse(config);
  const pub = publicProfile(config, '');
  return {
    name: pub.name || '', description: pub.description || '', color: pub.color || '',
    placeholder: pub.placeholder || '', whatsapp: pub.whatsapp || '',
    avatar: avatar(config) ? p.avatar : '',
    // blank = the default line (the screen shows the default as a hint)
    footer_text: oneLine(p.footer_text, 60), footer_url: webUrl(p.footer_url),
    privacy_url: webUrl(p.privacy_url), privacy_label: webUrl(p.privacy_url) ? oneLine(p.privacy_label, 60) : '',
  };
}

// Check what the owner sent and return the JSON to store. Throws { status: 400 } on bad input.
function sanitize(input = {}) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  const color = String(input.color || '').trim();
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw bad('Choose a colour like #D4813C.');
  const av = String(input.avatar || '');
  if (av && av.length > MAX_AVATAR) throw bad('That picture is too large. Use one under 200 KB.');
  if (av && !AVATAR_RE.test(av)) throw bad('Use a PNG, JPG, WebP or GIF picture.');
  const whatsapp = String(input.whatsapp || '').replace(/[^0-9]/g, '');
  if (whatsapp && (whatsapp.length < 8 || whatsapp.length > 15)) throw bad('Write the WhatsApp number with the country code, e.g. 919876543210.');
  for (const [k, label] of [['footer_url', 'bottom line link'], ['privacy_url', 'privacy policy link']]) {
    if (String(input[k] || '').trim() && !webUrl(input[k])) throw bad(`Write the ${label} as a full web address starting with https://`);
  }
  if (String(input.privacy_label || '').trim() && !webUrl(input.privacy_url)) throw bad('Add the privacy policy link, or clear its text.');
  const out = {
    name: text(input.name, 60), description: text(input.description, 400), color,
    placeholder: text(input.placeholder, 80), whatsapp, avatar: av,
    footer_text: oneLine(input.footer_text, 60), footer_url: webUrl(input.footer_url),
    privacy_url: webUrl(input.privacy_url), privacy_label: oneLine(input.privacy_label, 60),
  };
  Object.keys(out).forEach((k) => { if (!out[k]) delete out[k]; });
  return out;
}

module.exports = { parse, publicProfile, avatar, editable, sanitize, MAX_AVATAR, DEFAULT_FOOTER };
