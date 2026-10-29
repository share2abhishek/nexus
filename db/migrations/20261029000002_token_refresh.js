// Login renewal: when the renewal login itself runs out (Pinterest, LinkedIn), why
// a login stopped working (shown as "Sign in again" with the reason), and when it
// was last checked.
const COLS = ['refresh_expires_at', 'auth_error', 'checked_at'];

exports.up = async function (knex) {
  const missing = [];
  for (const c of COLS) if (!(await knex.schema.hasColumn('social_accounts', c))) missing.push(c);
  if (!missing.length) return;
  await knex.schema.alterTable('social_accounts', (t) => {
    if (missing.includes('refresh_expires_at')) t.bigInteger('refresh_expires_at');
    if (missing.includes('auth_error')) t.text('auth_error');
    if (missing.includes('checked_at')) t.bigInteger('checked_at');
  });
};

exports.down = async function (knex) {
  for (const c of COLS) {
    if (await knex.schema.hasColumn('social_accounts', c)) {
      await knex.schema.alterTable('social_accounts', (t) => t.dropColumn(c));
    }
  }
};
