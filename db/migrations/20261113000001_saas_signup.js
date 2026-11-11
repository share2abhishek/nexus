// Server edition (SaaS) sign-up: verified emails, password reset by email, and a
// trial end date for each business. Harmless on the desktop app (unused there).
exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('users', 'email_verified_at'))) {
    await knex.schema.alterTable('users', (t) => { t.integer('email_verified_at'); });
  }
  if (!(await knex.schema.hasColumn('organizations', 'trial_ends_at'))) {
    await knex.schema.alterTable('organizations', (t) => { t.integer('trial_ends_at'); });
  }
  if (!(await knex.schema.hasTable('auth_tokens'))) {
    await knex.schema.createTable('auth_tokens', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable().index();
      t.string('kind', 24).notNullable(); // verify_email, reset_password
      t.string('token_hash', 64).notNullable().unique(); // sha256 of the token in the link
      t.integer('expires_at').notNullable();
      t.integer('used_at');
      t.integer('created_at').notNullable();
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('auth_tokens');
  if (await knex.schema.hasColumn('organizations', 'trial_ends_at')) await knex.schema.alterTable('organizations', (t) => { t.dropColumn('trial_ends_at'); });
  if (await knex.schema.hasColumn('users', 'email_verified_at')) await knex.schema.alterTable('users', (t) => { t.dropColumn('email_verified_at'); });
};
