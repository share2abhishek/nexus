// One-off import of today's organisations into bill_subscription (ROADMAP B0; REQUIREMENTS 13 lesson 17).
// preview() writes nothing and shows what apply() would do. apply() is a deliberate staff action: it inserts a row
// only for accounts that have none, never changes an existing row, and turns automatic invoicing OFF for every
// imported row, so importing never starts billing anybody. Each insert is audited.
//
// Mapping from the organisations columns (the plan state before billing):
//   plan 'trial'                     -> TRIAL, trial_end_date = IST date of trial_ends_at
//   plan_status 'suspended'          -> SUSPENDED
//   plan_status 'cancelled'          -> CANCELLED
//   plan_status 'past_due'           -> PAST_DUE
//   anything else                    -> ACTIVE
//   paid_until                       -> current_period_end (IST date); current_period_start stays empty
//   pricing PER_ACCOUNT, cycle MONTHLY (staff set the real terms per account in B3/B5)
const { istDate } = require('../domain/price-calculator');

function mapState(st) {
  const plan = String(st.plan || '').trim();
  let status = 'ACTIVE';
  if (plan === 'trial') status = 'TRIAL';
  if (st.plan_status === 'past_due') status = 'PAST_DUE';
  if (st.plan_status === 'cancelled') status = 'CANCELLED';
  if (st.plan_status === 'suspended') status = 'SUSPENDED';
  return {
    plan_code: plan,
    pricing_model: 'PER_ACCOUNT',
    billing_cycle: 'MONTHLY',
    trial_end_date: plan === 'trial' ? istDate(st.trial_ends_at) : null,
    current_period_end: istDate(st.paid_until),
    status,
  };
}

function makeImporter({ knex, clock, audit, ports }) {
  async function preview() {
    const accounts = await ports.accounts.listAccounts();
    const plans = new Set((await knex('bill_plan').select('code')).map((r) => r.code));
    const existing = new Set((await knex('bill_subscription').select('account_id')).map((r) => Number(r.account_id)));
    const rows = [];
    for (const a of accounts) {
      const st = await ports.catalogue.importState(a.id);
      const proposed = st ? mapState(st) : null;
      let action = 'create';
      let reason = null;
      if (existing.has(Number(a.id))) { action = 'exists'; reason = 'already imported'; } else if (!proposed) { action = 'skip'; reason = 'no plan state'; } else if (!plans.has(proposed.plan_code)) { action = 'skip'; reason = `plan "${proposed.plan_code}" is not in the catalogue`; }
      rows.push({ account_id: a.id, name: a.name, current: st, proposed, action, reason });
    }
    return {
      today: clock.todayIST(),
      counts: { create: rows.filter((r) => r.action === 'create').length, exists: rows.filter((r) => r.action === 'exists').length, skip: rows.filter((r) => r.action === 'skip').length },
      rows,
    };
  }

  async function apply(actor) {
    const plan = await preview();
    const created = [];
    for (const r of plan.rows.filter((x) => x.action === 'create')) {
      const now = clock.now();
      const row = {
        account_id: r.account_id, ...r.proposed, auto_invoice: false, custom_cycle_months: null, unit_price_override_minor: null,
        quantity_override: null, current_period_start: null, notes: `imported ${plan.today} from the plan state before billing`,
        version: 1, created_at: now, updated_at: now, created_by: actor, updated_by: actor,
      };
      await knex.transaction(async (trx) => {
        if (await trx('bill_subscription').where({ account_id: r.account_id }).first()) return; // imported meanwhile: leave it
        await trx('bill_subscription').insert(row);
        await audit.record({ actor, action: 'subscription.import', entity: 'subscription', entityId: r.account_id, accountId: r.account_id, newValue: { ...r.proposed, auto_invoice: false }, reason: 'import of today\'s organisations (B0)' }, trx);
        created.push(r.account_id);
      });
    }
    return { ...plan.counts, created: created.length, created_ids: created };
  }

  async function list() {
    return knex('bill_subscription').orderBy('account_id').select('account_id', 'plan_code', 'pricing_model', 'billing_cycle', 'status', 'trial_end_date', 'current_period_end', 'auto_invoice', 'created_at');
  }

  return { preview, apply, list };
}

module.exports = { makeImporter, mapState };
