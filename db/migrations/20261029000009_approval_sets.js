// One approval link can hold many posts (e.g. a whole month): each post's row
// shares the relay link and has its position in the set.
exports.up = async function (knex) {
  if (await knex.schema.hasColumn('approval_links', 'set_index')) return;
  await knex.schema.alterTable('approval_links', (t) => { t.integer('set_index'); t.integer('set_size'); });
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('approval_links', 'set_index')) {
    await knex.schema.alterTable('approval_links', (t) => { t.dropColumn('set_index'); t.dropColumn('set_size'); });
  }
};
