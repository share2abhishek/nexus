// Posts handed to Radixile's cloud as a safety net for when this PC is off
// (one row per post and platform). The owner token is a secret (stored encrypted).
exports.up = async function (knex) {
  if (await knex.schema.hasTable('cloud_jobs')) return;
  await knex.schema.createTable('cloud_jobs', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable();
    t.integer('content_item_id').notNullable();
    t.string('platform').notNullable();
    t.string('job_id').notNullable();
    t.text('owner_token').notNullable();
    t.bigInteger('run_at').notNullable();
    t.string('fingerprint');
    t.string('status').notNullable().defaultTo('waiting'); // waiting | cancelled | done | failed | taken_back
    t.text('result');
    t.bigInteger('created_at').notNullable();
    t.index(['content_item_id']);
    t.index(['status']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('cloud_jobs');
};
