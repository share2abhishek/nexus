// YouTube and TikTok can't be posted to yet, so their cards are gone from Settings.
// Remove their saved logins (nothing in the app could remove them any more) and
// take them off posts that haven't gone out. A scheduled post left with no
// platform is marked failed with an explanation instead of silently doing nothing.
const RETIRED = ['youtube', 'tiktok'];
const NOTE = 'YouTube and TikTok posting is not available yet, so they were removed from this post. Choose another platform, then schedule it again.';

const parse = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]') || []; } catch { return []; } };

exports.up = async function (knex) {
  let retiredIds = [];
  if (await knex.schema.hasTable('social_accounts')) {
    retiredIds = await knex('social_accounts').whereIn('platform', RETIRED).pluck('id');
    if (retiredIds.length) await knex('social_accounts').whereIn('id', retiredIds).del();
  }

  if (await knex.schema.hasTable('content_items')) {
    const rows = await knex('content_items').whereNotIn('status', ['published', 'publishing'])
      .select('id', 'status', 'platforms', 'social_account_ids');
    for (const r of rows) {
      const platforms = parse(r.platforms);
      const accounts = parse(r.social_account_ids);
      const keptPlatforms = platforms.filter(p => !RETIRED.includes(p));
      const keptAccounts = accounts.filter(id => !retiredIds.includes(id));
      if (keptPlatforms.length === platforms.length && keptAccounts.length === accounts.length) continue;
      const update = { platforms: JSON.stringify(keptPlatforms), social_account_ids: JSON.stringify(keptAccounts) };
      if (!keptPlatforms.length && r.status === 'scheduled') Object.assign(update, { status: 'failed', error_message: NOTE });
      await knex('content_items').where({ id: r.id }).update(update);
    }
  }

  if (await knex.schema.hasTable('scheduled_posts')) {
    const rows = await knex('scheduled_posts').where({ status: 'pending' }).select('id', 'platforms');
    for (const r of rows) {
      const platforms = parse(r.platforms);
      const kept = platforms.filter(p => !RETIRED.includes(p));
      if (kept.length === platforms.length) continue;
      const update = { platforms: JSON.stringify(kept) };
      if (!kept.length) Object.assign(update, { status: 'failed', result: JSON.stringify([{ platform: 'all', success: false, error: NOTE }]) });
      await knex('scheduled_posts').where({ id: r.id }).update(update);
    }
  }
};

// Removed logins can't be restored; nothing to undo
exports.down = async function () {};
