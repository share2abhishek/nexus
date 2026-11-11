// Broadcasts run in the background now: keep who was skipped, a short list of
// failures to show, the template's language, who started it and when it finished.
const COLS = {
  skipped_count: (t) => t.integer('skipped_count').defaultTo(0),
  results_json: (t) => t.text('results_json').nullable(),
  template_language: (t) => t.string('template_language', 20).nullable(),
  created_by: (t) => t.integer('created_by').nullable(),
  finished_at: (t) => t.integer('finished_at').nullable(),
};

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('whatsapp_broadcasts'))) return;
  for (const [name, add] of Object.entries(COLS)) {
    if (!(await knex.schema.hasColumn('whatsapp_broadcasts', name))) {
      await knex.schema.alterTable('whatsapp_broadcasts', (t) => add(t));
    }
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('whatsapp_broadcasts'))) return;
  for (const name of Object.keys(COLS)) {
    if (await knex.schema.hasColumn('whatsapp_broadcasts', name)) {
      await knex.schema.alterTable('whatsapp_broadcasts', (t) => t.dropColumn(name));
    }
  }
};
