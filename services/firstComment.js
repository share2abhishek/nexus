// The "first comment" on a Facebook or Instagram post: right away (with a few
// retries, since a just-published post is sometimes not ready for comments), or
// after a delay chosen in Create post (kept in post_comments, sent by the scheduler).
const axios = require('axios');
const { GRAPH } = require('./platforms/apiVersions');

// Minutes people can pick (0 = right away)
const DELAYS = [0, 1, 2, 5, 10, 15, 30, 60];
const MAX_ATTEMPTS = 3;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Meta's answer in words people can act on
function commentError(err, platform) {
  const e = err.response?.data?.error;
  const name = platform === 'instagram' ? 'Instagram' : 'Facebook';
  if (!e && [401, 403].includes(err.response?.status)) {
    return `${name} refused the comment (no permission). Click Connect on the ${name} card in Settings and allow everything it asks.`;
  }
  if (!e) return err.message || 'No answer from Meta.';
  if (e.code === 190) return `The ${name} sign-in has ended. Connect ${name} again in Settings.`;
  if (e.code === 10 || e.code === 200 || /permission/i.test(e.message || '')) {
    return platform === 'instagram'
      ? 'Instagram didn’t allow the comment: the “manage comments” permission is missing. Click Connect on the Instagram card in Settings and allow everything it asks.'
      : 'Facebook didn’t allow the comment: the “manage engagement” permission is missing. Click Connect on the Facebook card in Settings and allow everything it asks.';
  }
  if (e.code === 368 || /spam|blocked/i.test(e.message || '')) return `${name} blocked the comment as possible spam. Try fewer links or hashtags.`;
  return `${name}: ${e.error_user_msg || e.message || 'the comment wasn’t accepted'}`;
}

// Posting too soon after publishing gets "not ready / unsupported" answers: worth retrying
const retryable = (err) => {
  const e = err.response?.data?.error;
  if (!e) return !err.response || err.response.status >= 500; // network or Meta busy
  if ([190, 10, 200, 368].includes(e.code)) return false;
  return true;
};

async function postComment(platform, targetId, message, pageToken) {
  const r = await axios.post(`${GRAPH}/${targetId}/comments`, { message, access_token: pageToken });
  return r.data?.id || null;
}

// Right away, with short retries. Returns { ok, id } or { ok: false, error }.
async function postNow(platform, targetId, message, pageToken, { waits = [3000, 8000] } = {}) {
  let last;
  for (let i = 0; i <= waits.length; i++) {
    try {
      return { ok: true, id: await postComment(platform, targetId, message, pageToken) };
    } catch (err) {
      last = err;
      if (!retryable(err) || i === waits.length) break;
      await wait(waits[i]);
    }
  }
  return { ok: false, error: commentError(last, platform) };
}

function delayMinutes(options) {
  const n = Number(options?.first_comment_delay);
  return DELAYS.includes(n) ? n : 0;
}

async function enqueue(db, { workspaceId, contentItemId = null, socialAccountId, platform, targetId, message, delayMin }) {
  const now = Math.floor(Date.now() / 1000);
  await db('post_comments').insert({
    workspace_id: workspaceId, content_item_id: contentItemId, social_account_id: socialAccountId,
    platform, target_id: String(targetId), message, due_at: now + delayMin * 60,
    status: 'pending', attempts: 0, created_at: now, updated_at: now,
  });
}

// A comment added (or refused) right away, kept for the Calendar
async function record(db, { workspaceId, contentItemId, socialAccountId, platform, message, ok, error }) {
  const now = Math.floor(Date.now() / 1000);
  await db('post_comments').insert({
    workspace_id: workspaceId, content_item_id: contentItemId, social_account_id: socialAccountId,
    platform, target_id: '-', message, due_at: now, status: ok ? 'done' : 'failed', attempts: 1,
    error: ok ? null : (error || null), created_at: now, updated_at: now,
  });
}

// Send delayed comments that are due (called every minute by the scheduler)
async function processDue(db) {
  if (!(await db.schema.hasTable('post_comments'))) return;
  const now = Math.floor(Date.now() / 1000);
  const due = await db('post_comments').where({ status: 'pending' }).where('due_at', '<=', now).limit(20);
  for (const c of due) {
    if (require('./edition').isServer() && !(await require('./entitlements').canPublish(c.workspace_id))) continue;
    const claimed = await db('post_comments').where({ id: c.id, status: 'pending' }).update({ status: 'posting', updated_at: now });
    if (!claimed) continue;
    const account = await db('social_accounts').where({ id: c.social_account_id, workspace_id: c.workspace_id }).first();
    const token = account?.page_token || account?.access_token;
    let error = null; let id = null;
    if (!token) error = `The ${c.platform === 'instagram' ? 'Instagram' : 'Facebook'} account was disconnected.`;
    else {
      try { id = await postComment(c.platform, c.target_id, c.message, token); } catch (err) {
        error = commentError(err, c.platform);
        // Try again in a few minutes, a couple of times
        if (retryable(err) && c.attempts + 1 < MAX_ATTEMPTS) {
          await db('post_comments').where({ id: c.id }).update({ status: 'pending', attempts: c.attempts + 1, due_at: now + 120 * (c.attempts + 1), error, updated_at: now });
          continue;
        }
      }
    }
    await db('post_comments').where({ id: c.id }).update(error
      ? { status: 'failed', attempts: c.attempts + 1, error, updated_at: now }
      : { status: 'done', comment_id: id, error: null, updated_at: now });
  }
}

// Each post's first comments, for the Calendar
async function forItem(db, workspaceId, contentItemId) {
  if (!(await db.schema.hasTable('post_comments'))) return [];
  return db('post_comments').where({ workspace_id: workspaceId, content_item_id: contentItemId })
    .orderBy('id').select('platform', 'status', 'due_at', 'error', 'updated_at');
}

// After a Facebook sign-in: note whether comments are allowed on each account
// (the Instagram permission is only asked when connecting from the Instagram card),
// so Create post can warn before posting instead of failing afterwards.
async function recordCommentPermissions(db, workspaceId, accessToken) {
  let granted;
  try {
    const r = await axios.get(`${GRAPH}/me/permissions`, { params: { access_token: accessToken } });
    granted = new Set((r.data.data || []).filter((p) => p.status === 'granted').map((p) => p.permission));
  } catch { return; } // unknown: leave as it was
  const rows = await db('social_accounts').where({ workspace_id: workspaceId }).whereIn('platform', ['facebook', 'instagram']);
  for (const row of rows) {
    let profile = {};
    try { profile = JSON.parse(row.profile_json || '{}') || {}; } catch {}
    profile.can_comment = granted.has(row.platform === 'instagram' ? 'instagram_manage_comments' : 'pages_manage_engagement');
    await db('social_accounts').where({ id: row.id }).update({ profile_json: JSON.stringify(profile) });
  }
}

module.exports = { record, recordCommentPermissions, DELAYS, postNow, enqueue, processDue, forItem, delayMinutes, commentError };
