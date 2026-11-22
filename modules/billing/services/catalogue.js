// The plan catalogue and price book (docs/billing/REQUIREMENTS.md 5.1, 5.2, 5.5; ACCESS-REQUIREMENTS.md 4.2).
// Plans are data: staff create, change, clone and deactivate them; nothing is ever deleted.
// Every plan save writes a revision (full snapshot) and an audit row in the same transaction.
// Feature and limit keys belong to the host (ports.catalogue.defaults()); the module stores them and asks the host
// whether a set of features is possible (dependencies), it never interprets them.
// Money: integer minor units. Percentages: integer hundredths. Dates: 'YYYY-MM-DD' IST.
const { PRICING_MODELS, CYCLES, DISCOUNT_TYPES, UNLIMITED, CODE_RE, MAX_MONEY_MINOR, isDate } = require('../domain/constants');
const calc = require('../domain/price-calculator');
const { bad, notFound, conflict } = require('../domain/errors');

const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
const int = (v) => (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v);

function makeCatalogue({ knex, clock, audit, ports }) {
  const stamp = (actor) => ({ created_at: clock.now(), updated_at: clock.now(), created_by: actor, updated_by: actor });
  const defaults = () => ports.catalogue.defaults();
  const featureKeys = () => defaults().features.map((f) => f.key);
  const limitKeys = () => defaults().limits.map((l) => l.key);

  // ── Validation ─────────────────────────────────────────────────────────────
  function cleanFeatures(input, { partial = false } = {}) {
    if (input == null) return partial ? null : {};
    if (typeof input !== 'object' || Array.isArray(input)) throw bad('invalidfeatures', 'features must be { key: true|false }', 'features');
    const known = new Set(featureKeys());
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (!known.has(k)) throw bad('unknownfeature', `Unknown feature "${k}".`, 'features');
      out[k] = bool(v);
    }
    return out;
  }
  function cleanLimits(input, { partial = false } = {}) {
    if (input == null) return partial ? null : {};
    if (typeof input !== 'object' || Array.isArray(input)) throw bad('invalidlimits', 'limits must be { key: number }', 'limits');
    const known = new Set(limitKeys());
    const out = {};
    for (const [k, raw] of Object.entries(input)) {
      if (!known.has(k)) throw bad('unknownlimit', `Unknown limit "${k}".`, 'limits');
      const v = int(raw);
      if (!Number.isInteger(v) || v < UNLIMITED || v > 2147483647) throw bad('invalidlimit', `Limit "${k}" must be a whole number, or -1 for unlimited.`, 'limits');
      out[k] = v;
    }
    return out;
  }
  function assertPossible(features) {
    const enabled = Object.entries(features).filter(([, on]) => on).map(([k]) => k);
    const problems = ports.catalogue.checkFeatures(enabled);
    if (problems.length) throw bad('featuredependency', problems.join(' '), 'features');
  }
  const text = (v, max, field, required = false) => {
    if (v == null || v === '') { if (required) throw bad('required', `${field} is required.`, field); return null; }
    const s = String(v).trim();
    if (required && !s) throw bad('required', `${field} is required.`, field);
    return s.slice(0, max);
  };

  // ── Reading ────────────────────────────────────────────────────────────────
  async function featuresOf(code, db = knex) {
    const rows = await db('bill_plan_feature').where({ plan_code: code });
    return Object.fromEntries(featureKeys().map((k) => [k, !!rows.find((r) => r.feature_key === k && bool(r.enabled))]));
  }
  async function limitsOf(code, db = knex) {
    const rows = await db('bill_plan_limit').where({ plan_code: code });
    const out = {};
    for (const k of limitKeys()) { const r = rows.find((x) => x.limit_key === k); out[k] = r ? Number(r.value) : null; } // null = not set (counts as 0)
    return out;
  }
  const shape = (p) => ({
    code: p.code, name: p.name, rank: Number(p.rank), active: bool(p.active), public: bool(p.public),
    description: p.description || null, badge: p.badge || null, owner_org_id: p.owner_org_id ?? null,
  });

  async function getPlan(code, db = knex) {
    const p = await db('bill_plan').where({ code }).first();
    if (!p) throw notFound('No such plan.');
    const today = clock.todayIST();
    return {
      ...shape(p),
      features: await featuresOf(code, db),
      limits: await limitsOf(code, db),
      prices: await currentPrices(code, today, db),
      accounts_on_plan: await ports.accounts.countOnPlan(code),
      revision: Number((await db('bill_plan_revision').where({ plan_code: code }).max('revision as r').first())?.r || 0),
    };
  }

  async function listPlans() {
    const plans = await knex('bill_plan').orderBy([{ column: 'rank' }, { column: 'code' }]);
    return Promise.all(plans.map((p) => getPlan(p.code)));
  }

  // ── Writing plans ──────────────────────────────────────────────────────────
  async function writeRows(trx, code, features, limits, actor) {
    for (const [k, on] of Object.entries(features)) {
      const n = await trx('bill_plan_feature').where({ plan_code: code, feature_key: k }).update({ enabled: on, updated_at: clock.now(), updated_by: actor });
      if (!n) await trx('bill_plan_feature').insert({ plan_code: code, feature_key: k, enabled: on, ...stamp(actor) });
    }
    for (const [k, v] of Object.entries(limits)) {
      const n = await trx('bill_plan_limit').where({ plan_code: code, limit_key: k }).update({ value: v, updated_at: clock.now(), updated_by: actor });
      if (!n) await trx('bill_plan_limit').insert({ plan_code: code, limit_key: k, value: v, ...stamp(actor) });
    }
  }

  async function writeRevision(trx, code, actor, reason) {
    const plan = await trx('bill_plan').where({ code }).first();
    const snapshot = { ...shape(plan), features: await featuresOf(code, trx), limits: await limitsOf(code, trx) };
    const last = Number((await trx('bill_plan_revision').where({ plan_code: code }).max('revision as r').first())?.r || 0);
    await trx('bill_plan_revision').insert({
      plan_code: code, revision: last + 1, snapshot: JSON.stringify(snapshot), reason: reason || null, created_by: actor, created_at: clock.now(),
    });
    return { revision: last + 1, snapshot };
  }

  async function createPlan(actor, input = {}, reason = null) {
    const code = String(input.code || '').trim().toLowerCase();
    if (!CODE_RE.test(code)) throw bad('invalidcode', 'Plan code: 2–30 lower-case letters, digits or _, starting with a letter. It can never change.', 'code');
    const name = text(input.name, 80, 'name', true);
    const features = { ...Object.fromEntries(featureKeys().map((k) => [k, false])), ...cleanFeatures(input.features) };
    const limits = { ...Object.fromEntries(limitKeys().map((k) => [k, UNLIMITED])), ...cleanLimits(input.limits) };
    assertPossible(features);
    const rank = int(input.rank ?? 0);
    if (!Number.isInteger(rank) || rank < 0 || rank > 100000) throw bad('invalidrank', 'Rank must be a whole number from 0.', 'rank');
    const ownerOrgId = input.owner_org_id == null || input.owner_org_id === '' ? null : int(input.owner_org_id);
    if (ownerOrgId !== null && (!Number.isInteger(ownerOrgId) || !(await ports.accounts.getAccount(ownerOrgId)))) throw bad('invalidaccount', 'No such organisation.', 'owner_org_id');

    await knex.transaction(async (trx) => {
      if (await trx('bill_plan').where({ code }).first()) throw conflict('planexists', `A plan with the code "${code}" already exists.`);
      await trx('bill_plan').insert({
        code, name, rank, active: input.active === undefined ? true : bool(input.active),
        public: ownerOrgId !== null ? false : (input.public === undefined ? false : bool(input.public)), // new plans start off the price list
        description: text(input.description, 500, 'description'), badge: text(input.badge, 30, 'badge'), owner_org_id: ownerOrgId, ...stamp(actor),
      });
      await writeRows(trx, code, features, limits, actor);
      const { snapshot } = await writeRevision(trx, code, actor, reason || 'created');
      await audit.record({ actor, action: 'plan.create', entity: 'plan', entityId: code, newValue: snapshot, reason }, trx);
    });
    return getPlan(code);
  }

  async function updatePlan(actor, code, input = {}, reason = null) {
    const existing = await knex('bill_plan').where({ code }).first();
    if (!existing) throw notFound('No such plan.');
    if (input.code !== undefined && String(input.code) !== code) throw bad('codeimmutable', 'A plan code can never change. Clone the plan instead.', 'code');
    const onPlan = await ports.accounts.countOnPlan(code);
    if (onPlan > 0 && !String(reason || '').trim()) {
      throw bad('reasonrequired', `${onPlan} organisation(s) are on this plan. Say why you are changing it.`, 'reason');
    }
    const featurePatch = cleanFeatures(input.features, { partial: true });
    const limitPatch = cleanLimits(input.limits, { partial: true });
    const features = { ...(await featuresOf(code)), ...(featurePatch || {}) };
    assertPossible(features);
    const patch = {};
    if (input.name !== undefined) patch.name = text(input.name, 80, 'name', true);
    if (input.description !== undefined) patch.description = text(input.description, 500, 'description');
    if (input.badge !== undefined) patch.badge = text(input.badge, 30, 'badge');
    if (input.rank !== undefined) {
      const r = int(input.rank);
      if (!Number.isInteger(r) || r < 0 || r > 100000) throw bad('invalidrank', 'Rank must be a whole number from 0.', 'rank');
      patch.rank = r;
    }
    if (input.active !== undefined) patch.active = bool(input.active);
    if (input.public !== undefined) {
      if (bool(input.public) && existing.owner_org_id != null) throw bad('privateplan', 'A plan made for one organisation can’t go on the price list.', 'public');
      patch.public = bool(input.public);
    }

    let result;
    await knex.transaction(async (trx) => {
      const before = { ...shape(existing), features: await featuresOf(code, trx), limits: await limitsOf(code, trx) };
      if (Object.keys(patch).length) await trx('bill_plan').where({ code }).update({ ...patch, updated_at: clock.now(), updated_by: actor });
      await writeRows(trx, code, featurePatch || {}, limitPatch || {}, actor);
      result = await writeRevision(trx, code, actor, reason);
      await audit.record({ actor, action: 'plan.update', entity: 'plan', entityId: code, oldValue: before, newValue: result.snapshot, reason }, trx);
    });
    return getPlan(code);
  }

  async function clonePlan(actor, code, input = {}, reason = null) {
    const src = await getPlan(code);
    const plan = await createPlan(actor, {
      code: input.code, name: input.name || `${src.name} (copy)`, rank: src.rank, active: true, public: false,
      description: src.description, badge: null, owner_org_id: input.owner_org_id ?? null,
      features: src.features, limits: Object.fromEntries(Object.entries(src.limits).filter(([, v]) => v !== null)),
    }, reason || `cloned from ${code}`);
    // The current prices come along (from today), so the copy can be sold at once
    for (const p of src.prices) await addPrice(actor, { plan_code: plan.code, pricing_model: p.pricing_model, unit_price_minor: p.unit_price_minor, effective_from: clock.todayIST(), description: `cloned from ${code}` });
    return getPlan(plan.code);
  }

  async function revisions(code) {
    if (!(await knex('bill_plan').where({ code }).first())) throw notFound('No such plan.');
    const rows = await knex('bill_plan_revision').where({ plan_code: code }).orderBy('revision', 'desc').limit(200);
    return rows.map((r) => ({ revision: Number(r.revision), reason: r.reason, created_by: r.created_by, created_at: Number(r.created_at), snapshot: JSON.parse(r.snapshot) }));
  }

  // ── Price book (append-only; the price for a period is read at its start date) ─
  async function priceOn(planCode, model, date, db = knex) {
    return db('bill_price_book').where({ plan_code: planCode, pricing_model: model, active: true })
      .where('effective_from', '<=', date)
      .where((q) => q.whereNull('effective_to').orWhere('effective_to', '>=', date))
      .orderBy('effective_from', 'desc').first();
  }
  async function currentPrices(planCode, date, db = knex) {
    const out = [];
    for (const m of PRICING_MODELS) {
      const r = await priceOn(planCode, m, date, db);
      if (r) out.push({ id: r.id, pricing_model: m, unit_price_minor: Number(r.unit_price_minor), effective_from: r.effective_from, effective_to: r.effective_to || null });
    }
    return out;
  }
  async function listPrices(planCode) {
    const q = knex('bill_price_book').orderBy([{ column: 'plan_code' }, { column: 'pricing_model' }, { column: 'effective_from', order: 'desc' }]);
    if (planCode) q.where({ plan_code: planCode });
    return (await q).map((r) => ({ ...r, unit_price_minor: Number(r.unit_price_minor), active: bool(r.active) }));
  }
  async function addPrice(actor, input = {}) {
    const plan = await knex('bill_plan').where({ code: input.plan_code }).first();
    if (!plan) throw bad('unknownplan', 'No such plan.', 'plan_code');
    if (!PRICING_MODELS.includes(input.pricing_model)) throw bad('invalidmodel', `Pricing model must be one of ${PRICING_MODELS.join(', ')}.`, 'pricing_model');
    const unit = int(input.unit_price_minor);
    if (!Number.isInteger(unit) || unit < 0 || unit > MAX_MONEY_MINOR) throw bad('invalidamount', 'Price must be a whole number of paise, 0 or more.', 'unit_price_minor');
    const from = input.effective_from || clock.todayIST();
    if (!isDate(from)) throw bad('invaliddate', 'Start date must be YYYY-MM-DD.', 'effective_from');
    const to = input.effective_to || null;
    if (to !== null && (!isDate(to) || to < from)) throw bad('invaliddate', 'End date must be YYYY-MM-DD, on or after the start.', 'effective_to');
    const hasAny = await knex('bill_price_book').where({ plan_code: plan.code, pricing_model: input.pricing_model }).first();
    // A plan's first price may start in the past (to describe today's prices); later ones never rewrite the past
    if (hasAny && from < clock.todayIST()) throw bad('pastdate', 'A new price starts today or later; past prices never change.', 'effective_from');
    let id;
    await knex.transaction(async (trx) => {
      if (await trx('bill_price_book').where({ plan_code: plan.code, pricing_model: input.pricing_model, effective_from: from }).first()) {
        throw conflict('priceexists', 'There is already a price for this plan and model from that date.');
      }
      const [row] = await trx('bill_price_book').insert({
        plan_code: plan.code, pricing_model: input.pricing_model, unit_price_minor: unit, effective_from: from, effective_to: to,
        active: true, description: text(input.description, 200, 'description'), ...stamp(actor),
      }).returning('id');
      id = row?.id ?? row;
      await audit.record({ actor, action: 'price.add', entity: 'price_book', entityId: id, newValue: { plan_code: plan.code, pricing_model: input.pricing_model, unit_price_minor: unit, effective_from: from, effective_to: to } }, trx);
    });
    return knex('bill_price_book').where({ id }).first();
  }

  // ── Cycle discounts ────────────────────────────────────────────────────────
  async function listCycleDiscounts() {
    const rows = await knex('bill_cycle_discount');
    return CYCLES.map((c) => ({ billing_cycle: c, discount_hundredths: Number(rows.find((r) => r.billing_cycle === c)?.discount_hundredths || 0) }));
  }
  async function setCycleDiscount(actor, cycle, hundredths, reason = null) {
    if (!CYCLES.includes(cycle)) throw bad('invalidcycle', `Cycle must be one of ${CYCLES.join(', ')}.`, 'billing_cycle');
    const v = int(hundredths);
    if (!Number.isInteger(v) || v < 0 || v > 10000) throw bad('invalidpercent', 'Discount is in hundredths of a percent, 0 to 10000 (1500 = 15%).', 'discount_hundredths');
    await knex.transaction(async (trx) => {
      const old = await trx('bill_cycle_discount').where({ billing_cycle: cycle }).first();
      if (old) await trx('bill_cycle_discount').where({ billing_cycle: cycle }).update({ discount_hundredths: v, updated_at: clock.now(), updated_by: actor });
      else await trx('bill_cycle_discount').insert({ billing_cycle: cycle, discount_hundredths: v, ...stamp(actor) });
      await audit.record({ actor, action: 'cycle_discount.set', entity: 'cycle_discount', entityId: cycle, oldValue: old ? Number(old.discount_hundredths) : 0, newValue: v, reason }, trx);
    });
    return listCycleDiscounts();
  }

  // ── Tax rates (append-only, effective-dated) ───────────────────────────────
  async function listTaxRates() {
    return (await knex('bill_tax_rate').orderBy('effective_from', 'desc')).map((r) => ({ ...r, rate_hundredths: Number(r.rate_hundredths) }));
  }
  async function taxOn(date, db = knex) {
    return db('bill_tax_rate').where('effective_from', '<=', date).orderBy('effective_from', 'desc').first();
  }
  async function addTaxRate(actor, input = {}, reason = null) {
    const name = text(input.tax_name, 40, 'tax_name', true);
    const rate = int(input.rate_hundredths);
    if (!Number.isInteger(rate) || rate < 0 || rate > 10000) throw bad('invalidpercent', 'Rate is in hundredths of a percent, 0 to 10000 (1800 = 18%).', 'rate_hundredths');
    const from = input.effective_from;
    if (!isDate(from)) throw bad('invaliddate', 'Start date must be YYYY-MM-DD.', 'effective_from');
    if (from < clock.todayIST()) throw bad('pastdate', 'A new tax rate starts today or later; past invoices keep their rate.', 'effective_from');
    let id;
    await knex.transaction(async (trx) => {
      if (await trx('bill_tax_rate').where({ effective_from: from }).first()) throw conflict('taxexists', 'There is already a tax rate from that date.');
      const [row] = await trx('bill_tax_rate').insert({ tax_name: name, rate_hundredths: rate, effective_from: from, ...stamp(actor) }).returning('id');
      id = row?.id ?? row;
      await audit.record({ actor, action: 'tax.add', entity: 'tax_rate', entityId: id, newValue: { tax_name: name, rate_hundredths: rate, effective_from: from }, reason }, trx);
    });
    return listTaxRates();
  }

  // ── Coupons ────────────────────────────────────────────────────────────────
  const couponShape = (c) => ({ ...c, code: c.code, discount_value: Number(c.discount_value), redemptions: Number(c.redemptions), max_redemptions: c.max_redemptions == null ? null : Number(c.max_redemptions), active: bool(c.active) });
  async function listCoupons() { return (await knex('bill_coupon').orderBy('id', 'desc')).map(couponShape); }
  function cleanCouponValue(type, raw) {
    if (!DISCOUNT_TYPES.includes(type)) throw bad('invalidtype', 'Discount type must be PERCENT or FIXED.', 'discount_type');
    const v = int(raw);
    if (!Number.isInteger(v) || v <= 0) throw bad('invalidamount', 'The discount must be more than 0.', 'discount_value');
    if (type === 'PERCENT' && v > 10000) throw bad('invalidpercent', 'A percent discount is in hundredths, at most 10000 (100%).', 'discount_value');
    if (type === 'FIXED' && v > MAX_MONEY_MINOR) throw bad('invalidamount', 'That discount is too large.', 'discount_value');
    return v;
  }
  function cleanCouponDates(from, to) {
    if (from != null && from !== '' && !isDate(from)) throw bad('invaliddate', 'Dates must be YYYY-MM-DD.', 'valid_from');
    if (to != null && to !== '' && !isDate(to)) throw bad('invaliddate', 'Dates must be YYYY-MM-DD.', 'valid_to');
    if (from && to && to < from) throw bad('invaliddate', 'The end date is before the start date.', 'valid_to');
    return { valid_from: from || null, valid_to: to || null };
  }
  function cleanMax(raw) {
    if (raw == null || raw === '') return null;
    const v = int(raw);
    if (!Number.isInteger(v) || v < 1) throw bad('invalidmax', 'Maximum uses must be a whole number from 1, or empty for no limit.', 'max_redemptions');
    return v;
  }
  async function createCoupon(actor, input = {}) {
    const code = String(input.code || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,39}$/.test(code)) throw bad('invalidcode', 'Coupon code: 3–40 letters, digits, - or _.', 'code');
    const value = cleanCouponValue(input.discount_type, input.discount_value);
    const row = {
      code, discount_type: input.discount_type, discount_value: value, ...cleanCouponDates(input.valid_from, input.valid_to),
      max_redemptions: cleanMax(input.max_redemptions), redemptions: 0, active: input.active === undefined ? true : bool(input.active),
      description: text(input.description, 200, 'description'), ...stamp(actor),
    };
    let id;
    await knex.transaction(async (trx) => {
      if (await trx('bill_coupon').whereRaw('lower(code) = ?', [code]).first()) throw conflict('couponexists', 'That coupon code is already used.');
      const [r] = await trx('bill_coupon').insert(row).returning('id');
      id = r?.id ?? r;
      await audit.record({ actor, action: 'coupon.create', entity: 'coupon', entityId: id, newValue: { ...row, created_at: undefined, updated_at: undefined } }, trx);
    });
    return couponShape(await knex('bill_coupon').where({ id }).first());
  }
  // Type and value can change only while nobody has used the coupon; dates, limit, active and description any time
  async function updateCoupon(actor, id, input = {}) {
    const old = await knex('bill_coupon').where({ id }).first();
    if (!old) throw notFound('No such coupon.');
    const patch = {};
    if (input.discount_type !== undefined || input.discount_value !== undefined) {
      if (Number(old.redemptions) > 0) throw conflict('couponused', 'This coupon has been used, so its discount can’t change. Make a new coupon instead.');
      const type = input.discount_type ?? old.discount_type;
      patch.discount_type = type;
      patch.discount_value = cleanCouponValue(type, input.discount_value ?? old.discount_value);
    }
    if (input.valid_from !== undefined || input.valid_to !== undefined) Object.assign(patch, cleanCouponDates(input.valid_from !== undefined ? input.valid_from : old.valid_from, input.valid_to !== undefined ? input.valid_to : old.valid_to));
    if (input.max_redemptions !== undefined) {
      patch.max_redemptions = cleanMax(input.max_redemptions);
      if (patch.max_redemptions !== null && patch.max_redemptions < Number(old.redemptions)) throw bad('invalidmax', `It has already been used ${old.redemptions} times.`, 'max_redemptions');
    }
    if (input.active !== undefined) patch.active = bool(input.active);
    if (input.description !== undefined) patch.description = text(input.description, 200, 'description');
    if (input.code !== undefined && String(input.code).toLowerCase() !== old.code) throw bad('codeimmutable', 'A coupon code can’t change.', 'code');
    await knex.transaction(async (trx) => {
      await trx('bill_coupon').where({ id }).update({ ...patch, updated_at: clock.now(), updated_by: actor });
      await audit.record({ actor, action: 'coupon.update', entity: 'coupon', entityId: id, oldValue: couponShape(old), newValue: patch }, trx);
    });
    return couponShape(await knex('bill_coupon').where({ id }).first());
  }

  // ── Quote preview (what a period on a plan would cost; nothing is stored) ──
  async function previewQuote(input = {}) {
    const date = input.period_start || clock.todayIST();
    if (!isDate(date)) throw bad('invaliddate', 'Start date must be YYYY-MM-DD.', 'period_start');
    const model = input.pricing_model || 'PER_ACCOUNT';
    if (!PRICING_MODELS.includes(model)) throw bad('invalidmodel', 'Unknown pricing model.', 'pricing_model');
    const cycle = input.billing_cycle || 'MONTHLY';
    if (model !== 'ONE_TIME' && !CYCLES.includes(cycle)) throw bad('invalidcycle', 'Unknown billing cycle.', 'billing_cycle');
    const price = await priceOn(input.plan_code, model, date);
    if (!price) throw bad('noprice', 'This plan has no price for that model on that date.', 'plan_code');
    const quantity = model === 'PER_UNIT' ? int(input.quantity ?? 1) : 1;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) throw bad('invalidamount', 'Quantity must be a whole number.', 'quantity');
    const cd = model === 'ONE_TIME' ? null : await knex('bill_cycle_discount').where({ billing_cycle: cycle }).first();
    let coupon = null;
    if (input.coupon_code) {
      const c = await knex('bill_coupon').whereRaw('lower(code) = ?', [String(input.coupon_code).trim().toLowerCase()]).first();
      const ok = c && bool(c.active) && (!c.valid_from || c.valid_from <= date) && (!c.valid_to || c.valid_to >= date)
        && (c.max_redemptions == null || Number(c.redemptions) < Number(c.max_redemptions));
      if (!ok) throw bad('invalidcoupon', 'That coupon isn’t valid on that date.', 'coupon_code');
      coupon = { type: c.discount_type, value: Number(c.discount_value) };
    }
    const tax = await taxOn(clock.todayIST());
    let customMonths;
    if (cycle === 'CUSTOM') customMonths = int(input.custom_cycle_months);
    try {
      return calc.quote({
        model, cycle, customMonths, unitPriceMinor: Number(price.unit_price_minor), quantity,
        cycleDiscountHundredths: Number(cd?.discount_hundredths || 0), accountDiscount: null, coupon,
        taxName: tax?.tax_name || 'GST', taxRateHundredths: Number(tax?.rate_hundredths || 0), periodStart: date,
      });
    } catch (e) {
      if (['invalidcycle', 'invalidamount'].includes(e.message)) throw bad(e.message, 'Check the cycle and quantity.', 'billing_cycle');
      throw e;
    }
  }

  return {
    listPlans, getPlan, createPlan, updatePlan, clonePlan, revisions, featuresOf, limitsOf,
    listPrices, addPrice, priceOn, listCycleDiscounts, setCycleDiscount, listTaxRates, addTaxRate, taxOn,
    listCoupons, createCoupon, updateCoupon, previewQuote,
  };
}

module.exports = { makeCatalogue };
