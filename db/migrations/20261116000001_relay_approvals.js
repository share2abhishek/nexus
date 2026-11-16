// Client approval links, hosted edition: the app itself keeps the shared post.
// The post is stored ENCRYPTED: the key is only in the link after "#", which browsers
// never send, so the server (and anyone with the database) cannot read it.
exports.up = async function (knex) {
  if (await knex.schema.hasTable('relay_approvals')) return;
  await knex.schema.createTable('relay_approvals', (t) => {
    t.string('id').primary();
    t.integer('workspace_id');
    t.string('owner_hash').notNullable();
    t.text('ciphertext').notNullable();
    t.text('response');
    t.bigInteger('responded_at');
    t.bigInteger('created_at').notNullable();
    t.bigInteger('expires_at').notNullable();
    t.index(['expires_at']);
    t.index(['workspace_id', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('relay_approvals');
};
