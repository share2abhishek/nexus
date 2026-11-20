// Seeds the catalogue (docs/billing/REQUIREMENTS.md 5.1; PLAN N5). Insert-only: it adds what is missing and never
// changes a row that exists, so staff edits always survive a restart.
//   - every plan the host lists (today's DEFAULT_PLANS), with its first revision;
//   - for those seeded plans: every catalogued feature ON, today's limits, new limits unlimited (-1);
//     a feature or limit added to the catalogue later is added to seeded plans the same way;
//   - plans staff made get new features OFF and new limits unlimited (staff decide);
//   - the monthly price (PER_ACCOUNT) from today's price list, effective from SEED_PRICE_FROM;
//   - one tax rate "GST 0%" (default D4), every cycle discount 0, the access setting row (lockout off).
// It never creates a subscription (UrbanSociety lesson 17): importing customers is a deliberate staff step.
const { CYCLES, UNLIMITED } = require('../domain/constants');

const SEED_PRICE_FROM = '2026-01-01';
const SEED_TAX_FROM = '2000-01-01';
const ACTOR = 'seed';

async function seed({ knex, clock, ports }) {
  const d = ports.catalogue.defaults();
  const now = clock.now();
  const stamp = { created_at: now, updated_at: now, created_by: ACTOR, updated_by: ACTOR };
  const added = { plans: 0, features: 0, limits: 0, prices: 0 };
  const seededCodes = new Set(d.plans.map((p) => p.code));

  await knex.transaction(async (trx) => {
    for (const p of d.plans) {
      if (await trx('bill_plan').where({ code: p.code }).first()) continue;
      await trx('bill_plan').insert({ code: p.code, name: p.name, rank: p.rank, active: true, public: p.public !== false, description: null, badge: null, owner_org_id: null, ...stamp });
      added.plans += 1;
      if (p.price_monthly_minor != null) {
        await trx('bill_price_book').insert({
          plan_code: p.code, pricing_model: 'PER_ACCOUNT', unit_price_minor: p.price_monthly_minor, effective_from: SEED_PRICE_FROM,
          effective_to: null, active: true, description: 'from the price list before billing (seed)', ...stamp,
        });
        added.prices += 1;
      }
    }

    const plans = await trx('bill_plan').select('code');
    for (const { code } of plans) {
      const seeded = seededCodes.has(code);
      const def = d.plans.find((p) => p.code === code);
      const haveF = new Set((await trx('bill_plan_feature').where({ plan_code: code }).select('feature_key')).map((r) => r.feature_key));
      for (const f of d.features) {
        if (haveF.has(f.key)) continue;
        await trx('bill_plan_feature').insert({ plan_code: code, feature_key: f.key, enabled: seeded, ...stamp });
        added.features += 1;
      }
      const haveL = new Set((await trx('bill_plan_limit').where({ plan_code: code }).select('limit_key')).map((r) => r.limit_key));
      for (const l of d.limits) {
        if (haveL.has(l.key)) continue;
        const v = seeded && def?.limits?.[l.key] !== undefined ? def.limits[l.key] : UNLIMITED;
        await trx('bill_plan_limit').insert({ plan_code: code, limit_key: l.key, value: v, ...stamp });
        added.limits += 1;
      }
      if (!(await trx('bill_plan_revision').where({ plan_code: code }).first())) {
        const plan = await trx('bill_plan').where({ code }).first();
        const features = Object.fromEntries((await trx('bill_plan_feature').where({ plan_code: code })).map((r) => [r.feature_key, !!r.enabled && r.enabled !== 0 && r.enabled !== '0']));
        const limits = Object.fromEntries((await trx('bill_plan_limit').where({ plan_code: code })).map((r) => [r.limit_key, Number(r.value)]));
        await trx('bill_plan_revision').insert({
          plan_code: code, revision: 1, reason: 'seeded from the plans before billing',
          snapshot: JSON.stringify({ code, name: plan.name, rank: Number(plan.rank), active: true, public: !!plan.public, features, limits }),
          created_by: ACTOR, created_at: now,
        });
      }
    }

    if (!(await trx('bill_tax_rate').first())) await trx('bill_tax_rate').insert({ tax_name: 'GST', rate_hundredths: 0, effective_from: SEED_TAX_FROM, ...stamp });
    for (const c of CYCLES) {
      if (!(await trx('bill_cycle_discount').where({ billing_cycle: c }).first())) await trx('bill_cycle_discount').insert({ billing_cycle: c, discount_hundredths: 0, ...stamp });
    }
    if (!(await trx('bill_access_setting').first())) await trx('bill_access_setting').insert({ lockout_enabled: false, default_grace_days: 3, ...stamp });
  });
  return added;
}

module.exports = { seed, SEED_PRICE_FROM, SEED_TAX_FROM };
