// SEO autopilot: the website to watch, each check's results, and the to-do list
// it produces (Website SEO → Autopilot, and the SEO card on Home).
exports.up = async (knex) => {
  if (!(await knex.schema.hasTable('seo_sites'))) {
    await knex.schema.createTable('seo_sites', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').notNullable().unique(); // one website per workspace
      t.text('url').notNullable();
      t.text('phrases_json'); // ["interior designer pune", ...]
      t.string('frequency', 16).notNullable().defaultTo('weekly'); // daily, weekly
      t.integer('max_pages').notNullable().defaultTo(20);
      t.integer('gbp_quiet_days').notNullable().defaultTo(7); // 0 = no Google post reminders
      t.boolean('enabled').notNullable().defaultTo(true);
      t.string('last_status', 16); // ok, error, running
      t.text('last_error');
      t.text('vitals_json'); // page speed from Google PageSpeed Insights
      t.integer('last_run_at');
      t.integer('next_run_at');
      t.integer('created_at');
      t.integer('updated_at');
    });
  }
  if (!(await knex.schema.hasTable('seo_page_checks'))) {
    await knex.schema.createTable('seo_page_checks', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').notNullable();
      t.integer('site_id').notNullable();
      t.text('url').notNullable();
      t.integer('checked_at').notNullable();
      t.integer('http_status');
      t.text('title');
      t.text('description');
      t.text('checks_json'); // [{ id, status, label, detail }]
      t.integer('good');
      t.integer('warn');
      t.integer('bad');
      t.text('error');
      t.index(['workspace_id', 'site_id', 'checked_at']);
    });
  }
  if (!(await knex.schema.hasTable('seo_tasks'))) {
    await knex.schema.createTable('seo_tasks', (t) => {
      t.increments('id').primary();
      t.integer('workspace_id').notNullable();
      t.integer('site_id');
      t.string('key', 255).notNullable(); // same problem = same key, so it isn't listed twice
      t.string('kind', 16).notNullable(); // fix, idea, post
      t.integer('priority').notNullable().defaultTo(2); // 1 urgent, 2 important, 3 nice to have
      t.text('title').notNullable();
      t.text('detail');
      t.text('pages_json'); // pages it applies to
      t.text('draft_json'); // AI-written suggestion, once asked for
      t.integer('content_item_id'); // a post waiting for approval
      t.string('status', 16).notNullable().defaultTo('open'); // open, done, dismissed, resolved
      t.integer('created_at');
      t.integer('updated_at');
      t.integer('closed_at');
      t.unique(['workspace_id', 'key']);
      t.index(['workspace_id', 'status']);
    });
  }
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('seo_tasks');
  await knex.schema.dropTableIfExists('seo_page_checks');
  await knex.schema.dropTableIfExists('seo_sites');
};
