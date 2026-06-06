// db/migrations/20260606000001_tenancy_core.js
exports.up = async function (knex) {
  const epochDefault = knex.client.config.client === 'pg'
    ? knex.raw('extract(epoch from now())')
    : knex.raw("(strftime('%s','now'))");

  await knex.schema.createTable('organizations', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.integer('owner_user_id').notNullable();
    t.string('plan').defaultTo('free');
    t.integer('created_at').defaultTo(epochDefault);
  });

  await knex.schema.createTable('org_members', (t) => {
    t.increments('id').primary();
    t.integer('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.integer('user_id').notNullable();
    t.string('role').notNullable(); // owner | admin
    t.unique(['org_id', 'user_id']);
  });

  await knex.schema.createTable('workspaces', (t) => {
    t.increments('id').primary();
    t.integer('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('slug').notNullable();
    t.string('timezone').defaultTo('UTC');
    t.integer('created_at').defaultTo(epochDefault);
    t.unique(['org_id', 'slug']);
  });

  await knex.schema.createTable('memberships', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('role').notNullable(); // manager|creator|reviewer|client|analyst
    t.string('status').defaultTo('active');
    t.integer('created_at').defaultTo(epochDefault);
    t.unique(['user_id', 'workspace_id']);
  });

  await knex.schema.createTable('invitations', (t) => {
    t.increments('id').primary();
    t.integer('org_id').notNullable();
    t.integer('workspace_id');
    t.string('email').notNullable();
    t.string('role').notNullable();
    t.string('token').notNullable().unique();
    t.integer('invited_by');
    t.integer('expires_at');
    t.integer('accepted_at');
    t.integer('created_at').defaultTo(epochDefault);
  });

  await knex.schema.createTable('social_accounts', (t) => {
    t.increments('id').primary();
    t.integer('workspace_id').notNullable().references('id').inTable('workspaces').onDelete('CASCADE');
    t.string('platform').notNullable();
    t.string('account_label');
    t.string('external_id');
    t.text('access_token');
    t.text('refresh_token');
    t.integer('expires_at');
    t.text('profile_json');
    t.string('page_id');
    t.text('page_token');
    t.string('ig_account_id');
    t.string('board_id');
    t.string('status').defaultTo('active');
    t.integer('created_at').defaultTo(epochDefault);
    t.unique(['workspace_id', 'platform', 'external_id']);
  });

  // Add workspace_id to existing data tables (create them if a fresh cloud DB).
  const dataTables = ['posts', 'scheduled_posts', 'history', 'analytics', 'seo_keywords',
    'utm_links', 'templates', 'email_subscribers', 'email_campaigns', 'apps', 'brand_kit', 'user_settings'];
  for (const tbl of dataTables) {
    if (await knex.schema.hasTable(tbl)) {
      if (!(await knex.schema.hasColumn(tbl, 'workspace_id'))) {
        await knex.schema.alterTable(tbl, (t) => t.integer('workspace_id').index());
      }
    }
  }
};

exports.down = async function (knex) {
  for (const tbl of ['social_accounts', 'invitations', 'memberships', 'workspaces', 'org_members', 'organizations']) {
    await knex.schema.dropTableIfExists(tbl);
  }
};
