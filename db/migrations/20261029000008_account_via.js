// How an account was connected: 'own' (the customer's developer app, keys in
// Settings) or 'radixile' (one-click connect through Radixile's approved apps;
// its logins are renewed through Radixile's helper, which holds those app keys).
exports.up = async function (knex) {
  if (await knex.schema.hasColumn('social_accounts', 'via')) return;
  await knex.schema.alterTable('social_accounts', (t) => { t.string('via').defaultTo('own'); });
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('social_accounts', 'via')) {
    await knex.schema.alterTable('social_accounts', (t) => { t.dropColumn('via'); });
  }
};
