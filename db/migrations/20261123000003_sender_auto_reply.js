/**
 * Migration: Add custom auto_reply_text to whatsapp_sender_numbers
 * Allows each phone number in the pool to have its own dedicated auto-reply
 * or fall back to the workspace default bot.
 */
exports.up = async function (knex) {
  const hasCol = await knex.schema.hasColumn('whatsapp_sender_numbers', 'auto_reply_text');
  if (!hasCol) {
    await knex.schema.alterTable('whatsapp_sender_numbers', (table) => {
      table.text('auto_reply_text').nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasCol = await knex.schema.hasColumn('whatsapp_sender_numbers', 'auto_reply_text');
  if (hasCol) {
    await knex.schema.alterTable('whatsapp_sender_numbers', (table) => {
      table.dropColumn('auto_reply_text');
    });
  }
};
