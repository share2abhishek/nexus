// A0 (docs/platform/ROADMAP.md): an organisation's platform status, read by access.check step 4.
// 'active' or 'suspended' (suspended allows only reading, export, billing and account actions).
// This is separate from plan_status, which is about payment. Nothing sets 'suspended' yet: the staff
// console does that in S1. Every existing organisation starts 'active', so nothing changes.
// Rollback: drop the column (no data is lost: every value is 'active').
exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('organizations', 'status'))) {
    await knex.schema.alterTable('organizations', (t) => { t.string('status', 16).notNullable().defaultTo('active'); });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('organizations', 'status')) {
    await knex.schema.alterTable('organizations', (t) => { t.dropColumn('status'); });
  }
};
