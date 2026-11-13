// CRM activities: notes and follow-up tasks against a lead, forming a timeline.
// A task is an activity with a due date; it's done when done_at is set.
exports.up = async (knex) => {
  if (await knex.schema.hasTable('lead_activities')) return;
  await knex.schema.createTable('lead_activities', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.integer('lead_event_id').unsigned().notNullable();
    t.integer('user_id').nullable();
    t.string('kind', 20).notNullable().defaultTo('note'); // 'note' | 'task'
    t.text('body').nullable();
    t.bigInteger('due_at').nullable();   // tasks only
    t.bigInteger('done_at').nullable();  // tasks: set when completed
    t.bigInteger('created_at').notNullable();
    t.index(['workspace_id', 'lead_event_id']);
    t.index(['workspace_id', 'kind', 'done_at']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('lead_activities');
};
