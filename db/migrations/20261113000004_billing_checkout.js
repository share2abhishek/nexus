// Server edition: when a business last started paying online, so the regular
// billing refresh also looks at businesses whose "paid" notice was missed.
exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('organizations', 'billing_checkout_at'))) {
    await knex.schema.alterTable('organizations', (t) => { t.integer('billing_checkout_at'); });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('organizations', 'billing_checkout_at')) {
    await knex.schema.alterTable('organizations', (t) => { t.dropColumn('billing_checkout_at'); });
  }
};
