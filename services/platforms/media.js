// What every platform adapter needs to handle a post's pictures and videos.
const axios = require('axios');
const FormData = require('form-data');
const { GRAPH } = require('./apiVersions');
const store = require('../mediaStore');

// ── A post's picture or video ─────────────────────────────────────────────────
// Either a web link or a media library item ("media:<id>"). Platforms that take a
// link get .url; the others call .file() for the file itself (loaded once).
function asMedia(ref, workspaceId = null) {
  if (!ref) return null;
  if (typeof ref === 'object') return ref;
  const local = store.isMediaRef(ref);
  let loaded = null;
  return {
    ref,
    url: local ? null : ref,
    // A link ending in .mp4/.mov is a video; library files are checked when loaded
    linkIsVideo: !local && /\.(mp4|mov)(\?|$)/i.test(ref),
    async file() {
      if (!loaded) loaded = local ? store.resolve(require('../knex'), workspaceId, ref) : store.download(ref);
      return loaded;
    },
  };
}

// All pictures/videos of a post, in order: options.media (a carousel) or the one picture
function mediaList(imageRef, opts = {}, workspaceId = null) {
  const refs = Array.isArray(opts.media) && opts.media.length ? opts.media : (imageRef ? [imageRef] : []);
  return refs.map(r => asMedia(r, workspaceId)).filter(Boolean);
}

async function kindOf(m) {
  if (m.url) return m.linkIsVideo ? 'video' : 'image';
  return (await m.file()).kind;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Hidden Facebook photos (a public link for Instagram / Google) ─────────────
// Library files for Instagram and Google Business, which only accept a public
// link: add the picture to the Facebook Page as a hidden (unpublished) photo, use
// its address, and remove it again. Every hidden photo is written down first
// (fb_hosted_photos), so one left behind by a crash is still removed later by
// cleanupHostedPhotos(). keepFor: how long it must stay (Google fetches later).
async function hostOnFacebook(pageToken, pageId, file, { workspaceId = null, keepFor = 3600 } = {}) {
  if (file.kind !== 'image') throw new Error('Only photos can be shared this way (videos are uploaded directly).');
  let page = pageId;
  if (!page) page = (await axios.get(`${GRAPH}/me`, { params: { fields: 'id', access_token: pageToken } })).data.id;
  const form = new FormData();
  form.append('published', 'false');
  form.append('access_token', pageToken);
  form.append('source', file.buffer, { filename: `photo.${file.ext}`, contentType: file.mime });
  const up = await axios.post(`${GRAPH}/${page}/photos`, form, { headers: form.getHeaders(), maxBodyLength: Infinity });
  const photoId = up.data.id;
  const remove = () => axios.delete(`${GRAPH}/${photoId}`, { params: { access_token: pageToken } });
  const noteId = await noteHostedPhoto(workspaceId, photoId, keepFor);
  try {
    const info = await axios.get(`${GRAPH}/${photoId}`, { params: { fields: 'images', access_token: pageToken } });
    const url = info.data.images?.[0]?.source;
    if (!url) throw new Error('Facebook did not return an address for the picture.');
    return {
      url,
      // Remove now (Instagram has copied it), unless it must stay for a while
      cleanup: async () => {
        if (keepFor > 3600) return;
        try { await remove(); await forgetHostedPhoto(noteId); } catch {}
      },
    };
  } catch (err) {
    try { await remove(); await forgetHostedPhoto(noteId); } catch {}
    throw err;
  }
}

async function noteHostedPhoto(workspaceId, photoId, keepFor) {
  if (!workspaceId) return null;
  try {
    const db = require('../knex');
    const [id] = await db('fb_hosted_photos').insert({ workspace_id: workspaceId, photo_id: String(photoId), delete_after: Math.floor(Date.now() / 1000) + keepFor }).returning('id');
    return id?.id ?? id;
  } catch { return null; }
}
async function forgetHostedPhoto(noteId) {
  if (!noteId) return;
  try { await require('../knex')('fb_hosted_photos').where({ id: noteId }).del(); } catch {}
}

// Removes hidden photos whose time is up (run every hour)
async function cleanupHostedPhotos(db) {
  if (!(await db.schema.hasTable('fb_hosted_photos'))) return 0;
  const due = await db('fb_hosted_photos').where('delete_after', '<=', Math.floor(Date.now() / 1000)).limit(100);
  let removed = 0;
  for (const row of due) {
    const fb = await db('social_accounts').where({ workspace_id: row.workspace_id, platform: 'facebook' }).whereNotNull('page_token').first();
    try {
      if (fb) await axios.delete(`${GRAPH}/${row.photo_id}`, { params: { access_token: fb.page_token } });
      await db('fb_hosted_photos').where({ id: row.id }).del();
      removed++;
    } catch (err) {
      const gone = err.response?.status === 400 || err.response?.status === 404; // already removed
      if (gone || row.attempts >= 5) await db('fb_hosted_photos').where({ id: row.id }).del();
      else await db('fb_hosted_photos').where({ id: row.id }).update({ attempts: row.attempts + 1 });
    }
  }
  return removed;
}

// The workspace's Facebook Page login, for hosting a library picture
async function workspaceFacebookPage(workspaceId) {
  const db = require('../knex');
  const fb = await db('social_accounts').where({ workspace_id: workspaceId, platform: 'facebook' })
    .whereNotNull('page_token').first();
  return fb ? { pageToken: fb.page_token, pageId: fb.page_id } : null;
}

module.exports = { asMedia, mediaList, kindOf, sleep, hostOnFacebook, cleanupHostedPhotos, workspaceFacebookPage };
