// Media library: photos and videos uploaded (or saved from the AI image tool) for a
// workspace. The files live in <data folder>/media/<workspace>/; this table holds
// what each one is.
exports.up = async function (knex) {
  if (await knex.schema.hasTable('media_assets')) return;
  await knex.schema.createTable('media_assets', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.integer('uploaded_by');
    t.string('original_name');
    t.string('stored_name').notNullable();
    t.string('mime').notNullable();
    t.string('kind').notNullable(); // image | video
    t.integer('size').notNullable();
    t.string('source').defaultTo('upload'); // upload | ai | link
    t.text('public_url'); // a public copy (for Instagram), when one was made
    t.bigInteger('public_url_expires_at');
    t.bigInteger('created_at').notNullable();
    t.index(['workspace_id', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('media_assets');
};
