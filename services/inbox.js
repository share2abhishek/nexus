// Inbox: new comments on posts published from Social-Nexus, from Facebook and
// Instagram (and replies on Threads), checked every 10 minutes. Answer them from
// the app; the reply is posted under the comment.
//
// Private messages (Messenger / Instagram DMs) need Meta's approval of Radixile's
// app (pages_messaging, instagram_manage_messages) and aren't included yet.
const axios = require('axios');
const { GRAPH } = require('./platforms/apiVersions');

const DAYS = 30;
const now = () => Math.floor(Date.now() / 1000);
const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
const epoch = (iso) => Math.floor(new Date(iso).getTime() / 1000) || now();

const FETCH = {
  async facebook(acc, postRef) {
    const token = acc.page_token || acc.access_token;
    const r = await axios.get(`${GRAPH}/${postRef}/comments`, {
      params: { fields: 'id,from{id,name},message,created_time', filter: 'stream', order: 'reverse_chronological', limit: 50, access_token: token },
    });
    return (r.data.data || [])
      .filter(c => !(acc.page_id && String(c.from?.id) === String(acc.page_id))) // not the Page's own replies
      .map(c => ({ external_id: c.id, author_name: c.from?.name || 'Someone', author_id: c.from?.id || null, text: c.message || '', created_at: epoch(c.created_time) }));
  },
  async instagram(acc, postRef) {
    const token = acc.page_token || acc.access_token;
    const r = await axios.get(`${GRAPH}/${postRef}/comments`, {
      params: { fields: 'id,text,username,timestamp,from{id,username}', limit: 50, access_token: token },
    });
    return (r.data.data || [])
      .filter(c => !(acc.ig_account_id && String(c.from?.id) === String(acc.ig_account_id)))
      .map(c => ({ external_id: c.id, author_name: c.username ? `@${c.username}` : 'Someone', author_id: c.from?.id || null, text: c.text || '', created_at: epoch(c.timestamp) }));
  },
  async threads(acc, postRef) {
    const r = await axios.get(`https://graph.threads.net/v1.0/${postRef}/replies`, {
      params: { fields: 'id,text,username,timestamp', access_token: acc.access_token },
    });
    return (r.data.data || [])
      .filter(c => c.username !== acc.profile?.handle)
      .map(c => ({ external_id: c.id, author_name: c.username ? `@${c.username}` : 'Someone', author_id: null, text: c.text || '', created_at: epoch(c.timestamp) }));
  },
};

const REPLY = {
  async facebook(acc, item, message) {
    await axios.post(`${GRAPH}/${item.external_id}/comments`, { message, access_token: acc.page_token || acc.access_token });
  },
  async instagram(acc, item, message) {
    await axios.post(`${GRAPH}/${item.external_id}/replies`, { message, access_token: acc.page_token || acc.access_token });
  },
  async threads(acc, item, message) {
    const c = await axios.post(`https://graph.threads.net/v1.0/${acc.external_id}/threads`, { media_type: 'TEXT', text: message, reply_to_id: item.external_id, access_token: acc.access_token });
    await axios.post(`https://graph.threads.net/v1.0/${acc.external_id}/threads_publish`, { creation_id: c.data.id, access_token: acc.access_token });
  },
};

async function accountFor(db, workspaceId, platform) {
  const acc = await require('../repos/socialAccountsRepo')(db).getByPlatform(workspaceId, platform);
  return acc?.access_token && !acc.auth_error ? acc : null;
}

// Fetch new comments for recently published posts. Returns how many are new.
async function refresh(db, { workspaceId = null } = {}) {
  if (!(await db.schema.hasTable('inbox_items'))) return 0;
  const since = now() - DAYS * 86400;
  const q = db('posts').where('created_at', '>=', since).whereNot('status', 'failed').select('id', 'workspace_id', 'results');
  if (workspaceId) q.where({ workspace_id: workspaceId });
  const posts = await q;
  const accounts = new Map();
  let added = 0;
  for (const p of posts) {
    for (const r of parse(p.results) || []) {
      if (!r?.success || !r.id || !FETCH[r.platform]) continue;
      const key = `${p.workspace_id}:${r.platform}`;
      if (!accounts.has(key)) accounts.set(key, await accountFor(db, p.workspace_id, r.platform));
      const acc = accounts.get(key);
      if (!acc) continue;
      let comments = [];
      try { comments = await FETCH[r.platform](acc, String(r.id)); } catch (err) {
        console.warn(`[Inbox] ${r.platform}:`, err.response?.data?.error?.message || err.message);
        continue;
      }
      const known = new Set(await db('inbox_items').where({ workspace_id: p.workspace_id, platform: r.platform })
        .whereIn('external_id', comments.map(c => c.external_id)).pluck('external_id'));
      for (const c of comments.filter(c => !known.has(c.external_id))) {
        await db('inbox_items').insert({ workspace_id: p.workspace_id, platform: r.platform, post_ref: String(r.id), post_id: p.id, ...c })
          .onConflict(['workspace_id', 'platform', 'external_id']).ignore();
        added++;
      }
    }
  }
  return added;
}

async function reply(db, workspaceId, userId, itemId, message) {
  const text = String(message || '').trim();
  if (!text) throw Object.assign(new Error('Write a reply first.'), { status: 400 });
  const item = await db('inbox_items').where({ id: itemId, workspace_id: workspaceId }).first();
  if (!item) throw Object.assign(new Error('Not found'), { status: 404 });
  const acc = await accountFor(db, workspaceId, item.platform);
  if (!acc) throw Object.assign(new Error('This account needs connecting again (Settings → Connected accounts).'), { status: 400 });
  try {
    await REPLY[item.platform](acc, item, text.slice(0, 2000));
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    throw Object.assign(new Error(`The reply could not be posted: ${msg}. You may need to connect the account again so it may reply to comments.`), { status: 502 });
  }
  await db('inbox_items').where({ id: item.id }).update({ replied_at: now(), reply_text: text, replied_by: userId, is_read: 1 });
  return { success: true };
}

let timer = null;
function start(db) {
  const run = () => refresh(db).catch(err => console.warn('[Inbox] Check failed:', err.message));
  setTimeout(run, 4 * 60 * 1000);
  timer = setInterval(run, 10 * 60 * 1000);
  timer.unref?.();
}

module.exports = { refresh, reply, start, FETCH, REPLY };
