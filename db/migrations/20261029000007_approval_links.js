// Client approval links: a post shared by link (or WhatsApp) for a client to
// approve without an account. The key and the relay's owner token are secrets
// (stored encrypted, see services/secrets.js).
exports.up = async function (knex) {
  if (await knex.schema.hasTable('approval_links')) return;
  await knex.schema.createTable('approval_links', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.integer('content_item_id').notNullable().references('id').inTable('content_items').onDelete('CASCADE');
    t.string('relay_id').notNullable();
    t.text('owner_token').notNullable();
    t.text('link_key').notNullable();
    t.text('url').notNullable();
    t.string('status').notNullable().defaultTo('open'); // open | approved | changes | expired | withdrawn
    t.integer('created_by');
    t.string('response_name');
    t.text('response_comment');
    t.bigInteger('responded_at');
    t.bigInteger('created_at').notNullable();
    t.bigInteger('expires_at').notNullable();
    t.index(['workspace_id', 'content_item_id']);
    t.index(['status']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('approval_links');
};
