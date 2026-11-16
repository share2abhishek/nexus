// The help chats' knowledge base, edited by the Super Admin. Starts with the built-in
// answers (services/helpKnowledge.js) the first time it is read.
exports.up = async function (knex) {
  if (await knex.schema.hasTable('help_knowledge')) return;
  await knex.schema.createTable('help_knowledge', (t) => {
    t.increments('id').primary();
    t.string('audience').notNullable();     // 'public' (landing page) | 'app' (inside the app) | 'both'
    t.string('question').notNullable();     // a typical question
    t.text('keywords');                     // comma-separated words that should match it
    t.text('answer').notNullable();
    t.string('go');                         // optional button: settings:<tab> | page:<name> | link:<url> | action:bulk
    t.integer('enabled').notNullable().defaultTo(1);
    t.string('builtin_id');                 // set for the built-in answers, so they can be restored
    t.bigInteger('updated_at').notNullable();
    t.index(['audience', 'enabled']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('help_knowledge');
};
