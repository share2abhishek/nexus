// db/migrations/20261123000002_whatsapp_multi_numbers.js
// Migration to support multiple sender WhatsApp numbers per workspace

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('whatsapp_sender_numbers'))) {
    await knex.schema.createTable('whatsapp_sender_numbers', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.string('phone_number_id', 100).notNullable();
      t.string('display_number', 50).notNullable();
      t.string('label', 100).nullable();
      t.boolean('is_default').defaultTo(false);
      t.boolean('track_replies').defaultTo(true);
      t.integer('created_at').defaultTo(knex.raw("(strftime('%s', 'now'))"));
      t.integer('updated_at').defaultTo(knex.raw("(strftime('%s', 'now'))"));
    });
  }

  if (await knex.schema.hasTable('whatsapp_broadcasts')) {
    const hasSenderCol = await knex.schema.hasColumn('whatsapp_broadcasts', 'sender_number');
    if (!hasSenderCol) {
      await knex.schema.alterTable('whatsapp_broadcasts', (t) => {
        t.string('sender_number', 100).nullable();
      });
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('whatsapp_sender_numbers')) {
    await knex.schema.dropTable('whatsapp_sender_numbers');
  }
  if (await knex.schema.hasTable('whatsapp_broadcasts')) {
    const hasSenderCol = await knex.schema.hasColumn('whatsapp_broadcasts', 'sender_number');
    if (hasSenderCol) {
      await knex.schema.alterTable('whatsapp_broadcasts', (t) => {
        t.dropColumn('sender_number');
      });
    }
  }
};
