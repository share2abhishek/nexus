// Photo size in the media library, so Create Post can warn before Instagram
// refuses a photo that is too tall or too wide.
// fb_hosted_photos: hidden Facebook Page photos used to give Instagram/Google a
// public link; each is removed after its time (also after a crash).
exports.up = async function (knex) {
  if ((await knex.schema.hasTable('media_assets')) && !(await knex.schema.hasColumn('media_assets', 'width'))) {
    await knex.schema.alterTable('media_assets', (t) => {
      t.integer('width');
      t.integer('height');
    });
  }
  if (!(await knex.schema.hasTable('fb_hosted_photos'))) {
    await knex.schema.createTable('fb_hosted_photos', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').notNullable();
      t.string('photo_id').notNullable();
      t.bigInteger('delete_after').notNullable();
      t.integer('attempts').defaultTo(0);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('fb_hosted_photos');
  if (await knex.schema.hasColumn('media_assets', 'width')) {
    await knex.schema.alterTable('media_assets', (t) => { t.dropColumn('width'); t.dropColumn('height'); });
  }
};
