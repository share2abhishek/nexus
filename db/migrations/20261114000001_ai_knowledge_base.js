// Migration: Create ai_knowledge_bases table for AI Chat Knowledge Base
// Stores structured FAQs, business facts, persona/tone settings, raw documents,
// and precompiled knowledge representations per workspace.

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('ai_knowledge_bases'))) {
    await knex.schema.createTable('ai_knowledge_bases', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').unsigned().notNullable().unique().references('id').inTable('workspaces').onDelete('CASCADE');
      t.text('persona_json').nullable();
      t.text('facts_json').nullable();
      t.text('faqs_json').nullable();
      t.text('documents_json').nullable();
      t.text('raw_text').nullable();
      t.text('compiled_knowledge').nullable();
      t.integer('updated_by').nullable();
      t.integer('created_at').notNullable();
      t.integer('updated_at').notNullable();
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ai_knowledge_bases');
};
