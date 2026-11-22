// Billing B0 (docs/billing/REQUIREMENTS.md sections 6.1, 6.2 and 6.6; docs/billing/ACCESS-REQUIREMENTS.md 9): the plan
// catalogue (with private plans and revisions), price book, cycle discounts, tax rates, coupons, subscriptions, account
// discounts and overrides, access settings, and the billing audit trail. Server edition only uses them, and only when BILLING_ENABLED=true.
//
// Creates tables only. It seeds nothing and creates no subscription: the catalogue is seeded by the
// billing module on start, and customers are imported by a deliberate staff step
// (modules/billing/scripts/import-subscriptions.js).
//
// Money: integer minor units (paise), columns end in _minor. Percentages: integer hundredths.
// Dates: 'YYYY-MM-DD' (IST) in string(10). Timestamps: integer epoch seconds.
//
// ROLLBACK: `down` drops only these bill_* tables. Nothing else reads them in this release, so rolling
// back loses only catalogue edits and imported subscriptions (re-run the import afterwards).

const TABLES = [
  'bill_plan_revision', 'bill_audit', 'bill_account_access', 'bill_access_setting', 'bill_account_override', 'bill_account_discount',
  'bill_subscription', 'bill_coupon', 'bill_tax_rate', 'bill_cycle_discount', 'bill_price_book',
  'bill_plan_limit', 'bill_plan_feature', 'bill_plan',
];

async function create(knex, name, build) {
  if (await knex.schema.hasTable(name)) return;
  await knex.schema.createTable(name, build);
}

// created_at, updated_at, created_by, updated_by on every mutable table
const stamps = (t) => {
  t.integer('created_at').notNullable();
  t.integer('updated_at').notNullable();
  t.string('created_by', 255);
  t.string('updated_by', 255);
};

exports.up = async (knex) => {
  // ── 6.1 Catalogue ──────────────────────────────────────────────────────────
  await create(knex, 'bill_plan', (t) => {
    t.string('code', 30).primary();
    t.string('name', 80).notNullable();
    t.integer('rank').notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('public').notNullable().defaultTo(true);
    t.string('description', 500);
    t.string('badge', 30);
    t.integer('owner_org_id'); // set = a private plan made for this one organisation (never on the price list)
    stamps(t);
  });

  // Every save of a plan: number, full snapshot (features, limits, flags), author and reason (kept forever)
  await create(knex, 'bill_plan_revision', (t) => {
    t.increments('id');
    t.string('plan_code', 30).notNullable().references('code').inTable('bill_plan');
    t.integer('revision').notNullable();
    t.text('snapshot').notNullable();
    t.string('reason', 500);
    t.string('created_by', 255);
    t.integer('created_at').notNullable();
    t.unique(['plan_code', 'revision']);
  });

  await create(knex, 'bill_plan_feature', (t) => {
    t.increments('id');
    t.string('plan_code', 30).notNullable().references('code').inTable('bill_plan');
    t.string('feature_key', 30).notNullable();
    t.boolean('enabled').notNullable().defaultTo(false);
    stamps(t);
    t.unique(['plan_code', 'feature_key']);
  });

  await create(knex, 'bill_plan_limit', (t) => {
    t.increments('id');
    t.string('plan_code', 30).notNullable().references('code').inTable('bill_plan');
    t.string('limit_key', 30).notNullable();
    t.integer('value').notNullable(); // -1 = unlimited
    stamps(t);
    t.unique(['plan_code', 'limit_key']);
  });

  await create(knex, 'bill_price_book', (t) => {
    t.increments('id');
    t.string('plan_code', 30).notNullable().references('code').inTable('bill_plan');
    t.string('pricing_model', 20).notNullable(); // PER_UNIT | PER_ACCOUNT | ONE_TIME
    t.bigInteger('unit_price_minor').notNullable(); // per unit per month (PER_UNIT), per month (PER_ACCOUNT), once (ONE_TIME)
    t.string('effective_from', 10).notNullable();
    t.string('effective_to', 10);
    t.boolean('active').notNullable().defaultTo(true);
    t.string('description', 200);
    stamps(t);
    t.unique(['plan_code', 'pricing_model', 'effective_from']);
  });

  await create(knex, 'bill_cycle_discount', (t) => {
    t.increments('id');
    t.string('billing_cycle', 20).notNullable().unique();
    t.integer('discount_hundredths').notNullable().defaultTo(0); // 0..10000
    stamps(t);
  });

  await create(knex, 'bill_tax_rate', (t) => {
    t.increments('id');
    t.string('tax_name', 40).notNullable();
    t.integer('rate_hundredths').notNullable(); // 0..10000
    t.string('effective_from', 10).notNullable().unique();
    stamps(t);
  });

  await create(knex, 'bill_coupon', (t) => {
    t.increments('id');
    t.string('code', 40).notNullable().unique(); // stored lower case
    t.string('discount_type', 10).notNullable(); // PERCENT | FIXED
    t.bigInteger('discount_value').notNullable(); // hundredths (PERCENT) or minor units (FIXED)
    t.string('valid_from', 10);
    t.string('valid_to', 10);
    t.integer('max_redemptions');
    t.integer('redemptions').notNullable().defaultTo(0);
    t.boolean('active').notNullable().defaultTo(true);
    t.string('description', 200);
    stamps(t);
  });

  // ── 6.2 Subscription ───────────────────────────────────────────────────────
  await create(knex, 'bill_subscription', (t) => {
    t.increments('id');
    t.integer('account_id').notNullable().unique();
    t.string('plan_code', 30).notNullable().references('code').inTable('bill_plan');
    t.string('pricing_model', 20).notNullable();
    t.string('billing_cycle', 20).notNullable();
    t.integer('custom_cycle_months');
    t.bigInteger('unit_price_override_minor');
    t.integer('quantity_override');
    t.string('trial_end_date', 10);
    t.string('current_period_start', 10);
    t.string('current_period_end', 10); // the paid-until day
    t.string('status', 20).notNullable(); // TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED
    t.boolean('auto_invoice').notNullable().defaultTo(true);
    t.string('billing_email', 255);
    t.string('tax_id', 20);
    t.string('billing_address', 500);
    t.string('scheduled_plan_code', 30);
    t.string('scheduled_plan_effective', 10);
    t.string('cancel_requested_on', 10);
    t.string('cancel_effective_on', 10);
    t.string('notes', 500); // internal: never sent to customers
    t.integer('version').notNullable().defaultTo(1);
    stamps(t);
    t.index(['status']);
  });

  await create(knex, 'bill_account_discount', (t) => {
    t.increments('id');
    t.integer('account_id').notNullable();
    t.string('discount_type', 10).notNullable();
    t.bigInteger('discount_value').notNullable();
    t.string('valid_from', 10).notNullable();
    t.string('valid_to', 10);
    t.string('reason', 500).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    stamps(t);
    t.index(['account_id']);
  });

  await create(knex, 'bill_account_override', (t) => {
    t.increments('id');
    t.integer('account_id').notNullable();
    t.string('kind', 20).notNullable(); // FEATURE | LIMIT | ALLOWANCE
    t.string('key', 30).notNullable();
    t.integer('value').notNullable(); // FEATURE: 1/0; LIMIT and ALLOWANCE: the number (-1 unlimited)
    t.string('valid_from', 10).notNullable();
    t.string('valid_until', 10);
    t.string('reason', 500).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    stamps(t);
    t.index(['account_id']);
  });
  // one active override per account, kind and key (partial unique index: SQLite and Postgres)
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS bill_account_override_active_uq ON bill_account_override (account_id, kind, key) WHERE active');

  await create(knex, 'bill_access_setting', (t) => {
    t.increments('id');
    t.boolean('lockout_enabled').notNullable().defaultTo(false);
    t.integer('default_grace_days').notNullable().defaultTo(3);
    stamps(t);
  });

  await create(knex, 'bill_account_access', (t) => {
    t.increments('id');
    t.integer('account_id').notNullable().unique();
    t.integer('grace_days');
    t.string('allow_until', 10);
    t.boolean('never_lock').notNullable().defaultTo(false);
    t.string('reason', 500);
    stamps(t);
  });

  // ── 6.6 Audit (append-only) ────────────────────────────────────────────────
  await create(knex, 'bill_audit', (t) => {
    t.increments('id');
    t.string('actor', 255).notNullable();
    t.string('action', 60).notNullable();
    t.string('entity', 40).notNullable();
    t.string('entity_id', 60);
    t.integer('account_id');
    t.text('old_value');
    t.text('new_value');
    t.string('reason', 500);
    t.integer('created_at').notNullable();
    t.index(['entity', 'entity_id']);
    t.index(['account_id']);
  });
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS bill_account_override_active_uq');
  for (const name of TABLES) await knex.schema.dropTableIfExists(name);
};
