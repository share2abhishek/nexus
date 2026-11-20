// The pure billing maths from docs/billing/REQUIREMENTS.md (sections 5.4, 5.5, 5.9), copied from
// docs/billing/reference/price-calculator.js. No database, no clock, no framework: keep it that way.
// Tests: tests/billing/priceCalculator.test.js
// Money is INTEGER MINOR UNITS (paise). Percentages are integer hundredths (1800 = 18.00%).
// Dates are 'YYYY-MM-DD' strings in IST. 

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

module.exports = { CYCLE_MONTHS, quote, periodEnd, addDays, daysBetweenInclusive, financialYear, upgradeAmount, allowance, remaining, monthsOf, pct, mulDiv };

// An epoch-seconds timestamp as the IST calendar date it falls on ('YYYY-MM-DD'); null stays null
function istDate(epochSeconds) {
  if (epochSeconds === null || epochSeconds === undefined || epochSeconds === '') return null;
  const n = Number(epochSeconds);
  if (!Number.isFinite(n)) return null;
  return new Date((n + 19800) * 1000).toISOString().slice(0, 10); // IST = UTC + 5:30
}

module.exports.istDate = istDate;
