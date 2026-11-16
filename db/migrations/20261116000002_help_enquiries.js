// Questions the help chat could not answer, and "talk to a person" requests, from the
// landing page and from inside the app.
exports.up = async function (knex) {
  if (await knex.schema.hasTable('help_enquiries')) return;
  await knex.schema.createTable('help_enquiries', (t) => {
    t.increments('id').primary();
    t.string('source').notNullable();          // 'landing' | 'app'
    t.string('name');
    t.string('contact');                       // email or phone the person left
    t.text('message').notNullable();
    t.text('transcript');                      // the last few chat lines, for context
    t.string('page');                          // where they were
    t.integer('user_id');
    t.integer('workspace_id');
    t.string('status').notNullable().defaultTo('new'); // new | done
    t.bigInteger('created_at').notNullable();
    t.index(['status', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('help_enquiries');
};
