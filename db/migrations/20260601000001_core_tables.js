// db/migrations/20260601000001_core_tables.js
// Creates the core tables that used to exist only via services/database.js
// (better-sqlite3, hard-wired to ../data/nexus.db). Without this, a fresh database —
// the packaged desktop app's NEXUS_DATA_DIR, or Postgres — has no users table at all.
// Every table is guarded with hasTable, so existing installs are left untouched.
// Shapes mirror the legacy schema; workspace_id is added by the tenancy_core migration.
exports.up = async function (knex) {
  const epochDefault = knex.client.config.client === 'pg'
    ? knex.raw('extract(epoch from now())')
    : knex.raw("(strftime('%s','now'))");

  async function create(name, build) {
    if (await knex.schema.hasTable(name)) return;
    await knex.schema.createTable(name, build);
  }

  await create('users', (t) => {
    t.increments('id').primary();
    t.string('email').notNullable().unique();
    t.text('password_hash').notNullable();
    t.string('name');
    t.string('role').defaultTo('user');
    t.string('status').defaultTo('active');
    t.bigInteger('last_active');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  await create('user_settings', (t) => {
    t.integer('user_id').primary().references('id').inTable('users');
    t.text('google_ai_key');
    t.text('anthropic_key');
    t.integer('ollama_enabled').defaultTo(0);
    t.string('ollama_model').defaultTo('llama3.2');
    t.string('ollama_url').defaultTo('http://localhost:11434');
    t.text('stability_key');
    t.text('openai_key');
    t.text('luma_key');
    t.text('runway_key');
    t.string('default_text_model').defaultTo('ollama');
    t.bigInteger('updated_at').defaultTo(epochDefault);
  });

  await create('invite_codes', (t) => {
    t.increments('id').primary();
    t.string('code').notNullable().unique();
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.integer('used_by');
    t.bigInteger('expires_at');
    t.integer('max_uses').defaultTo(1);
    t.integer('use_count').defaultTo(0);
    t.text('note');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  await create('platform_config', (t) => {
    t.string('key').primary();
    t.text('value');
  });

  await create('posts', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.text('content').notNullable();
    t.text('platforms').notNullable();
    t.text('image_url');
    t.text('results');
    t.string('status').defaultTo('published');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  await create('scheduled_posts', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.text('content').notNullable();
    t.text('platforms').notNullable();
    t.text('image_url');
    t.bigInteger('scheduled_at').notNullable();
    t.string('status').defaultTo('pending');
    t.text('result');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  await create('history', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.text('prompt').notNullable();
    t.text('response').notNullable();
    t.string('type');
    t.string('model');
    t.integer('tokens_used');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  await create('analytics', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.integer('post_id');
    t.string('platform').notNullable();
    t.integer('likes').defaultTo(0);
    t.integer('comments').defaultTo(0);
    t.integer('shares').defaultTo(0);
    t.integer('impressions').defaultTo(0);
    t.integer('clicks').defaultTo(0);
    t.bigInteger('recorded_at').defaultTo(epochDefault);
  });

  await create('apps', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.string('name').notNullable();
    t.text('description');
    t.text('website');
    t.text('app_store_url');
    t.text('play_store_url');
    t.string('category');
    t.text('logo_url');
    t.string('color').defaultTo('#7c3aed');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  await create('brand_kit', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.string('company_name');
    t.string('primary_color').defaultTo('#7c3aed');
    t.string('secondary_color').defaultTo('#3b82f6');
    t.string('accent_color').defaultTo('#06b6d4');
    t.text('logo_url');
    t.string('font_name').defaultTo('Inter');
    t.text('brand_voice');
    t.text('tagline');
    t.text('target_audience');
    t.bigInteger('updated_at').defaultTo(epochDefault);
  });

  await create('templates', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.string('name').notNullable();
    t.text('content').notNullable();
    t.string('type').defaultTo('social_post');
    t.text('platforms');
    t.text('tags');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  // No global UNIQUE(email): subscribers belong to a workspace, and the same address
  // can legitimately subscribe to two clients' lists.
  await create('email_subscribers', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.string('email').notNullable();
    t.string('name');
    t.text('tags');
    t.string('status').defaultTo('active');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  await create('email_campaigns', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.string('name').notNullable();
    t.string('subject').notNullable();
    t.text('html_content');
    t.text('text_content');
    t.string('status').defaultTo('draft');
    t.integer('sent_count').defaultTo(0);
    t.bigInteger('sent_at');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  await create('seo_keywords', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.string('keyword').notNullable();
    t.text('url');
    t.integer('position');
    t.text('notes');
    t.bigInteger('created_at').defaultTo(epochDefault);
  });

  await create('utm_links', (t) => {
    t.increments('id').primary();
    t.integer('user_id');
    t.text('original_url').notNullable();
    t.string('utm_source');
    t.string('utm_medium');
    t.string('utm_campaign');
    t.string('utm_term');
    t.string('utm_content');
    t.text('full_url').notNullable();
    t.string('label');
    t.integer('clicks').defaultTo(0);
    t.bigInteger('created_at').defaultTo(epochDefault);
  });
};

// Never drop user data on rollback; these tables predate the migration system.
exports.down = async function () {};
