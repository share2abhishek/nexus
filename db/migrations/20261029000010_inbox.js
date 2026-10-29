// Inbox: comments on posts published from Social-Nexus (Facebook, Instagram),
// fetched every 10 minutes so they can be read and answered in one place.
exports.up = async function (knex) {
  if (await knex.schema.hasTable('inbox_items')) return;
  await knex.schema.createTable('inbox_items', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('platform').notNullable();
    t.string('external_id').notNullable();
    t.string('post_ref');
    t.integer('post_id');
    t.string('author_name');
    t.string('author_id');
    t.text('text');
    t.bigInteger('created_at').notNullable();
    t.integer('is_read').notNullable().defaultTo(0);
    t.bigInteger('replied_at');
    t.text('reply_text');
    t.integer('replied_by');
    t.unique(['workspace_id', 'platform', 'external_id']);
    t.index(['workspace_id', 'is_read', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('inbox_items');
};
