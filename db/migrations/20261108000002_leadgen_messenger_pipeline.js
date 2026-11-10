// db/migrations/20261108000002_leadgen_messenger_pipeline.js
// Migration for Meta Lead Ads & Click-to-Messenger Automated Pipeline (n8n & Chatwoot Integration)

exports.up = async function (knex) {
  // 1. Configuration for Meta Webhook, n8n, and Chatwoot per workspace
  if (!(await knex.schema.hasTable('meta_lead_configs'))) {
    await knex.schema.createTable('meta_lead_configs', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.string('page_id', 100).nullable();
      t.string('verify_token', 255).notNullable();
      t.string('app_secret', 255).nullable();
      t.text('n8n_webhook_url').nullable();
      t.text('chatwoot_url').nullable();
      t.text('chatwoot_api_token').nullable();
      t.integer('chatwoot_account_id').nullable();
      t.integer('chatwoot_inbox_id').nullable();
      t.boolean('auto_qualify_ai').defaultTo(true);
      t.string('instant_notify_email', 255).nullable();
      t.integer('created_at').notNullable();
      t.integer('updated_at').notNullable();

      t.index(['workspace_id']);
      t.index(['page_id']);
      t.index(['verify_token']);
    });
  }

  // 2. Ingested Lead Ads events (Instant Forms)
  if (!(await knex.schema.hasTable('meta_lead_events'))) {
    await knex.schema.createTable('meta_lead_events', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.string('leadgen_id', 100).nullable();
      t.string('form_id', 100).nullable();
      t.string('page_id', 100).nullable();
      t.string('ad_id', 100).nullable();
      t.string('adgroup_id', 100).nullable();
      t.string('campaign_id', 100).nullable();
      t.string('full_name', 255).nullable();
      t.string('email', 255).nullable();
      t.string('phone_number', 100).nullable();
      t.text('raw_answers_json').nullable(); // JSON object of all custom form questions/answers
      t.integer('lead_score').defaultTo(50); // 0-100 calculated by AI
      t.text('intent_summary').nullable(); // AI qualification summary
      t.text('suggested_reply').nullable(); // AI drafted response for rep
      t.boolean('forwarded_to_n8n').defaultTo(false);
      t.boolean('forwarded_to_chatwoot').defaultTo(false);
      t.string('status', 50).defaultTo('new'); // new, contacted, qualified, closed, junk
      t.integer('created_at').notNullable();
      t.integer('updated_at').notNullable();

      t.index(['workspace_id', 'status']);
      t.index(['workspace_id', 'created_at']);
      t.index(['leadgen_id']);
      t.index(['page_id']);
    });
  }

  // 3. Ingested Click-to-Messenger events (Direct messages)
  if (!(await knex.schema.hasTable('meta_messenger_events'))) {
    await knex.schema.createTable('meta_messenger_events', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.string('page_id', 100).notNullable();
      t.string('sender_id', 100).notNullable(); // PSID (Page-Scoped ID)
      t.string('message_id', 100).nullable();
      t.text('message_text').nullable();
      t.string('ai_intent', 50).nullable();
      t.text('ai_suggested_reply').nullable();
      t.integer('chatwoot_conversation_id').nullable();
      t.boolean('is_within_24h_window').defaultTo(true);
      t.integer('created_at').notNullable();

      t.index(['workspace_id', 'page_id']);
      t.index(['page_id', 'sender_id']);
      t.index(['workspace_id', 'created_at']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('meta_messenger_events');
  await knex.schema.dropTableIfExists('meta_lead_events');
  await knex.schema.dropTableIfExists('meta_lead_configs');
};
