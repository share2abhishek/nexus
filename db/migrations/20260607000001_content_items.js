exports.up = async function (knex) {
  const epochDefault = knex.client.config.client === 'pg'
    ? knex.raw('extract(epoch from now())')
    : knex.raw("(strftime('%s','now'))");

  await knex.schema.createTable('content_items', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.text('title');
    t.text('body').notNullable();
    t.text('platforms');
    t.text('image_url');
    t.text('social_account_ids');
    t.string('status').notNullable().defaultTo('draft');
    t.bigInteger('scheduled_at');
    t.bigInteger('published_at');
    t.integer('submitted_by');
    t.integer('reviewed_by');
    t.integer('approved_by');
    t.text('error_message');
    t.bigInteger('created_at').notNullable().defaultTo(epochDefault);
    t.bigInteger('updated_at').notNullable().defaultTo(epochDefault);
    t.index(['workspace_id', 'status']);
    t.index(['workspace_id', 'scheduled_at']);
  });

  await knex.schema.createTable('content_item_comments', (t) => {
    t.increments('id').primary();
    t.integer('content_item_id').notNullable().references('id').inTable('content_items').onDelete('CASCADE');
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.integer('user_id').notNullable();
    t.text('body').notNullable();
    t.bigInteger('created_at').notNullable().defaultTo(epochDefault);
    t.index(['content_item_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('content_item_comments');
  await knex.schema.dropTableIfExists('content_items');
};
