// Password recovery code: Social-Nexus runs on the user's PC without email, so a
// forgotten password is reset with a one-time code shown when the account is
// made (or created later in My Account). Only a hash is stored.
exports.up = async function (knex) {
  if (await knex.schema.hasColumn('users', 'recovery_hash')) return;
  await knex.schema.alterTable('users', (t) => { t.text('recovery_hash'); });
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('users', 'recovery_hash')) {
    await knex.schema.alterTable('users', (t) => { t.dropColumn('recovery_hash'); });
  }
};
