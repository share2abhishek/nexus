// How a workspace's website chat looks: bot name, avatar, short description, colour.
// JSON in meta_lead_configs.webchat_profile; served publicly by
// GET /api/webhooks/webchat/:token/config (see routes/webhooks.js).
exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('meta_lead_configs'))) return;
  if (!(await knex.schema.hasColumn('meta_lead_configs', 'webchat_profile'))) {
    await knex.schema.alterTable('meta_lead_configs', (t) => { t.text('webchat_profile').nullable(); });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('meta_lead_configs', 'webchat_profile')) {
    await knex.schema.alterTable('meta_lead_configs', (t) => { t.dropColumn('webchat_profile'); });
  }
};
