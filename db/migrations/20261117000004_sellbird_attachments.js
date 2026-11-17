// Files attached to every outreach email of a campaign (for example a brochure PDF).
// Stored in the database (not on disk) so they follow backups and stay inside their business.
//   send_with: 'first' = only the first email of each person, 'all' = every email of the sequence

exports.up = async function (knex) {
  if (await knex.schema.hasTable('sellbird_attachments')) return;
  await knex.schema.createTable('sellbird_attachments', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.integer('campaign_id').unsigned().notNullable().references('id').inTable('sellbird_campaigns').onDelete('CASCADE');
    t.string('filename', 150).notNullable();
    t.string('content_type', 120).notNullable();
    t.integer('size').notNullable();
    t.binary('data').notNullable();
    t.string('send_with', 10).notNullable().defaultTo('first');
    t.bigInteger('created_at').notNullable();
    t.index(['workspace_id', 'campaign_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('sellbird_attachments');
};
