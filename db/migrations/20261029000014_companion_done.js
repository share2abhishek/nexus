// What the PC did with each action sent from the phone (shown on the phone, so
// the person knows a reply or approval went through — or why not). Kept 1 day.
exports.up = async function (knex) {
  if (await knex.schema.hasTable('companion_done')) return;
  await knex.schema.createTable('companion_done', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.string('action_key').notNullable();
    t.integer('ok').notNullable();
    t.string('note');
    t.bigInteger('at').notNullable();
    t.index(['user_id', 'at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('companion_done');
};
