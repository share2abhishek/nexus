// Checks and tidies a post's options (see migration 20261029000005_post_options).
const FORMATS = ['feed', 'reel', 'story'];
const MAX_MEDIA = 10;

function cleanOptions(input) {
  if (input == null) return null;
  const o = typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch { return {}; } })() : input;
  if (typeof o !== 'object' || Array.isArray(o)) throw Object.assign(new Error('Post options are not valid.'), { status: 400 });
  const out = {};
  if (o.media !== undefined) {
    if (!Array.isArray(o.media)) throw Object.assign(new Error('media must be a list.'), { status: 400 });
    const media = o.media.filter(r => typeof r === 'string' && (/^media:\d+$/.test(r) || /^https?:\/\//i.test(r))).slice(0, MAX_MEDIA + 1);
    if (media.length > MAX_MEDIA) throw Object.assign(new Error(`A post can have at most ${MAX_MEDIA} photos or videos.`), { status: 400 });
    if (media.length) out.media = media;
  }
  if (o.ig_format !== undefined && o.ig_format !== null && o.ig_format !== '') {
    if (!FORMATS.includes(o.ig_format)) throw Object.assign(new Error('Instagram format must be feed, reel or story.'), { status: 400 });
    if (o.ig_format !== 'feed') out.ig_format = o.ig_format;
  }
  if (o.cloud === true) out.cloud = true; // post from the cloud if this PC is off
  // Minutes to wait before adding the first comment (0 = right away)
  if (o.first_comment_delay !== undefined && o.first_comment_delay !== null && o.first_comment_delay !== '' && Number(o.first_comment_delay) !== 0) {
    const d = Number(o.first_comment_delay);
    if (![1, 2, 5, 10, 15, 30, 60].includes(d)) throw Object.assign(new Error('The first comment can wait 1, 2, 5, 10, 15, 30 or 60 minutes.'), { status: 400 });
    out.first_comment_delay = d;
  }
  if (typeof o.first_comment === 'string' && o.first_comment.trim()) {
    out.first_comment = o.first_comment.trim().slice(0, 2200);
  }
  if (!out.first_comment) delete out.first_comment_delay; // a delay means nothing without a comment
  return Object.keys(out).length ? out : null;
}

const parseOptions = (v) => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v) || {}; } catch { return {}; } };

module.exports = { cleanOptions, parseOptions, FORMATS, MAX_MEDIA };
