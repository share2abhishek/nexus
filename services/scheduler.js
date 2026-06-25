const cron = require('node-cron');
const { getDuePosts, updateScheduledStatus, savePost, saveAnalytics, getToken } = require('./database');
const { postToPlatform } = require('./social');
const knex = require('./knex');
const contentRepoFactory = require('../repos/contentRepo');

const contentRepo = contentRepoFactory(knex);

let isRunning = false;

async function processDueContent(db, repo) {
  const now = Math.floor(Date.now() / 1000);
  const dueItems = await repo.getDueForPublish(now);

  for (const item of dueItems) {
    console.log(`[Scheduler] Processing content #${item.id} for platforms: ${item.platforms.join(', ')}`);
    const results = [];

    for (const accountId of item.social_account_ids) {
      const account = await db('social_accounts').where({ id: accountId }).first();
      if (!account) {
        results.push({ accountId, success: false, error: 'Account not found' });
        continue;
      }
      try {
        const tokenData = {
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          page_token: account.page_token,
          page_id: account.page_id,
          ig_account_id: account.ig_account_id,
          board_id: account.board_id,
        };
        const result = await postToPlatform(account.platform, tokenData, item.body, item.image_url);
        results.push({ platform: account.platform, ...result });
      } catch (err) {
        console.error(`[Scheduler] Content #${item.id} failed on ${account.platform}:`, err.message);
        results.push({ platform: account.platform, success: false, error: err.message });
      }
    }

    const anySucceeded = results.some(r => r.success);
    if (anySucceeded) {
      await repo.markPublished(item.id);
    } else {
      const errorMessage = results.map(r => r.error).filter(Boolean).join('; ') || 'All platforms failed';
      await repo.markFailed(item.id, errorMessage);
    }
  }
}

function start() {
  console.log('[Scheduler] Running — checks every minute');

  cron.schedule('* * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const duePosts = getDuePosts();

      for (const post of duePosts) {
        console.log(`[Scheduler] Processing post #${post.id} for platforms: ${post.platforms.join(', ')}`);

        const results = [];

        for (const platform of post.platforms) {
          try {
            const tokenData = getToken(platform);
            if (!tokenData) {
              results.push({ platform, success: false, error: 'Not connected' });
              continue;
            }

            const result = await postToPlatform(platform, tokenData, post.content, post.image_url);
            results.push(result);

            // Track analytics stub
            saveAnalytics({
              post_id: post.id,
              platform,
              likes: 0, comments: 0, shares: 0,
              impressions: Math.floor(Math.random() * 500) + 50,
              clicks: Math.floor(Math.random() * 30),
            });
          } catch (err) {
            console.error(`[Scheduler] Failed on ${platform}:`, err.message);
            results.push({ platform, success: false, error: err.message });
          }
        }

        const allFailed = results.every(r => !r.success);
        updateScheduledStatus(post.id, allFailed ? 'failed' : 'published', results);

        if (!allFailed) {
          savePost({
            content: post.content,
            platforms: post.platforms,
            image_url: post.image_url,
            results,
            status: 'published',
          });
        }
      }

      await processDueContent(knex, contentRepo);
    } catch (err) {
      console.error('[Scheduler] Unexpected error:', err.message);
    } finally {
      isRunning = false;
    }
  });
}

module.exports = { start, processDueContent };
