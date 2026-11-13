// A per-workspace token for the website live-chat widget. It is embedded in the
// customer's public website, so it is kept separate from the Meta verify_token
// (which must stay private). See routes/webhooks.js POST /webhooks/webchat/:token.
const crypto = require('crypto');

exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('meta_lead_configs'))) return;
  if (!(await knex.schema.hasColumn('meta_lead_configs', 'webchat_token'))) {
    await knex.schema.alterTable('meta_lead_configs', (t) => {
      t.string('webchat_token', 255).nullable();
      t.index(['webchat_token']);
    });
  }
  // Give every existing workspace a token so the widget works straight away
  const rows = await knex('meta_lead_configs').whereNull('webchat_token').select('id');
  for (const r of rows) {
    await knex('meta_lead_configs').where({ id: r.id })
      .update({ webchat_token: 'webchat_' + crypto.randomBytes(16).toString('hex') });
  }
};

exports.down = async (knex) => {
  if (await knex.schema.hasColumn('meta_lead_configs', 'webchat_token')) {
    await knex.schema.alterTable('meta_lead_configs', (t) => { t.dropColumn('webchat_token'); });
  }
};
