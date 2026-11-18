// Website checks: count failures in a row, so a failed check is retried soon (15 minutes, then
// longer) instead of always waiting 6 hours. Reset to 0 by the next successful check.

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('seo_sites'))) return;
  if (!(await knex.schema.hasColumn('seo_sites', 'fail_count'))) {
    await knex.schema.alterTable('seo_sites', (t) => { t.integer('fail_count').notNullable().defaultTo(0); });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('seo_sites'))) return;
  if (await knex.schema.hasColumn('seo_sites', 'fail_count')) {
    await knex.schema.alterTable('seo_sites', (t) => { t.dropColumn('fail_count'); });
  }
};
