// Signatures (saved endings for posts), post sets (saved platform choices) and
// RSS feeds (new articles become posts), per workspace.
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('post_signatures'))) {
    await knex.schema.createTable('post_signatures', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.string('name', 80).notNullable();
      t.text('text').notNullable();
      t.boolean('is_default').notNullable().defaultTo(false);
      t.integer('created_at').notNullable();
    });
  }
  if (!(await knex.schema.hasTable('post_sets'))) {
    await knex.schema.createTable('post_sets', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.string('name', 80).notNullable();
      t.text('platforms_json').notNullable();
      t.text('options_json').nullable(); // e.g. { "ig_format": "story" }
      t.integer('created_at').notNullable();
    });
  }
  if (!(await knex.schema.hasTable('rss_feeds'))) {
    await knex.schema.createTable('rss_feeds', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.text('url').notNullable();
      t.string('name', 200).nullable();
      t.text('platforms_json').notNullable();
      t.string('mode', 20).notNullable().defaultTo('draft'); // 'draft' | 'schedule'
      t.boolean('add_signature').notNullable().defaultTo(true);
      t.boolean('enabled').notNullable().defaultTo(true);
      t.integer('last_checked_at').nullable();
      t.text('last_error').nullable();
      t.integer('posts_created').notNullable().defaultTo(0);
      t.integer('created_by').nullable();
      t.integer('created_at').notNullable();
    });
  }
  if (!(await knex.schema.hasTable('rss_seen'))) {
    await knex.schema.createTable('rss_seen', (t) => {
      t.increments('id').primary();
      t.integer('feed_id').unsigned().notNullable().references('id').inTable('rss_feeds').onDelete('CASCADE');
      t.string('guid', 500).notNullable();
      t.integer('created_at').notNullable();
      t.unique(['feed_id', 'guid']);
    });
  }
};

exports.down = async function (knex) {
  for (const t of ['rss_seen', 'rss_feeds', 'post_sets', 'post_signatures']) await knex.schema.dropTableIfExists(t);
};
