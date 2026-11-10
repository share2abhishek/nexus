// db/migrations/20261108000001_sellbird_tables.js
// Creates tables for the native Sellbird autonomous sales & outreach agent in Social-Nexus.

exports.up = async function(knex) {
  // 1. sellbird_campaigns
  await knex.schema.createTable('sellbird_campaigns', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('product_url');
    t.text('product_description');
    t.text('icp_definition'); // JSON: target industry, roles, locations, company sizes
    t.text('sequence_template_json'); // JSON: multi-step outreach parameters
    t.string('sending_account_id');
    t.integer('max_emails_per_day').defaultTo(25);
    t.boolean('auto_approve').defaultTo(false); // Safety first: defaults to human-in-the-loop review
    t.string('status').defaultTo('active'); // active, paused, completed
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.index(['workspace_id', 'status']);
  });

  // 2. sellbird_companies
  await knex.schema.createTable('sellbird_companies', (t) => {
    t.increments('id').primary();
    t.integer('campaign_id').notNullable().references('id').inTable('sellbird_campaigns').onDelete('CASCADE');
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('domain').notNullable();
    t.string('location');
    t.string('industry');
    t.text('buying_signals_json'); // JSON: extracted website signals, pain points, offerings
    t.integer('score').defaultTo(50); // Match relevancy score
    t.string('status').defaultTo('discovered'); // discovered, researched, contacted, replied, closed, ignored
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.index(['workspace_id', 'status']);
    t.index(['workspace_id', 'campaign_id']);
    t.index(['domain']);
  });
  await knex.schema.createTable('sellbird_contacts', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable().references('id').inTable('sellbird_companies').onDelete('CASCADE');
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('full_name').notNullable();
    t.string('role');
    t.string('email');
    t.string('email_status').defaultTo('unverified'); // verified, unverified, invalid
    t.string('linkedin_url');
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.index(['workspace_id', 'email_status']);
    t.index(['company_id']);
    t.index(['workspace_id', 'email']);
  });

  // 4. sellbird_outbox
  await knex.schema.createTable('sellbird_outbox', (t) => {
    t.increments('id').primary();
    t.integer('campaign_id').notNullable().references('id').inTable('sellbird_campaigns').onDelete('CASCADE');
    t.integer('contact_id').notNullable().references('id').inTable('sellbird_contacts').onDelete('CASCADE');
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.integer('step_number').defaultTo(1);
    t.string('subject').notNullable();
    t.text('body').notNullable();
    t.string('status').defaultTo('pending_approval'); // pending_approval, approved, sending, sent, rejected, failed
    t.bigInteger('scheduled_at');
    t.bigInteger('sent_at');
    t.text('error_message');
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.index(['workspace_id', 'status']);
    t.index(['workspace_id', 'status', 'scheduled_at']);
    t.index(['campaign_id']);
    t.index(['contact_id']);
  });

  // 5. sellbird_replies
  await knex.schema.createTable('sellbird_replies', (t) => {
    t.increments('id').primary();
    t.integer('outbox_id').references('id').inTable('sellbird_outbox').onDelete('SET NULL');
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('sender_email').notNullable();
    t.string('subject');
    t.text('message_text').notNullable();
    t.string('intent_category').defaultTo('question'); // interested, question, objection, not_interested, unsubscribe
    t.text('ai_drafted_reply');
    t.string('status').defaultTo('pending_review'); // pending_review, approved, sent, dismissed
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.index(['workspace_id', 'status']);
    t.index(['workspace_id', 'intent_category']);
    t.index(['sender_email']);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('sellbird_replies');
  await knex.schema.dropTableIfExists('sellbird_outbox');
  await knex.schema.dropTableIfExists('sellbird_contacts');
  await knex.schema.dropTableIfExists('sellbird_companies');
  await knex.schema.dropTableIfExists('sellbird_campaigns');
};
