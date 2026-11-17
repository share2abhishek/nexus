// Contact auto-sync: send each workspace's contacts to a Google Sheet and/or Salesforce.
//   contact_sync_configs : one row per workspace (its own Google login, sheet, Salesforce app)
//   contact_sync_state   : what has been sent for each contact and target, so only new or
//                          changed contacts are sent again and a Salesforce record is updated,
//                          not duplicated.

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('contact_sync_configs'))) {
    await knex.schema.createTable('contact_sync_configs', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().unique().references('id').inTable('workspaces').onDelete('CASCADE');
      // Google Sheets
      t.integer('google_enabled').notNullable().defaultTo(0);
      t.integer('google_auto').notNullable().defaultTo(1);
      t.text('google_refresh_token').nullable();   // stored encrypted (services/secrets.js)
      t.string('google_email', 200).nullable();
      t.string('google_sheet_id', 200).nullable();
      t.text('google_sheet_url').nullable();
      t.string('google_tab', 100).notNullable().defaultTo('Contacts');
      // Salesforce
      t.integer('sf_enabled').notNullable().defaultTo(0);
      t.integer('sf_auto').notNullable().defaultTo(1);
      t.string('sf_domain', 255).nullable();       // https://yourcompany.my.salesforce.com
      t.string('sf_client_id', 255).nullable();
      t.text('sf_client_secret').nullable();       // stored encrypted
      t.string('sf_api_version', 10).notNullable().defaultTo('v60.0');
      t.string('sf_external_id_field', 100).nullable(); // optional, e.g. NEXUS_Lead_Id__c
      t.string('sf_lead_source', 100).notNullable().defaultTo('NEXUS');
      t.string('sf_default_company', 150).notNullable().defaultTo('[Not provided]');
      // Status
      t.bigInteger('last_google_sync_at').nullable();
      t.text('last_google_error').nullable();
      t.bigInteger('last_sf_sync_at').nullable();
      t.text('last_sf_error').nullable();
      t.bigInteger('created_at').notNullable();
      t.bigInteger('updated_at').notNullable();
    });
  }
  if (!(await knex.schema.hasTable('contact_sync_state'))) {
    await knex.schema.createTable('contact_sync_state', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.integer('lead_id').unsigned().notNullable();
      t.string('target', 20).notNullable();           // 'google' | 'salesforce'
      t.string('external_id', 100).nullable();        // Salesforce record id
      t.bigInteger('synced_at').nullable();
      t.bigInteger('synced_updated_at').nullable();   // the contact's updated_at that was sent
      t.text('error').nullable();
      t.integer('attempts').notNullable().defaultTo(0);
      t.unique(['workspace_id', 'lead_id', 'target']);
      t.index(['workspace_id', 'target']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('contact_sync_state');
  await knex.schema.dropTableIfExists('contact_sync_configs');
};
