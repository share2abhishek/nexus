// db/migrations/20261109000001_whatsapp_suite_evolution.js
// Migration for Evolution API WhatsApp Engine, Verified Meta OBA Blue/Green Tick, UPI In-Chat Payments & 6 Team Seats.

exports.up = async function (knex) {
  // 1. Extend meta_lead_configs
  if (await knex.schema.hasTable('meta_lead_configs')) {
    await knex.schema.alterTable('meta_lead_configs', (t) => {
      t.string('delivery_engine', 50).defaultTo('cloud_api'); // 'cloud_api' | 'evolution'
      t.text('evolution_api_url').nullable(); // e.g. http://localhost:8080 or https://evolution.mybrand.com
      t.text('evolution_api_key').nullable();
      t.string('evolution_instance_name', 100).nullable();
      t.string('evolution_status', 50).defaultTo('disconnected'); // 'open', 'close', 'connecting', 'disconnected'
      t.text('whatsapp_access_token').nullable();
      t.string('whatsapp_phone_number_id', 100).nullable();
      t.string('whatsapp_business_account_id', 100).nullable();
      t.string('whatsapp_test_recipient', 50).nullable();
      t.text('workflow_nodes_json').nullable();
      t.boolean('meta_two_step_pin_set').defaultTo(false);
      t.string('meta_registered_phone', 50).nullable();
      t.string('razorpay_key_id', 100).nullable();
      t.string('upi_vpa', 100).nullable(); // e.g. yourbusiness@upi
      t.float('free_credits_balance').defaultTo(550.0);
    });
  }

  // 2. Extend meta_lead_events for Team Seats, Retargeting tags & In-Chat Commerce
  if (await knex.schema.hasTable('meta_lead_events')) {
    await knex.schema.alterTable('meta_lead_events', (t) => {
      t.integer('assigned_agent_id').nullable();
      t.string('assigned_agent_name', 100).nullable();
      t.string('channel_source', 50).defaultTo('meta_lead_ad'); // meta_lead_ad, whatsapp_inbound, evolution, csv_upload
      t.text('tags_json').nullable(); // JSON array of retargeting tags: ["society_manager", "demo_requested", "hot"]
      t.float('order_value').nullable();
      t.string('payment_status', 50).defaultTo('none'); // none, link_sent, paid, failed
    });
  }

  // 3. WhatsApp Broadcast Campaigns & Analytics
  if (!(await knex.schema.hasTable('whatsapp_broadcasts'))) {
    await knex.schema.createTable('whatsapp_broadcasts', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.string('title', 255).notNullable();
      t.string('delivery_engine', 50).defaultTo('cloud_api');
      t.string('template_name', 100).nullable();
      t.text('message_content').notNullable();
      t.integer('total_recipients').defaultTo(0);
      t.integer('sent_count').defaultTo(0);
      t.integer('failed_count').defaultTo(0);
      t.float('credits_cost').defaultTo(0);
      t.string('status', 50).defaultTo('completed');
      t.integer('created_at').notNullable();
      t.integer('updated_at').notNullable();

      t.index(['workspace_id', 'created_at']);
    });
  }

  // 4. In-App CRM Live Takeover Messages (lead_conversation_messages)
  if (!(await knex.schema.hasTable('lead_conversation_messages'))) {
    await knex.schema.createTable('lead_conversation_messages', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.integer('lead_id').unsigned().notNullable().references('id').inTable('meta_lead_events').onDelete('CASCADE');
      t.string('sender_type', 50).defaultTo('lead'); // 'lead' | 'agent' | 'internal_note' | 'broadcast'
      t.string('sender_name', 100).nullable();
      t.text('message_text').notNullable();
      t.string('channel', 50).defaultTo('whatsapp'); // 'whatsapp' | 'form' | 'internal'
      t.integer('created_at').notNullable();

      t.index(['workspace_id', 'lead_id', 'created_at']);
    });
  }

  // 5. Native In-App Workflow Logs (lead_workflow_logs)
  if (!(await knex.schema.hasTable('lead_workflow_logs'))) {
    await knex.schema.createTable('lead_workflow_logs', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.integer('lead_id').nullable();
      t.string('workflow_name', 100).defaultTo('instant_lead_alert');
      t.string('step_name', 100).notNullable();
      t.string('status', 50).defaultTo('success');
      t.text('details_json').nullable();
      t.integer('created_at').notNullable();

      t.index(['workspace_id', 'created_at']);
    });
  }
};

exports.down = async function (knex) {
  // rollback
  if (await knex.schema.hasTable('lead_conversation_messages')) {
    await knex.schema.dropTable('lead_conversation_messages');
  }
  if (await knex.schema.hasTable('lead_workflow_logs')) {
    await knex.schema.dropTable('lead_workflow_logs');
  }
  if (await knex.schema.hasTable('whatsapp_broadcasts')) {
    await knex.schema.dropTable('whatsapp_broadcasts');
  }
};
