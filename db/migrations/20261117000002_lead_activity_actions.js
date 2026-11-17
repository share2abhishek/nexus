// CRM actions on a lead: besides notes and tasks, log calls, WhatsApp, email, meetings and
// demos, with WHO did it (the logged-in user, or a chosen team member; for a task, who it
// is assigned to) and WHEN it happened.
//   actor_user_id / actor_name : who took the action (name kept so it survives changes)
//   acted_at                   : when the action happened (can differ from when it was logged)
//   updated_at                 : set when an entry is edited

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('lead_activities'))) return;
  const add = async (name, fn) => {
    if (!(await knex.schema.hasColumn('lead_activities', name))) await knex.schema.alterTable('lead_activities', fn);
  };
  await add('actor_user_id', (t) => t.integer('actor_user_id').nullable());
  await add('actor_name', (t) => t.string('actor_name', 120).nullable());
  await add('acted_at', (t) => t.bigInteger('acted_at').nullable());
  await add('updated_at', (t) => t.bigInteger('updated_at').nullable());
};

exports.down = async (knex) => {
  if (!(await knex.schema.hasTable('lead_activities'))) return;
  for (const c of ['actor_user_id', 'actor_name', 'acted_at', 'updated_at']) {
    if (await knex.schema.hasColumn('lead_activities', c)) await knex.schema.alterTable('lead_activities', (t) => t.dropColumn(c));
  }
};
