// db/migrations/20261123000001_broadcast_custom_number.js
// Migration to support separate WhatsApp numbers for broadcasts & tracking inbound replies

exports.up = async function (knex) {
  if (await knex.schema.hasTable('meta_lead_configs')) {
    const hasCol = await knex.schema.hasColumn('meta_lead_configs', 'broadcast_phone_mode');
    if (!hasCol) {
      await knex.schema.alterTable('meta_lead_configs', (t) => {
        t.string('broadcast_phone_mode', 20).defaultTo('same'); // 'same' | 'custom'
        t.string('broadcast_whatsapp_phone_number_id', 100).nullable();
        t.string('broadcast_phone_number', 50).nullable();
        t.string('broadcast_evolution_instance_name', 100).nullable();
        t.boolean('broadcast_track_replies').defaultTo(true);
      });
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('meta_lead_configs')) {
    const hasCol = await knex.schema.hasColumn('meta_lead_configs', 'broadcast_phone_mode');
    if (hasCol) {
      await knex.schema.alterTable('meta_lead_configs', (t) => {
        t.dropColumn('broadcast_phone_mode');
        t.dropColumn('broadcast_whatsapp_phone_number_id');
        t.dropColumn('broadcast_phone_number');
        t.dropColumn('broadcast_evolution_instance_name');
        t.dropColumn('broadcast_track_replies');
      });
    }
  }
};
