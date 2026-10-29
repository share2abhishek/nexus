// Pinterest Pins: one photo, or a carousel Pin of 2–5 photos.
const axios = require('axios');
const { mediaList } = require('./media');

async function asBase64(m) {
  const file = await m.file();
  if (file.kind !== 'image') throw new Error('Pinterest videos aren’t supported yet. Use a photo.');
  if (!['image/jpeg', 'image/png'].includes(file.mime)) throw new Error('Pinterest accepts JPG or PNG pictures. Use one of those.');
  return { content_type: file.mime, data: file.buffer.toString('base64') };
}

async function postToPinterest(token, boardId, content, imageRef = null, { workspaceId = null, options = {} } = {}) {
  const items = mediaList(imageRef, options, workspaceId);
  if (!items.length) throw new Error('Pinterest needs a picture: every Pin is an image. Add a photo, then press Retry.');
  if (!boardId) throw new Error('No Pinterest board selected. Choose one in Settings → Pinterest, then press Retry.');

  let source;
  let warning = null;
  if (items.length === 1) {
    source = items[0].url
      ? { source_type: 'image_url', url: items[0].url }
      : { source_type: 'image_base64', ...(await asBase64(items[0])) };
  } else {
    const use = items.slice(0, 5);
    if (items.length > 5) warning = 'Pinterest carousels hold 5 photos: only the first 5 were used.';
    if (use.every(m => m.url)) source = { source_type: 'multiple_image_urls', items: use.map(m => ({ url: m.url })) };
    else source = { source_type: 'multiple_image_base64', items: await Promise.all(use.map(asBase64)) };
  }

  const res = await axios.post('https://api.pinterest.com/v5/pins', {
    board_id: boardId,
    title: content.substring(0, 100),
    description: content.substring(0, 800),
    media_source: source,
  }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, maxBodyLength: Infinity });

  return { success: true, id: res.data.id, platform: 'pinterest', ...(warning ? { warning } : {}) };
}

module.exports = { postToPinterest };
