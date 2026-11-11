// WhatsApp auto-replies (chatbot): settings per workspace, and per-chat state
// (welcomed, away message sent, paused while a person answers, opted out of
// broadcasts, and a small counter so the bot can never flood a chat).

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('whatsapp_bot_settings'))) {
    await knex.schema.createTable('whatsapp_bot_settings', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().unique().references('id').inTable('workspaces').onDelete('CASCADE');
      t.boolean('enabled').notNullable().defaultTo(false);
      t.text('config_json').nullable();
      // Whose AI keys answer "other questions" (only if they turned AI answers on)
      t.integer('updated_by').nullable();
      t.integer('updated_at').notNullable();
    });
  }

  if (!(await knex.schema.hasTable('whatsapp_bot_state'))) {
    await knex.schema.createTable('whatsapp_bot_state', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.integer('lead_id').unsigned().notNullable().references('id').inTable('meta_lead_events').onDelete('CASCADE');
      t.integer('paused_until').nullable();   // a person is answering: the bot stays quiet until then
      t.integer('welcomed_at').nullable();
      t.integer('away_sent_at').nullable();
      t.integer('fallback_sent_at').nullable();
      t.integer('window_start').nullable();   // rate limit: bot replies in the current hour
      t.integer('window_count').notNullable().defaultTo(0);
      t.boolean('opted_out').notNullable().defaultTo(false); // replied STOP: no broadcasts
      t.integer('updated_at').notNullable();
      t.unique(['workspace_id', 'lead_id']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('whatsapp_bot_state');
  await knex.schema.dropTableIfExists('whatsapp_bot_settings');
};
