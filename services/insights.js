// Real analytics: likes, comments, shares and reach for published posts, fetched
// from the platforms once a day (and when the person presses Refresh). Replaces the
// old made-up sample numbers.
//
//   Facebook   reactions, comments, shares; reach when the Page allows it
//   Instagram  likes, comments, saves, shares, reach/views
//   Pinterest  impressions, saves, clicks (last 90 days)
//   X          likes, replies, reposts, views (when the X plan allows reading)
//   LinkedIn / Google Business: not available for personal posts through their APIs
//
// Only numbers are stored, per post and platform, in the analytics table.
const axios = require('axios');
const { GRAPH } = require('./platforms/apiVersions');
const { authHeader } = require('./platforms/oauth1');

const DAYS_TRACKED = 30;
const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
const n = (v) => Number(v) || 0;

const FETCHERS = {
  async facebook(acc, id) {
    const token = acc.page_token || acc.access_token;
    const r = await axios.get(`${GRAPH}/${id}`, {
      params: { fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares', access_token: token },
    });
    const out = {
      likes: n(r.data.reactions?.summary?.total_count),
      comments: n(r.data.comments?.summary?.total_count),
      shares: n(r.data.shares?.count),
    };
    // Reach: Meta moved Page posts to "views" metrics; older ones are asked for
    // only if the new ones aren't available. Needs read_insights (counts above don't).
    for (const metric of ['post_total_media_view_unique,post_clicks', 'post_impressions_unique,post_clicks']) {
      try {
        const ins = await axios.get(`${GRAPH}/${id}/insights`, { params: { metric, access_token: token } });
        for (const m of ins.data.data || []) {
          const v = n(m.values?.[0]?.value);
          if (m.name === 'post_total_media_view_unique' || m.name === 'post_impressions_unique') out.impressions = v;
          if (m.name === 'post_clicks') out.clicks = v;
        }
        break;
      } catch { /* try the older metric, or go without reach */ }
    }
    return out;
  },

  async instagram(acc, id) {
    const token = acc.page_token || acc.access_token;
    const base = await axios.get(`${GRAPH}/${id}`, { params: { fields: 'like_count,comments_count', access_token: token } });
    const out = { likes: n(base.data.like_count), comments: n(base.data.comments_count) };
    try {
      const ins = await axios.get(`${GRAPH}/${id}/insights`, { params: { metric: 'reach,saved,shares,views', access_token: token } });
      for (const m of ins.data.data || []) {
        const v = n(m.values?.[0]?.value ?? m.total_value?.value);
        if (m.name === 'reach' || m.name === 'views') out.impressions = Math.max(out.impressions || 0, v);
        if (m.name === 'shares') out.shares = v;
        if (m.name === 'saved') out.saves = v;
      }
    } catch { /* needs instagram_manage_insights */ }
    return out;
  },

  async pinterest(acc, id) {
    const day = (d) => new Date(d).toISOString().slice(0, 10);
    const r = await axios.get(`https://api.pinterest.com/v5/pins/${id}/analytics`, {
      headers: { Authorization: `Bearer ${acc.access_token}` },
      params: { start_date: day(Date.now() - 89 * 86400000), end_date: day(Date.now()), metric_types: 'IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK' },
    });
    const t = r.data?.all?.lifetime_metrics || r.data?.all?.summary_metrics || {};
    return { impressions: n(t.IMPRESSION), saves: n(t.SAVE), clicks: n(t.PIN_CLICK) + n(t.OUTBOUND_CLICK) };
  },

  async twitter(acc, id) {
    const url = `https://api.x.com/2/tweets/${id}?tweet.fields=public_metrics`;
    const r = await axios.get(url, {
      headers: { Authorization: authHeader('GET', url, {
        consumerKey: process.env.TWITTER_API_KEY, consumerSecret: process.env.TWITTER_API_SECRET,
        token: acc.access_token, tokenSecret: acc.refresh_token,
      }) },
    });
    const m = r.data?.data?.public_metrics || {};
    return { likes: n(m.like_count), comments: n(m.reply_count), shares: n(m.retweet_count) + n(m.quote_count), impressions: n(m.impression_count) };
  },
};

FETCHERS.bluesky = (acc, id) => require('./platforms/bluesky').blueskyStats(id);
FETCHERS.threads = (acc, id) => require('./platforms/threads').threadsStats(acc, id);

const SUPPORTED = Object.keys(FETCHERS);

// Posts published in the last DAYS_TRACKED days, with each platform's post id
async function recentPublished(db, workspaceId = null) {
  const since = Math.floor(Date.now() / 1000) - DAYS_TRACKED * 86400;
  const q = db('posts').where('created_at', '>=', since).whereNot('status', 'failed');
  if (workspaceId) q.where({ workspace_id: workspaceId });
  const rows = await q.select('id', 'workspace_id', 'results');
  return rows.flatMap(p => (parse(p.results) || [])
    .filter(r => r?.success && r.id && SUPPORTED.includes(r.platform))
    .map(r => ({ post_id: p.id, workspace_id: p.workspace_id, platform: r.platform, external_id: String(r.id) })));
}

// Fetch and store the latest numbers. Returns { updated, failed }.
async function refresh(db, { workspaceId = null } = {}) {
  const items = await recentPublished(db, workspaceId);
  const accounts = new Map();
  let updated = 0, failed = 0;
  for (const it of items) {
    const key = `${it.workspace_id}:${it.platform}`;
    if (!accounts.has(key)) {
      const acc = await require('../repos/socialAccountsRepo')(db).getByPlatform(it.workspace_id, it.platform);
      accounts.set(key, acc?.access_token && !acc.auth_error ? acc : null);
    }
    const acc = accounts.get(key);
    if (!acc) continue;
    try {
      const m = await FETCHERS[it.platform](acc, it.external_id);
      await db.transaction(async (trx) => {
        await trx('analytics').where({ workspace_id: it.workspace_id, post_id: it.post_id, platform: it.platform }).del();
        await trx('analytics').insert({
          workspace_id: it.workspace_id, post_id: it.post_id, platform: it.platform,
          likes: n(m.likes), comments: n(m.comments), shares: n(m.shares) + n(m.saves),
          impressions: n(m.impressions), clicks: n(m.clicks),
        });
      });
      updated++;
    } catch (err) {
      failed++;
      console.warn(`[Insights] ${it.platform} post ${it.external_id}:`, err.response?.data?.error?.message || err.message);
    }
  }
  return { updated, failed };
}

// Best times to post, from this workspace's own results: average engagement by
// weekday and hour (India time). Needs a few posts before it says anything.
async function bestTimes(db, workspaceId, { minPosts = 5 } = {}) {
  const rows = await db('analytics as a').join('posts as p', 'p.id', 'a.post_id')
    .where('a.workspace_id', workspaceId)
    .select('p.created_at', 'a.platform', 'a.likes', 'a.comments', 'a.shares');
  if (rows.length < minPosts) return { enough: false, posts: rows.length, slots: [] };
  const fmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', hour12: false });
  const buckets = new Map();
  for (const r of rows) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(r.created_at * 1000)).map(p => [p.type, p.value]));
    const key = `${parts.weekday}|${Number(parts.hour) % 24}`;
    const b = buckets.get(key) || { weekday: parts.weekday, hour: Number(parts.hour) % 24, posts: 0, engagement: 0 };
    b.posts++;
    b.engagement += n(r.likes) + n(r.comments) * 2 + n(r.shares) * 3;
    buckets.set(key, b);
  }
  const slots = [...buckets.values()].map(b => ({ ...b, average: Math.round(b.engagement / b.posts) }))
    .sort((a, b) => b.average - a.average).slice(0, 5);
  return { enough: true, posts: rows.length, slots };
}

let timer = null;
function start(db) {
  const run = () => refresh(db).catch(err => console.error('[Insights] Daily refresh failed:', err.message));
  setTimeout(run, 10 * 60 * 1000);
  timer = setInterval(run, 24 * 3600 * 1000);
  timer.unref?.();
}

module.exports = { refresh, bestTimes, recentPublished, start, SUPPORTED, FETCHERS };
