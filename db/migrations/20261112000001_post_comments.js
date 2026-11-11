// First comments sent a few minutes after the post (Create post → "Add it after").
exports.up = async (knex) => {
  if (await knex.schema.hasTable('post_comments')) return;
  await knex.schema.createTable('post_comments', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().index();
    t.integer('content_item_id').nullable().index();
    t.integer('social_account_id').notNullable();
    t.string('platform', 32).notNullable();
    t.string('target_id', 128).notNullable(); // the published post / media
    t.text('message').notNullable();
    t.integer('due_at').notNullable();
    t.string('status', 16).notNullable().defaultTo('pending'); // pending, posting, done, failed
    t.integer('attempts').notNullable().defaultTo(0);
    t.text('error');
    t.string('comment_id', 128);
    t.integer('created_at');
    t.integer('updated_at');
    t.index(['status', 'due_at']);
  });
};

exports.down = (knex) => knex.schema.dropTableIfExists('post_comments');
