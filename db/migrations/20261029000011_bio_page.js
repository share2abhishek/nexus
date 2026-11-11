// The workspace's link-in-bio page (kept here; published to Radixile's server)
exports.up = async function (knex) {
  if (await knex.schema.hasTable('bio_pages')) return;
  await knex.schema.createTable('bio_pages', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().unique().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('slug');
    t.text('data');
    t.text('url');
    t.bigInteger('published_at');
    t.bigInteger('updated_at');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('bio_pages');
};
