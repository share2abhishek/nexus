// Phones paired with a user (phone companion). The key and relay token are
// secrets (stored encrypted).
exports.up = async function (knex) {
  if (await knex.schema.hasTable('companion_pairs')) return;
  await knex.schema.createTable('companion_pairs', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.string('label');
    t.string('relay_id').notNullable();
    t.text('owner_token').notNullable();
    t.text('link_key').notNullable();
    t.text('url').notNullable();
    t.string('last_hash');
    t.bigInteger('last_push');
    t.bigInteger('created_at').notNullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('companion_pairs');
};
