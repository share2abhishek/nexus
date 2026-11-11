// Repeating schedules: posts created together (every day/week/month) share a
// series_id; series_index is the position (1 = first) and series_total the count.
exports.up = async function (knex) {
  const has = (c) => knex.schema.hasColumn('content_items', c);
  if (!(await has('series_id'))) {
    await knex.schema.alterTable('content_items', (t) => {
      t.string('series_id');
      t.integer('series_index');
      t.integer('series_total');
      t.string('series_every'); // daily | weekly | monthly
      t.index(['workspace_id', 'series_id']);
    });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('content_items', 'series_id')) {
    await knex.schema.alterTable('content_items', (t) => {
      t.dropIndex(['workspace_id', 'series_id']);
      t.dropColumn('series_id');
      t.dropColumn('series_index');
      t.dropColumn('series_total');
      t.dropColumn('series_every');
    });
  }
};
