// Repeating schedules: services/recurrence.js + scheduledRepo series
const { occurrences } = require('../services/recurrence');
const { makeTestKnex } = require('./helpers/db');

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = (d) => `${d.getHours()}:${d.getMinutes()}`;

describe('occurrences()', () => {
  const start = new Date(2026, 10, 3, 9, 30); // Tue 3 Nov 2026, 09:30 local

  test('daily × 5 keeps the time of day', () => {
    const { dates } = occurrences(start, { every: 'daily', count: 5 });
    expect(dates.map(ymd)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(new Set(dates.map(hm))).toEqual(new Set(['9:30']));
  });

  test('weekly until an end date (inclusive of that day)', () => {
    const { dates } = occurrences(start, { every: 'weekly', until: '2026-11-24' });
    expect(dates.map(ymd)).toEqual(['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
  });

  test('monthly on the 31st uses the last day of shorter months, then returns to the 31st', () => {
    const { dates } = occurrences(new Date(2027, 0, 31, 10, 0), { every: 'monthly', count: 4 });
    expect(dates.map(ymd)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });

  test('monthly crosses the year end', () => {
    const { dates } = occurrences(new Date(2026, 10, 15, 8, 0), { every: 'monthly', count: 3 });
    expect(dates.map(ymd)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });

  test('clear errors for bad input', () => {
    expect(occurrences(start, { every: 'hourly', count: 3 }).error).toMatch(/daily, weekly or monthly/);
    expect(occurrences(start, { every: 'daily', count: 1 }).error).toMatch(/at least 2/);
    expect(occurrences(start, { every: 'daily', count: 400 }).error).toMatch(/up to 365/);
    expect(occurrences(start, { every: 'daily', until: '2026-11-01' }).error).toMatch(/before the first post/);
    expect(occurrences(start, { every: 'weekly', until: '2026-11-05' }).error).toMatch(/only one post/);
    expect(occurrences(start, { every: 'daily', until: '2029-01-01' }).error).toMatch(/2 years/);
  });
});

describe('scheduledRepo series', () => {
  let knex, repo, wsId;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    const org = await knex('organizations').insert({ name: 'Org', owner_user_id: 1 }).returning('id');
    const ws = await knex('workspaces').insert({ org_id: org[0]?.id ?? org[0], name: 'WS', slug: 'ws-series' }).returning('id');
    wsId = ws[0]?.id ?? ws[0];
    repo = require('../repos/scheduledRepo')(knex);
  });
  afterAll(() => knex.destroy());

  test('saves one calendar post per date, and Stop series removes only the upcoming ones', async () => {
    const start = new Date(Date.now() + 3600 * 1000);
    const { dates } = occurrences(start, { every: 'daily', count: 4 });
    const seriesId = await repo.saveSeries(wsId, 1, { content: 'Daily tip', platforms: ['linkedin'] }, dates, 'daily');

    const items = await knex('content_items').where({ series_id: seriesId }).orderBy('series_index');
    expect(items).toHaveLength(4);
    expect(items.map(i => i.series_index)).toEqual([1, 2, 3, 4]);
    expect(items.every(i => i.status === 'scheduled' && i.series_total === 4 && i.series_every === 'daily')).toBe(true);

    const queue = await repo.listPending(wsId);
    expect(queue.filter(q => q.series_id === seriesId)).toHaveLength(4);

    // first one already went out
    await knex('content_items').where({ id: items[0].id }).update({ status: 'published' });
    const removed = await repo.stopSeries(wsId, seriesId);
    expect(removed).toBe(3);
    expect((await knex('content_items').where({ series_id: seriesId })).map(i => i.status)).toEqual(['published']);
  });

  test('another workspace cannot stop the series', async () => {
    const { dates } = occurrences(new Date(Date.now() + 3600 * 1000), { every: 'weekly', count: 2 });
    const seriesId = await repo.saveSeries(wsId, 1, { content: 'Weekly', platforms: ['facebook'] }, dates, 'weekly');
    expect(await repo.stopSeries(wsId + 999, seriesId)).toBe(0);
    expect(await knex('content_items').where({ series_id: seriesId })).toHaveLength(2);
  });
});
