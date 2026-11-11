// Server edition: settings that belong to a business and are shared by its team
// (AI keys, email sending). Secrets go in secret_value, which is stored
// encrypted (services/secrets). Unused on the desktop app, which keeps .env.
exports.up = async (knex) => {
  if (await knex.schema.hasTable('business_settings')) return;
  await knex.schema.createTable('business_settings', (t) => {
    t.increments('id').primary();
    t.integer('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('key', 48).notNullable();
    t.text('value');
    t.text('secret_value');
    t.integer('updated_by');
    t.integer('updated_at');
    t.unique(['org_id', 'key']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('business_settings');
};
