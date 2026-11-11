/**
 * Migration: Add free AI model API keys and Indian language preference to user_settings
 */
exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('user_settings');
  if (!hasTable) return; // created by 20260601000001_core_tables (or legacy services/database.js)

  const cols = await knex('user_settings').columnInfo().catch(() => null);
  if (!cols) return;

  // Add columns only if they don't exist yet (idempotent)
  await knex.schema.alterTable('user_settings', (table) => {
    if (!cols.groq_key)       table.text('groq_key').nullable();
    if (!cols.openrouter_key) table.text('openrouter_key').nullable();
    if (!cols.mistral_key)    table.text('mistral_key').nullable();
    if (!cols.language_pref)  table.string('language_pref', 10).defaultTo('en');
  });
};

exports.down = async function(knex) {
  const hasTable = await knex.schema.hasTable('user_settings');
  if (!hasTable) return;

  const cols = await knex('user_settings').columnInfo();
  const drop = ['groq_key', 'openrouter_key', 'mistral_key', 'language_pref'].filter(c => cols[c]);
  if (!drop.length) return;
  await knex.schema.alterTable('user_settings', (table) => {
    for (const c of drop) table.dropColumn(c);
  });
};
