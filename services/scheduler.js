const cron = require('node-cron');
const { postToPlatform } = require('./social');
const knex = require('./knex');
const contentRepoFactory = require('../repos/contentRepo');
const postsRepoFactory = require('../repos/postsRepo');
const { isPublishable, notAvailableMessage } = require('./platforms/available');
const { ensureFresh } = require('./tokenRefresher');
const socialAccountsRepo = require('../repos/socialAccountsRepo');

const contentRepo = contentRepoFactory(knex);

let isRunning = false;

// A post more than this late (app closed, PC asleep, licence paused) is not sent
// automatically: "Happy Diwali" a week late does more harm than good. It is marked
// failed with an explanation and the user can Retry it.
const MISSED_AFTER = 6 * 3600;
const missedNote = (at) => `Missed: it was due ${new Date(at * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} but Social-Nexus wasn't running or wasn't licensed then. Use Retry to post it now.`;

// Why a platform can't be posted to: never connected, or saved without a usable login
function notConnectedError(platform, account) {
  return account
    ? `${platform} needs signing in again. Click Connect in Settings → Social Platforms, then press Retry.`
    : `${platform} isn't connected. Connect it in Settings → Social Platforms, then press Retry.`;
}

// Publishes one content item (already claimed: status "publishing") to its
// platforms, then marks it published (and adds it to Post History) or failed.
// Used by the scheduler and by "Publish now" on Create Post.
async function publishItem(db, repo, item) {
  console.log(`[Publish] Content #${item.id} to: ${(item.platforms || []).join(', ')}`);
  const results = [];

  // Accounts chosen on the calendar, plus — for any platform without one — the
  // workspace's connected account for that platform (posts scheduled from
  // Compose name platforms only). Always scoped to the item's own workspace.
  const targets = [];
  let missingAccounts = 0;
  // Copies handed to the cloud (PC-off safety net): take them back; any the cloud
  // already posted are not posted again
  const cloudHandled = await require('./cloudPosting').takeOver(db, item).catch(() => ({}));
  for (const accountId of item.social_account_ids || []) {
    const account = await db('social_accounts').where({ id: accountId, workspace_id: item.workspace_id }).first();
    // No login token: leave it to the platform lookup below, which explains it
    if (account?.access_token && !account.auth_error && isPublishable(account.platform) && !cloudHandled[account.platform]) targets.push(account);
    else if (!account) missingAccounts++; // reconnected since? the platform lookup below finds the new one
  }
  for (const r of Object.values(cloudHandled)) results.push(r);
  for (const platform of item.platforms || []) {
    if (cloudHandled[platform]) continue;
    if (!isPublishable(platform)) { results.push({ platform, success: false, error: notAvailableMessage(platform) }); continue; }
    if (targets.some(a => a.platform === platform)) continue;
    const account = await socialAccountsRepo(db).getByPlatform(item.workspace_id, platform);
    if (account?.access_token && !account.auth_error) targets.push(account);
    else results.push({ platform, success: false, error: notConnectedError(platform, account) });
  }

  if (!targets.length && !results.length && missingAccounts) {
    results.push({ success: false, error: 'The chosen account was disconnected. Reconnect it in Settings → Social Platforms, then press Retry.' });
  }

  for (const account of targets) {
    try {
      await ensureFresh(db, account); // renews a login that is about to run out
      const tokenData = {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        page_token: account.page_token,
        page_id: account.page_id,
        ig_account_id: account.ig_account_id,
        board_id: account.board_id,
        external_id: account.external_id,
        workspace_id: account.workspace_id,
      };
      const opts = typeof item.options === 'string' ? JSON.parse(item.options || '{}') : (item.options || {});
      const result = await postToPlatform(account.platform, tokenData, item.body, item.image_url, opts);
      results.push({ platform: account.platform, ...result });
    } catch (err) {
      console.error(`[Scheduler] Content #${item.id} failed on ${account.platform}:`, err.message);
      results.push({ platform: account.platform, success: false, error: err.message });
    }
  }

  const anySucceeded = results.some(r => r.success);
  if (anySucceeded) {
    await repo.markPublished(item.id);
    // Also in Post History, like "Publish now"
    try {
      await postsRepoFactory(db).save(item.workspace_id, item.submitted_by, {
        content: item.body, platforms: item.platforms, image_url: item.image_url, results, status: 'published',
      });
    } catch (err) { console.warn('[Scheduler] Could not add to history:', err.message); }
  } else {
    const errorMessage = results.map(r => r.error).filter(Boolean).join('; ') || 'All platforms failed';
    await repo.markFailed(item.id, errorMessage);
  }

  return { results, published: results.some(r => r.success) };
}

async function processDueContent(db, repo) {
  const now = Math.floor(Date.now() / 1000);
  const dueItems = await repo.getDueForPublish(now);

  for (const item of dueItems) {
    if (repo.claimForPublish && !(await repo.claimForPublish(item.id))) continue; // another run has it
    if (item.scheduled_at && item.scheduled_at < now - MISSED_AFTER) {
      await repo.markFailed(item.id, missedNote(item.scheduled_at));
      continue;
    }
    await publishItem(db, repo, item);
  }
}

// Legacy scheduled_posts rows (from /api/post/schedule). Each row is published only
// through the social accounts of its own workspace; rows without a workspace are skipped.
async function processDueScheduled(db) {
  if (!(await db.schema.hasTable('scheduled_posts'))) return;
  const now = Math.floor(Date.now() / 1000);
  const due = await db('scheduled_posts')
    .where({ status: 'pending' })
    .whereNotNull('workspace_id')
    .where('scheduled_at', '<=', now);
  const postsRepo = postsRepoFactory(db);

  for (const post of due) {
    // Claim it first (pending -> publishing) so it can never be posted twice
    const claimed = await db('scheduled_posts').where({ id: post.id, status: 'pending' }).update({ status: 'publishing' });
    if (!claimed) continue;
    if (post.scheduled_at < now - MISSED_AFTER) {
      await db('scheduled_posts').where({ id: post.id })
        .update({ status: 'failed', result: JSON.stringify([{ platform: 'all', success: false, error: missedNote(post.scheduled_at) }]) });
      continue;
    }
    const platforms = parseJson(post.platforms) || [];
    console.log(`[Scheduler] Processing post #${post.id} for platforms: ${platforms.join(', ')}`);
    const results = [];

    for (const platform of platforms) {
      try {
        if (!isPublishable(platform)) { results.push({ platform, success: false, error: notAvailableMessage(platform) }); continue; }
        const account = await socialAccountsRepo(db).getByPlatform(post.workspace_id, platform);
        if (!account?.access_token || account.auth_error) {
          results.push({ platform, success: false, error: notConnectedError(platform, account) });
          continue;
        }
        await ensureFresh(db, account);
        const result = await postToPlatform(platform, account, post.content, post.image_url);
        results.push({ platform, ...result });
      } catch (err) {
        console.error(`[Scheduler] Failed on ${platform}:`, err.message);
        results.push({ platform, success: false, error: err.message });
      }
    }

    const allFailed = results.length === 0 || results.every(r => !r.success);
    await db('scheduled_posts').where({ id: post.id })
      .update({ status: allFailed ? 'failed' : 'published', result: JSON.stringify(results) });

    if (!allFailed) {
      await postsRepo.save(post.workspace_id, post.user_id, {
        content: post.content, platforms, image_url: post.image_url, results, status: 'published',
      });
    }
  }
}

function parseJson(v) { if (!v || typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } }

// After a crash/restart, anything still marked "publishing" was interrupted. It may
// or may not have reached the network, so don't post it again automatically —
// mark it failed with an explanation; the user checks the platform and retries.
async function recoverInterrupted(db) {
  const note = 'Interrupted while publishing (the app was closed or restarted). Check whether it appeared on the platform, then use Retry if needed.';
  if (await db.schema.hasTable('scheduled_posts')) {
    const rows = await db('scheduled_posts').where({ status: 'publishing' });
    for (const r of rows) {
      await db('scheduled_posts').where({ id: r.id }).update({ status: 'failed', result: JSON.stringify([{ platform: 'all', success: false, error: note }]) });
    }
  }
  if (await db.schema.hasTable('content_items')) {
    await db('content_items').where({ status: 'publishing' }).update({ status: 'failed', error_message: note });
  }
  // An email campaign interrupted mid-send: mark it failed so it can be checked and sent again
  if (await db.schema.hasTable('email_campaigns')) {
    await db('email_campaigns').where({ status: 'sending' }).update({ status: 'failed' });
  }
}

function start() {
  console.log('[Scheduler] Running — checks every minute');
  recoverInterrupted(knex).catch(err => console.error('[Scheduler] Recovery failed:', err.message));

  cron.schedule('* * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      // Without an active licence nothing is published; due posts wait (they stay
      // "scheduled"/"pending") and go out once the licence is active again.
      if (!require('./license').status().can_publish) return;
      await processDueScheduled(knex);
      await processDueContent(knex, contentRepo);
    } catch (err) {
      console.error('[Scheduler] Unexpected error:', err.message);
    } finally {
      isRunning = false;
    }
  });
}

module.exports = { start, processDueContent, processDueScheduled, recoverInterrupted, publishItem };
