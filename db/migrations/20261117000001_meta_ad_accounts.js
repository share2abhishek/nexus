// Migration: each workspace chooses its own Meta ad accounts for reports and ad sync.
// (They used to be written into the code, which only suited one business.)
// meta_ad_account_ids is a JSON list such as ["act_123","act_456"].

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('meta_lead_configs'))) return;
  if (!(await knex.schema.hasColumn('meta_lead_configs', 'meta_ad_account_ids'))) {
    await knex.schema.alterTable('meta_lead_configs', (t) => {
      t.text('meta_ad_account_ids').nullable();
    });
  }
  // Keep the one business that relied on the old built-in list working exactly as before
  // (matched by its own Facebook Page, so no other business gets these accounts).
  await knex('meta_lead_configs')
    .where({ page_id: '520186977848285' })
    .whereNull('meta_ad_account_ids')
    .update({ meta_ad_account_ids: JSON.stringify(['act_853936970934065', 'act_292683348']) });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('meta_lead_configs'))) return;
  if (await knex.schema.hasColumn('meta_lead_configs', 'meta_ad_account_ids')) {
    await knex.schema.alterTable('meta_lead_configs', (t) => {
      t.dropColumn('meta_ad_account_ids');
    });
  }
};
