// Calendar views: the date arithmetic behind Day / Week / Month / Year / Agenda.
// The helpers live in the page script (public/js/04-calendar.js) between two markers;
// they are pure, so they are run here exactly as shipped.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '04-calendar.js'), 'utf8').replace(/\r\n/g, '\n');
const block = src.slice(src.indexOf('// <calendar-helpers>'), src.indexOf('// </calendar-helpers>'));
const ctx = vm.createContext({});
vm.runInContext(`${block}\nthis.api = { CAL_VIEWS, addCalendarMonths, calendarRange, shiftCalendarDate, calEventDate };`, ctx);
const { CAL_VIEWS, addCalendarMonths, calendarRange, shiftCalendarDate, calEventDate } = ctx.api;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

describe('calendar views', () => {
  test('there are five views', () => {
    expect(CAL_VIEWS).toEqual(['day', 'week', 'month', 'year', 'agenda']);
  });

  describe('ranges', () => {
    test('day: midnight to the last millisecond, with a full date heading', () => {
      const r = calendarRange('day', D(2026, 11, 16, 15));
      expect(ymd(r.start)).toBe('2026-11-16');
      expect([r.start.getHours(), r.start.getMinutes()]).toEqual([0, 0]);
      expect(ymd(r.end)).toBe('2026-11-16');
      expect([r.end.getHours(), r.end.getMinutes(), r.end.getMilliseconds()]).toEqual([23, 59, 999]);
      expect(r.label).toMatch(/Monday.*November 16, 2026/);
    });

    test('week runs Sunday to Saturday (the one in the screenshot: Nov 15 – Nov 21, 2026)', () => {
      const r = calendarRange('week', D(2026, 11, 18));
      expect([ymd(r.start), ymd(r.end)]).toEqual(['2026-11-15', '2026-11-21']);
      expect(r.label).toBe('Nov 15 – Nov 21, 2026');
    });

    test('a week that crosses the new year names both years', () => {
      const r = calendarRange('week', D(2026, 12, 31));
      expect([ymd(r.start), ymd(r.end)]).toEqual(['2026-12-27', '2027-01-02']);
      expect(r.label).toMatch(/2026.*2027/);
    });

    test('month covers six whole weeks around the month', () => {
      const r = calendarRange('month', D(2026, 11, 16));
      expect(r.start.getDay()).toBe(0);
      expect(ymd(r.start)).toBe('2026-11-01'); // 1 Nov 2026 is a Sunday
      expect(ymd(r.end)).toBe('2026-12-12');
      expect(r.label).toBe('November 2026');
    });

    test('year is 1 Jan to 31 Dec', () => {
      const r = calendarRange('year', D(2026, 6, 15));
      expect([ymd(r.start), ymd(r.end)]).toEqual(['2026-01-01', '2026-12-31']);
      expect(r.label).toBe('2026');
    });

    test('agenda is the whole month, including a leap February', () => {
      expect(ymd(calendarRange('agenda', D(2028, 2, 10)).end)).toBe('2028-02-29');
      expect(calendarRange('agenda', D(2026, 11, 16)).label).toBe('Agenda: November 2026');
    });
  });

  describe('Prev / Next', () => {
    test('day moves one day, across month and year ends', () => {
      expect(ymd(shiftCalendarDate('day', D(2026, 12, 31), 1))).toBe('2027-01-01');
      expect(ymd(shiftCalendarDate('day', D(2026, 3, 1), -1))).toBe('2026-02-28');
    });

    test('week moves seven days', () => {
      expect(ymd(shiftCalendarDate('week', D(2026, 11, 18), 1))).toBe('2026-11-25');
      expect(ymd(shiftCalendarDate('week', D(2026, 11, 18), -1))).toBe('2026-11-11');
    });

    test('month and agenda move one month and never skip one (Jan 31 + 1 = Feb 28)', () => {
      expect(ymd(shiftCalendarDate('month', D(2026, 1, 31), 1))).toBe('2026-02-28');
      expect(ymd(shiftCalendarDate('agenda', D(2026, 3, 31), -1))).toBe('2026-02-28');
      expect(ymd(shiftCalendarDate('month', D(2028, 1, 31), 1))).toBe('2028-02-29');
      expect(ymd(shiftCalendarDate('month', D(2026, 12, 15), 1))).toBe('2027-01-15');
    });

    test('year moves a year, keeping 29 Feb valid', () => {
      expect(ymd(shiftCalendarDate('year', D(2026, 6, 15), 1))).toBe('2027-06-15');
      expect(ymd(shiftCalendarDate('year', D(2028, 2, 29), 1))).toBe('2029-02-28');
      expect(ymd(shiftCalendarDate('year', D(2026, 6, 15), -1))).toBe('2025-06-15');
    });

    test('does not change the date it was given', () => {
      const d = D(2026, 11, 16);
      shiftCalendarDate('month', d, 1); shiftCalendarDate('day', d, 1); shiftCalendarDate('year', d, 1);
      expect(ymd(d)).toBe('2026-11-16');
      expect(ymd(addCalendarMonths(d, 3))).toBe('2027-02-16');
      expect(ymd(d)).toBe('2026-11-16');
    });
  });

  test('a post sits on its scheduled time, otherwise the day it was made', () => {
    const scheduled = Math.floor(D(2026, 11, 20, 9).getTime() / 1000);
    const created = Math.floor(D(2026, 11, 1, 9).getTime() / 1000);
    expect(ymd(calEventDate({ scheduled_at: scheduled, created_at: created }))).toBe('2026-11-20');
    expect(ymd(calEventDate({ scheduled_at: null, created_at: created }))).toBe('2026-11-01');
  });
});
