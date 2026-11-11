// Server edition: each business's plan state (set by billing in phase 4, or by a
// Radixile admin). Unused on the desktop app, which keeps its licence.
exports.up = async (knex) => {
  const cols = [
    ['plan_status', (t) => t.string('plan_status', 16)], // active, past_due, cancelled, suspended
    ['paid_until', (t) => t.integer('paid_until')],      // end of the paid period
  ];
  for (const [name, add] of cols) {
    if (!(await knex.schema.hasColumn('organizations', name))) await knex.schema.alterTable('organizations', add);
  }
};

exports.down = async (knex) => {
  for (const name of ['paid_until', 'plan_status']) {
    if (await knex.schema.hasColumn('organizations', name)) await knex.schema.alterTable('organizations', (t) => t.dropColumn(name));
  }
};
