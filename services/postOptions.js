// Checks and tidies a post's options (see migration 20261029000005_post_options).
const FORMATS = ['feed', 'reel', 'story'];
const MAX_MEDIA = 10;

// Google Business post types and buttons (Google's names for them)
const GBP_TYPES = ['update', 'offer', 'event'];
const GBP_BUTTONS = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'];
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isWebLink = (s) => { try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; } };

// options.gbp: { type, title, start_date, start_time, end_date, end_time, coupon, terms, redeem_url, button, button_url }
function cleanGbp(g) {
  if (g == null) return null;
  if (typeof g !== 'object' || Array.isArray(g)) throw bad('Google Business options are not valid.');
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const type = GBP_TYPES.includes(g.type) ? g.type : 'update';
  const out = { type };

  if (type === 'offer' || type === 'event') {
    out.title = str(g.title, 58);
    if (!out.title) throw bad(`Give the Google ${type} a title (up to 58 characters).`);
    out.start_date = str(g.start_date, 10);
    out.end_date = str(g.end_date, 10);
    if (!isDate(out.start_date) || !isDate(out.end_date)) throw bad(`Pick the start and end dates of the Google ${type}.`);
    if (out.end_date < out.start_date) throw bad(`The Google ${type} ends before it starts.`);
    if (type === 'event') {
      const st = str(g.start_time, 5); const et = str(g.end_time, 5);
      if (st || et) {
        if (!isTime(st) || !isTime(et)) throw bad('Give both a start and an end time for the event, or leave both empty (all day).');
        if (out.start_date === out.end_date && et <= st) throw bad('The event ends before it starts.');
        out.start_time = st; out.end_time = et;
      }
    }
  }
  if (type === 'offer') {
    const coupon = str(g.coupon, 58); const terms = str(g.terms, 5000); const redeem = str(g.redeem_url, 1000);
    if (redeem && !isWebLink(redeem)) throw bad('The offer’s link must start with https://');
    if (coupon) out.coupon = coupon;
    if (terms) out.terms = terms;
    if (redeem) out.redeem_url = redeem;
  } else if (g.button && g.button !== 'NONE') {
    // Offers have their own link instead of a button
    if (!GBP_BUTTONS.includes(g.button)) throw bad('Pick a button from the list.');
    out.button = g.button;
    if (g.button !== 'CALL') {
      out.button_url = str(g.button_url, 1000);
      if (!isWebLink(out.button_url)) throw bad('The Google button needs a link starting with https://');
    }
  }
  return type === 'update' && !out.button ? null : out;
}

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
  if (o.gbp !== undefined) { const g = cleanGbp(o.gbp); if (g) out.gbp = g; }
  return Object.keys(out).length ? out : null;
}

const parseOptions = (v) => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v) || {}; } catch { return {}; } };

module.exports = { cleanOptions, cleanGbp, parseOptions, FORMATS, MAX_MEDIA, GBP_TYPES, GBP_BUTTONS };
