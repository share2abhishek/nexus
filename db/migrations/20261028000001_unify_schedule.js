// One schedule for everything: posts scheduled from Compose used to live in
// scheduled_posts and never showed on the Content Calendar. From now on every
// scheduled post is a content_items row. This moves the old pending/failed rows
// across (published history stays in the posts/history tables) and adds the
// per-user "Simple / Agency" screen mode.
exports.up = async function (knex) {
  if (await knex.schema.hasTable('scheduled_posts') && await knex.schema.hasTable('content_items')) {
    const rows = await knex('scheduled_posts').whereIn('status', ['pending', 'failed']).whereNotNull('workspace_id');
    for (const r of rows) {
      let error = null;
      if (r.status === 'failed') {
        try {
          const res = JSON.parse(r.result || '[]');
          error = res.map(x => x.error).filter(Boolean).join('; ') || 'Failed';
        } catch { error = 'Failed'; }
      }
      await knex('content_items').insert({
        workspace_id: r.workspace_id,
        body: r.content,
        platforms: r.platforms || '[]',
        image_url: r.image_url || null,
        social_account_ids: '[]', // accounts are looked up by platform when publishing
        status: r.status === 'pending' ? 'scheduled' : 'failed',
        scheduled_at: r.scheduled_at,
        submitted_by: r.user_id || null,
        error_message: error,
      });
      await knex('scheduled_posts').where({ id: r.id }).update({ status: 'moved' });
    }
  }

  if (await knex.schema.hasTable('user_settings') && !(await knex.schema.hasColumn('user_settings', 'ui_mode'))) {
    await knex.schema.alterTable('user_settings', (t) => { t.string('ui_mode'); }); // 'simple' | 'agency' | null (auto)
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('user_settings') && await knex.schema.hasColumn('user_settings', 'ui_mode')) {
    await knex.schema.alterTable('user_settings', (t) => { t.dropColumn('ui_mode'); });
  }
  // Moved rows stay in content_items; put the originals back in the old queue
  if (await knex.schema.hasTable('scheduled_posts')) {
    await knex('scheduled_posts').where({ status: 'moved' }).update({ status: 'pending' });
  }
};
