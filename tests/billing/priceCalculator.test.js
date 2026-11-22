// B0: the pure billing maths (modules/billing/domain/price-calculator.js; REQUIREMENTS 5.4, 5.5, 5.9, 14).
// Every pricing model x every cycle x discount stacking, tax 0% and 18%, half-up rounding, period edges, leap years, FY.
const c = require('../../modules/billing/domain/price-calculator');

const CYCLES = [['MONTHLY', 1], ['QUARTERLY', 3], ['HALF_YEARLY', 6], ['ANNUAL', 12], ['CUSTOM', 5]];
const sum = (q) => q.lines.reduce((s, l) => s + l.amount_minor, 0);

describe('quote: every model x cycle x discount, tax 0% and 18%', () => {
  const discounts = [
    ['none', {}],
    ['cycle 15%', { cycleDiscountHundredths: 1500 }],
    ['account 10%', { accountDiscount: { type: 'PERCENT', value: 1000 } }],
    ['account fixed ₹50', { accountDiscount: { type: 'FIXED', value: 5000 } }],
    ['coupon 12.5%', { coupon: { type: 'PERCENT', value: 1250 } }],
    ['coupon fixed ₹99', { coupon: { type: 'FIXED', value: 9900 } }],
    ['all three', { cycleDiscountHundredths: 1500, accountDiscount: { type: 'PERCENT', value: 1000 }, coupon: { type: 'FIXED', value: 5000 } }],
  ];
  for (const model of ['PER_UNIT', 'PER_ACCOUNT', 'ONE_TIME']) {
    for (const [cycle, months] of CYCLES) {
      for (const [label, d] of discounts) {
        for (const tax of [0, 1800]) {
          test(`${model} ${cycle} ${label} tax ${tax / 100}%`, () => {
            const q = c.quote({ model, cycle, customMonths: cycle === 'CUSTOM' ? months : undefined, unitPriceMinor: 127500, quantity: 3,
              periodStart: '2026-04-01', taxName: 'GST', taxRateHundredths: tax, ...d });
            const qty = model === 'PER_UNIT' ? 3 : 1;
            const m = model === 'ONE_TIME' ? 1 : months;
            expect(q.base).toBe(model === 'ONE_TIME' ? 127500 : 127500 * qty * m);
            expect(sum(q)).toBe(q.total); // lines always add up
            expect(q.taxable).toBe(q.base - q.discounts.reduce((s, x) => s + x.amount_minor, 0));
            expect(q.tax).toBe(c.mulDiv(q.taxable, tax, 10000));
            expect(q.total).toBe(q.taxable + q.tax);
            for (const v of [q.base, q.taxable, q.tax, q.total, ...q.lines.map((l) => l.amount_minor)]) expect(Number.isInteger(v)).toBe(true);
            if (model === 'ONE_TIME') expect(q.discounts.find((x) => x.label === 'Cycle discount')).toBeUndefined();
          });
        }
      }
    }
  }
});

test('stacking order is cycle, then account, then coupon, each on what remains', () => {
  const q = c.quote({ model: 'PER_UNIT', cycle: 'ANNUAL', unitPriceMinor: 100000, quantity: 1, cycleDiscountHundredths: 1500,
    accountDiscount: { type: 'PERCENT', value: 1000 }, coupon: { type: 'FIXED', value: 5000 }, periodStart: '2026-04-01', taxName: 'GST', taxRateHundredths: 1800 });
  expect(q.discounts.map((d) => [d.label, d.amount_minor])).toEqual([['Cycle discount', 180000], ['Account discount', 102000], ['Coupon', 5000]]);
  expect([q.base, q.taxable, q.tax, q.total]).toEqual([1200000, 913000, 164340, 1077340]);
});

test('discounts never take the bill below zero, and tax is never charged on nothing', () => {
  const q = c.quote({ model: 'ONE_TIME', unitPriceMinor: 10000, accountDiscount: { type: 'FIXED', value: 6000 }, coupon: { type: 'FIXED', value: 999999 }, periodStart: '2026-11-01', taxRateHundredths: 1800 });
  expect(q.discounts.map((d) => d.amount_minor)).toEqual([6000, 4000]);
  expect([q.taxable, q.tax, q.total]).toEqual([0, 0, 0]);
  expect(c.quote({ model: 'PER_ACCOUNT', cycle: 'MONTHLY', unitPriceMinor: 0, periodStart: '2026-11-01', taxRateHundredths: 1800 }).total).toBe(0);
});

test('rounding is half-up, once per line', () => {
  expect(c.quote({ model: 'ONE_TIME', unitPriceMinor: 1005, periodStart: '2026-11-01', taxRateHundredths: 1800 }).tax).toBe(181); // 180.9
  expect(c.quote({ model: 'ONE_TIME', unitPriceMinor: 25, periodStart: '2026-11-01', taxRateHundredths: 1800 }).tax).toBe(5); // 4.5 -> 5
  expect(c.quote({ model: 'ONE_TIME', unitPriceMinor: 24, periodStart: '2026-11-01', taxRateHundredths: 1800 }).tax).toBe(4); // 4.32
  expect(c.pct(333, 5000)).toBe(167); // 166.5 -> 167
  expect(c.pct(1, 4999)).toBe(0);
});

test('bad input is refused', () => {
  const base = { model: 'PER_UNIT', cycle: 'MONTHLY', unitPriceMinor: 100, quantity: 1, periodStart: '2026-11-01' };
  expect(() => c.quote({ ...base, unitPriceMinor: -1 })).toThrow('invalidamount');
  expect(() => c.quote({ ...base, unitPriceMinor: 1.5 })).toThrow('invalidamount');
  expect(() => c.quote({ ...base, quantity: -2 })).toThrow('invalidamount');
  expect(() => c.quote({ ...base, cycle: 'WEEKLY' })).toThrow('invalidcycle');
  expect(() => c.quote({ ...base, cycle: 'CUSTOM' })).toThrow('invalidcycle');
  expect(() => c.quote({ ...base, cycle: 'CUSTOM', customMonths: 0 })).toThrow('invalidcycle');
});

describe('billing periods', () => {
  test('inclusive, and the anchor day is kept across short months', () => {
    expect(c.periodEnd('2026-01-01', 1)).toBe('2026-01-31');
    expect(c.periodEnd('2026-01-31', 1, 31)).toBe('2026-02-27');
    expect(c.periodEnd('2026-02-28', 1, 31)).toBe('2026-03-30');
    expect(c.periodEnd('2026-04-01', 12)).toBe('2027-03-31');
    expect(c.periodEnd('2026-12-15', 3)).toBe('2027-03-14');
    expect(c.periodEnd('2026-08-31', 6)).toBe('2027-02-27');
  });
  test('leap years', () => {
    expect(c.periodEnd('2028-01-31', 1, 31)).toBe('2028-02-28'); // next period starts 29 Feb
    expect(c.periodEnd('2028-02-29', 12)).toBe('2029-02-27');
    expect(c.daysBetweenInclusive('2028-02-01', '2028-02-29')).toBe(29);
    expect(c.daysBetweenInclusive('2027-02-01', '2027-02-28')).toBe(28);
    expect(c.addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(c.addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
  test('financial year rolls over on 1 April (IST dates)', () => {
    expect(c.financialYear('2027-03-31')).toBe('2026-27');
    expect(c.financialYear('2027-04-01')).toBe('2027-28');
    expect(c.financialYear('2099-12-31')).toBe('2099-00');
  });
  test('epoch seconds to the IST date: 18:29:59 UTC is still today, 18:30 UTC is tomorrow in India', () => {
    expect(c.istDate(Date.UTC(2026, 2, 31, 18, 29, 59) / 1000)).toBe('2026-03-31');
    expect(c.istDate(Date.UTC(2026, 2, 31, 18, 30, 0) / 1000)).toBe('2026-04-01');
    expect(c.istDate(null)).toBeNull();
    expect(c.istDate('x')).toBeNull();
  });
});

test('upgrade proration: the worked example (60493 paise) and the INR 1 minimum', () => {
  expect(c.mulDiv(100 * 100 * 12, 184, 365)).toBe(60493);
  const u = c.upgradeAmount({ currentRateMinor: 1500, newRateMinor: 1600, quantity: 100, months: 12, today: '2026-09-29', paidUntil: '2027-03-31', periodStart: '2026-04-01', taxRateHundredths: 1800 });
  expect([u.totalDays, u.remainingDays, u.net]).toEqual([365, 184, 60493]);
  expect(u.tax).toBe(10889); // 18% of 60493 = 10888.74
  expect(c.upgradeAmount({ currentRateMinor: 1500, newRateMinor: 1501, quantity: 1, months: 1, today: '2026-04-30', paidUntil: '2026-04-30', periodStart: '2026-04-01' }).net).toBe(100);
});

test('allowance: per unit, per account, clamp and override; remaining uses server figures', () => {
  expect(c.allowance({ perUnitPerMonth: 10, units: 120 })).toBe(1200);
  expect(c.allowance({ perUnitPerMonth: 10, perAccountPerMonth: 5, units: 2 })).toBe(25);
  expect(c.allowance({ perUnitPerMonth: 10, units: 3, minPerMonth: 50 })).toBe(50);
  expect(c.allowance({ perUnitPerMonth: 10, units: 500, maxPerMonth: 1000 })).toBe(1000);
  expect(c.allowance({ perUnitPerMonth: 10, units: 500, override: 25 })).toBe(25);
  expect(c.allowance({ override: -5 })).toBe(0);
  expect(c.remaining({ planIncluded: 100, used: 130, grants: [{ quantity: 50, consumed: 20 }] })).toBe(30);
});
