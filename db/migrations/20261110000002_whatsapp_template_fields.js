// What each fill-in of a WhatsApp template means ({{1}} = customer's name, {{2}} =
// an offer…), saved when the template is made here, so broadcasts can fill them.
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('whatsapp_template_fields'))) {
    await knex.schema.createTable('whatsapp_template_fields', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
      t.string('name', 512).notNullable();
      t.string('language', 20).notNullable();
      t.text('fields_json').notNullable(); // [{ "key": "name", "label": "Customer's name", "example": "Priya" }, …]
      t.integer('created_by').nullable();
      t.integer('created_at').notNullable();
      t.unique(['workspace_id', 'name', 'language']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('whatsapp_template_fields');
};
