// CRM pipeline fields for leads: a Salesforce-style stage, deal value, owner and
// expected close date, so leads can be managed on a Kanban board. Additive and
// backward-compatible — the old `status` funnel keeps working.
exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('meta_lead_events'))) return;
  const add = async (col, cb) => { if (!(await knex.schema.hasColumn('meta_lead_events', col))) await knex.schema.alterTable('meta_lead_events', cb); };
  await add('pipeline_stage', (t) => t.string('pipeline_stage', 40).defaultTo('new'));
  await add('deal_value', (t) => t.integer('deal_value').nullable());
  await add('expected_close', (t) => t.bigInteger('expected_close').nullable());
  await add('assigned_agent_name', (t) => t.string('assigned_agent_name', 120).nullable()); // the lead owner

  // Seed the new stage from the existing status funnel
  const map = { new: 'new', contacted: 'contacted', qualified: 'qualified', closed: 'won', junk: 'lost' };
  for (const [from, to] of Object.entries(map)) {
    await knex('meta_lead_events').where({ status: from }).update({ pipeline_stage: to }).catch(() => {});
  }
  await knex('meta_lead_events').whereNull('pipeline_stage').update({ pipeline_stage: 'new' }).catch(() => {});
};

exports.down = async (knex) => {
  for (const col of ['pipeline_stage', 'deal_value', 'expected_close']) {
    if (await knex.schema.hasColumn('meta_lead_events', col)) {
      await knex.schema.alterTable('meta_lead_events', (t) => t.dropColumn(col));
    }
  }
};
