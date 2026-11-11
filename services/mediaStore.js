// Media library files on disk, and turning a post's picture (a library item or a
// web link) into the file itself for platforms that need the upload.
//
// A post refers to a library item as "media:<id>"; anything else is a web link.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');

const DATA_DIR = process.env.NEXUS_DATA_DIR || path.join(__dirname, '..', 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

const LIMITS = { image: 15 * 1024 * 1024, video: 200 * 1024 * 1024 };
const MEDIA_PREFIX = 'media:';

// What the file really is, from its first bytes (never trust the name or browser)
function sniff(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (b.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (b.slice(0, 6).toString() === 'GIF87a' || b.slice(0, 6).toString() === 'GIF89a') return { mime: 'image/gif', ext: 'gif', kind: 'image' };
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (b.slice(4, 8).toString() === 'ftyp') {
    const brand = b.slice(8, 12).toString();
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov', kind: 'video' };
    return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
  }
  return null;
}

// Width and height of a JPG, PNG, GIF or WEBP picture (null when unknown)
function imageSize(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b.slice(0, 3).toString() === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') {
      const chunk = b.slice(12, 16).toString();
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      // Walk the JPEG markers to the frame header (SOF0–SOF15, not DHT/JPG/DAC)
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {}
  return null;
}

const isMediaRef = (ref) => typeof ref === 'string' && ref.startsWith(MEDIA_PREFIX);
const mediaId = (ref) => (isMediaRef(ref) ? Number(ref.slice(MEDIA_PREFIX.length)) || null : null);
const wsDir = (workspaceId) => path.join(MEDIA_DIR, String(Number(workspaceId)));
const filePath = (asset) => path.join(wsDir(asset.workspace_id), path.basename(asset.stored_name));

// Saves a file into the library. Returns the new row.
async function save(db, workspaceId, userId, buffer, { name = null, source = 'upload' } = {}) {
  const type = sniff(buffer);
  if (!type) throw Object.assign(new Error('That file isn’t a supported photo or video. Use JPG, PNG, GIF, WEBP, MP4 or MOV.'), { status: 415 });
  if (buffer.length > LIMITS[type.kind]) {
    throw Object.assign(new Error(`That ${type.kind} is too large (most ${LIMITS[type.kind] / 1024 / 1024} MB).`), { status: 413 });
  }
  const dir = wsDir(workspaceId);
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${crypto.randomUUID()}.${type.ext}`;
  fs.writeFileSync(path.join(dir, stored), buffer);
  const row = {
    workspace_id: workspaceId, uploaded_by: userId || null,
    original_name: name ? String(name).replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 200) : null,
    stored_name: stored, mime: type.mime, kind: type.kind, size: buffer.length, source,
    created_at: Math.floor(Date.now() / 1000),
  };
  const dims = type.kind === 'image' ? imageSize(buffer) : null;
  if (dims && (await db.schema.hasColumn('media_assets', 'width'))) Object.assign(row, dims);
  const [id] = await db('media_assets').insert(row).returning('id');
  return { id: id?.id ?? id, ...row };
}

async function get(db, workspaceId, id) {
  return db('media_assets').where({ id, workspace_id: workspaceId }).first();
}

async function remove(db, workspaceId, id) {
  const asset = await get(db, workspaceId, id);
  if (!asset) return false;
  await db('media_assets').where({ id: asset.id }).del();
  try { fs.unlinkSync(filePath(asset)); } catch {}
  return true;
}

// Addresses on this PC or the local network: never fetched from a web link
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('The picture link isn’t a valid web address.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('The image link must start with http:// or https://.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('The picture’s website could not be found. Check the link.');
  if (addrs.some(a => isPrivateIp(a.address))) throw new Error('Pictures can only come from public websites, not from this PC or your local network.');
}

// Downloads a picture or video from a web link (public addresses only, size-limited).
// Redirects are followed by hand so each new address is checked too.
async function download(url) {
  let current = url;
  let res;
  for (let hop = 0; hop <= 3; hop++) {
    await assertPublicUrl(current);
    try {
      res = await axios.get(current, {
        responseType: 'arraybuffer', timeout: 60000, maxContentLength: LIMITS.video, maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });
    } catch {
      throw new Error('The picture could not be downloaded from its link (it must be public: photos up to 15 MB, videos up to 200 MB).');
    }
    if (res.status >= 300 && res.headers?.location) { current = new URL(res.headers.location, current).toString(); continue; }
    break;
  }
  if (!res || res.status >= 300) throw new Error('The picture link redirects too many times.');
  const buffer = Buffer.from(res.data);
  const type = sniff(buffer);
  if (!type) throw new Error('The link doesn’t point to a JPG, PNG, GIF or WEBP picture, or an MP4/MOV video.');
  if (buffer.length > LIMITS[type.kind]) throw new Error(`That ${type.kind} is too large (most ${LIMITS[type.kind] / 1024 / 1024} MB).`);
  return { buffer, ...type, name: path.basename(new URL(current).pathname) || `image.${type.ext}` };
}

// The picture of a post as a file: { buffer, mime, ext, kind, name, assetId? }
async function resolve(db, workspaceId, ref) {
  if (!ref) return null;
  const id = mediaId(ref);
  if (id) {
    const asset = await get(db, workspaceId, id);
    if (!asset) throw new Error('The picture for this post was deleted from the media library. Choose another, then press Retry.');
    let buffer;
    try { buffer = fs.readFileSync(filePath(asset)); } catch {
      throw new Error('The picture file for this post is missing from this PC. Choose another, then press Retry.');
    }
    return { buffer, mime: asset.mime, ext: asset.stored_name.split('.').pop(), kind: asset.kind, name: asset.original_name || asset.stored_name, assetId: asset.id };
  }
  return download(ref);
}

module.exports = { MEDIA_DIR, MEDIA_PREFIX, LIMITS, sniff, imageSize, isPrivateIp, assertPublicUrl, isMediaRef, mediaId, filePath, save, get, remove, download, resolve };
