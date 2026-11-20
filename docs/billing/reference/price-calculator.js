// Reference implementation of the pure billing maths from docs/billing/REQUIREMENTS.md (sections 5.4, 5.5, 5.9).
// No database, no clock, no framework: copy it to modules/billing/domain/ and keep it that way.
// Money is INTEGER MINOR UNITS (paise). Percentages are integer hundredths (1800 = 18.00%).
// Dates are 'YYYY-MM-DD' strings in IST. Run the self-test: node docs/billing/reference/price-calculator.js

const CYCLE_MONTHS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, ANNUAL: 12 };

// Half-up rounding for non-negative integers: round(a * b / c)
const mulDiv = (a, b, c) => Math.floor((a * b * 2 + c) / (2 * c));
const pct = (amount, hundredths) => mulDiv(amount, hundredths, 10000);

function monthsOf(cycle, customMonths) {
  if (cycle === 'CUSTOM') {
    if (!Number.isInteger(customMonths) || customMonths < 1) throw new Error('invalidcycle');
    return customMonths;
  }
  if (!CYCLE_MONTHS[cycle]) throw new Error('invalidcycle');
  return CYCLE_MONTHS[cycle];
}

// ---------- dates (IST calendar dates as strings; no timezone maths needed) ----------
const pad = (n) => String(n).padStart(2, '0');
const parse = (d) => { const [y, m, day] = d.split('-').map(Number); return { y, m, d: day }; };
const fmt = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// start + n months, keeping the anchor day (Jan 31 -> Feb 28/29 -> Mar 31), minus one day (periods are inclusive)
function periodEnd(startDate, months, anchorDay) {
  const s = parse(startDate);
  const anchor = anchorDay || s.d;
  const total = s.y * 12 + (s.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const next = { y, m, d: Math.min(anchor, daysInMonth(y, m)) };
  return addDays(fmt(next), -1);
}

function addDays(date, n) {
  const { y, m, d } = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const daysBetweenInclusive = (a, b) => {
  const pa = parse(a); const pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000) + 1;
};

// Financial year (April to March) of an IST date: '2027-03-31' -> '2026-27', '2027-04-01' -> '2027-28'
function financialYear(date) {
  const { y, m } = parse(date);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${pad((start + 1) % 100)}`;
}

// ---------- the quote (section 5.5) ----------
// input: {
//   model: 'PER_UNIT'|'PER_ACCOUNT'|'ONE_TIME', cycle, customMonths, unitPriceMinor, quantity,
//   cycleDiscountHundredths, accountDiscount: {type:'PERCENT'|'FIXED', value}|null  (PERCENT value in hundredths, FIXED in minor units),
//   coupon: {type, value}|null, taxName, taxRateHundredths, periodStart
// }
function quote(i) {
  const oneTime = i.model === 'ONE_TIME';
  const months = oneTime ? 1 : monthsOf(i.cycle, i.customMonths);
  const qty = i.model === 'PER_UNIT' ? i.quantity : 1;
  if (!Number.isInteger(i.unitPriceMinor) || i.unitPriceMinor < 0) throw new Error('invalidamount');
  if (!Number.isInteger(qty) || qty < 0) throw new Error('invalidamount');

  const base = oneTime ? i.unitPriceMinor : i.unitPriceMinor * qty * months;
  const lines = [{ type: 'CHARGE', description: oneTime ? 'One-time charge' : `${qty} x ${months} month(s)`, qty, unit_price_minor: i.unitPriceMinor, amount_minor: base }];
  const discounts = [];
  let remaining = base;

  const take = (label, amount) => {
    const a = Math.min(Math.max(0, amount), remaining); // never more than what is left
    if (a > 0) { discounts.push({ label, amount_minor: a }); lines.push({ type: 'DISCOUNT', description: label, qty: 1, unit_price_minor: a, amount_minor: -a }); remaining -= a; }
  };

  if (!oneTime && i.cycleDiscountHundredths) take('Cycle discount', pct(remaining, i.cycleDiscountHundredths));
  if (i.accountDiscount) take('Account discount', i.accountDiscount.type === 'PERCENT' ? pct(remaining, i.accountDiscount.value) : i.accountDiscount.value);
  if (i.coupon) take('Coupon', i.coupon.type === 'PERCENT' ? pct(remaining, i.coupon.value) : i.coupon.value);

  const taxable = Math.max(0, remaining);
  const tax = pct(taxable, i.taxRateHundredths || 0);
  if (tax > 0) lines.push({ type: 'TAX', description: `${i.taxName || 'Tax'} ${(i.taxRateHundredths / 100).toFixed(2)}%`, qty: 1, unit_price_minor: tax, amount_minor: tax });

  const total = taxable + tax;
  const sum = lines.reduce((s, l) => s + l.amount_minor, 0);
  if (sum !== total) throw new Error('quote lines do not add up to the total'); // the invariant that protects every invoice

  const period_end = oneTime ? i.periodStart : periodEnd(i.periodStart, months);
  return { lines, base, discounts, taxable, tax_name: i.taxName || 'Tax', tax_rate_hundredths: i.taxRateHundredths || 0, tax, total, period_start: i.periodStart, period_end, qty, months };
}

// ---------- upgrade proration (section 5.4): pay only the difference ----------
// rates in minor units per unit-month; remaining days count today and the last day
function upgradeAmount({ currentRateMinor, newRateMinor, quantity, months, today, paidUntil, periodStart, taxRateHundredths = 0 }) {
  const totalDays = daysBetweenInclusive(periodStart, paidUntil);
  const remainingDays = Math.max(0, daysBetweenInclusive(today, paidUntil));
  const raw = mulDiv((newRateMinor - currentRateMinor) * quantity * months, remainingDays, totalDays);
  const net = Math.max(100, raw); // at least INR 1
  const tax = pct(net, taxRateHundredths);
  return { net, tax, total: net + tax, totalDays, remainingDays };
}

// ---------- monthly allowance (section 5.9) ----------
// included = clamp(perUnit * units + perAccount, min, max); an active override replaces the formula
function allowance({ perUnitPerMonth = 0, perAccountPerMonth = 0, minPerMonth = 0, maxPerMonth = null, units = 0, override = null }) {
  if (override !== null && override !== undefined) return Math.max(0, override);
  let v = perUnitPerMonth * units + perAccountPerMonth;
  v = Math.max(v, minPerMonth);
  if (maxPerMonth !== null && maxPerMonth !== undefined) v = Math.min(v, maxPerMonth);
  return Math.max(0, v);
}

// remaining balance for a metering period: server figures only
function remaining({ planIncluded, used, grants = [] }) {
  const plan = Math.max(0, planIncluded - used);
  return plan + grants.reduce((s, g) => s + Math.max(0, g.quantity - g.consumed), 0);
}

module.exports = { quote, periodEnd, addDays, daysBetweenInclusive, financialYear, upgradeAmount, allowance, remaining, monthsOf, pct, mulDiv };

// ---------- self-test ----------
if (require.main === module) {
  const assert = require('assert');
  const eq = (a, b, m) => assert.deepStrictEqual(a, b, m);

  // periods are inclusive and keep the anchor day
  eq(periodEnd('2026-01-01', 1), '2026-01-31');
  eq(periodEnd('2026-01-31', 1, 31), '2026-02-27'); // Feb 28 start of next period minus one day
  eq(periodEnd('2028-01-31', 1, 31), '2028-02-28'); // leap year: next period starts 29 Feb
  eq(periodEnd('2026-04-01', 12), '2027-03-31');
  eq(periodEnd('2026-12-15', 3), '2027-03-14');

  // financial year rollover on 1 April
  eq(financialYear('2027-03-31'), '2026-27');
  eq(financialYear('2027-04-01'), '2027-28');

  // simple per-unit quote, no discount, no tax
  let q = quote({ model: 'PER_UNIT', cycle: 'MONTHLY', unitPriceMinor: 127500, quantity: 2, periodStart: '2026-11-01', taxName: 'GST', taxRateHundredths: 0 });
  eq(q.total, 255000); eq(q.period_end, '2026-11-30');

  // stacking order: cycle 15%, account 10%, coupon fixed 5000, tax 18%
  q = quote({ model: 'PER_UNIT', cycle: 'ANNUAL', unitPriceMinor: 100000, quantity: 1, cycleDiscountHundredths: 1500,
    accountDiscount: { type: 'PERCENT', value: 1000 }, coupon: { type: 'FIXED', value: 5000 }, periodStart: '2026-04-01', taxName: 'GST', taxRateHundredths: 1800 });
  // base 1,200,000; cycle 15% = 180,000 -> 1,020,000; account 10% = 102,000 -> 918,000; coupon 5,000 -> 913,000; tax 18% = 164,340
  eq(q.base, 1200000); eq(q.taxable, 913000); eq(q.tax, 164340); eq(q.total, 1077340); eq(q.period_end, '2027-03-31');

  // taxable never below zero; discounts capped at what is left
  q = quote({ model: 'ONE_TIME', unitPriceMinor: 10000, coupon: { type: 'FIXED', value: 999999 }, periodStart: '2026-11-01', taxRateHundredths: 1800 });
  eq(q.taxable, 0); eq(q.tax, 0); eq(q.total, 0);

  // half-up rounding of tax: 18% of 1,005 = 180.9 -> 181
  q = quote({ model: 'ONE_TIME', unitPriceMinor: 1005, periodStart: '2026-11-01', taxRateHundredths: 1800 });
  eq(q.tax, 181);

  // lines always add up to the total
  q = quote({ model: 'PER_ACCOUNT', cycle: 'QUARTERLY', unitPriceMinor: 99900, cycleDiscountHundredths: 500, periodStart: '2026-07-01', taxRateHundredths: 1800, taxName: 'GST' });
  eq(q.lines.reduce((s, l) => s + l.amount_minor, 0), q.total);

  // upgrade proration worked example from the requirements: 100 units, 12 months, 184 days left of 365
  const u = upgradeAmount({ currentRateMinor: 1500, newRateMinor: 1600, quantity: 100, months: 12, today: '2026-10-01', paidUntil: '2027-03-31', periodStart: '2026-04-01' });
  eq(u.totalDays, 365); eq(u.remainingDays, 182);
  // 182 days from 1 Oct to 31 Mar inclusive; the document's example uses 184 remaining days: check the formula with those numbers directly
  eq(mulDiv(100 * 100 * 12, 184, 365), 60493);

  // allowance: per-unit with clamp and override
  eq(allowance({ perUnitPerMonth: 10, units: 120 }), 1200);
  eq(allowance({ perUnitPerMonth: 10, units: 3, minPerMonth: 50 }), 50);
  eq(allowance({ perUnitPerMonth: 10, units: 500, maxPerMonth: 1000 }), 1000);
  eq(allowance({ perUnitPerMonth: 10, units: 500, override: 25 }), 25);
  eq(remaining({ planIncluded: 100, used: 130, grants: [{ quantity: 50, consumed: 20 }] }), 30);

  console.log('price-calculator reference: all checks passed');
}
