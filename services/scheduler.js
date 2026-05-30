const cron = require('node-cron');
const { getDuePosts, updateScheduledStatus, savePost, saveAnalytics, getToken } = require('./database');
const { postToPlatform } = require('./social');

let isRunning = false;

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
    } catch (err) {
      console.error('[Scheduler] Unexpected error:', err.message);
    } finally {
      isRunning = false;
    }
  });
}

module.exports = { start };
