// Monthly client report
const { makeTestKnex } = require('./helpers/db');
const reports = require('../services/reports');

test('totals, per-platform numbers and best posts for the month; text is escaped', async () => {
  const knex = makeTestKnex();
  try {
    await knex.migrate.latest();
    const [o] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const [w] = await knex('workspaces').insert({ org_id: o?.id ?? o, name: 'Chai Point', slug: 'cp' }).returning('id');
    const ws = w?.id ?? w;
    const oct = Math.floor(Date.UTC(2026, 9, 10) / 1000);
    const add = async (content, results, at = oct) => {
      const [r] = await knex('posts').insert({ workspace_id: ws, user_id: 1, content, platforms: '[]', results: JSON.stringify(results), status: 'published', created_at: at }).returning('id');
      return r?.id ?? r;
    };
    const a = await add('Diwali offer <b>20%</b>', [{ platform: 'facebook', success: true, id: '1' }, { platform: 'instagram', success: true, id: '2' }]);
    await add('Plain post', [{ platform: 'facebook', success: true, id: '3' }]);
    await add('September post', [{ platform: 'facebook', success: true, id: '4' }], Math.floor(Date.UTC(2026, 8, 10) / 1000));
    await knex('analytics').insert([
      { workspace_id: ws, post_id: a, platform: 'facebook', likes: 10, comments: 2, shares: 1, impressions: 500, clicks: 0 },
      { workspace_id: ws, post_id: a, platform: 'instagram', likes: 30, comments: 5, shares: 0, impressions: 900, clicks: 0 },
    ]);
    await knex('brand_kit').insert({ workspace_id: ws, company_name: 'Chai Point Cafe', primary_color: '#aa3300' });

    const d = await reports.monthlyData(knex, ws, '2026-10');
    expect(d.totals).toMatchObject({ posts: 2, likes: 40, comments: 7, impressions: 1400 });
    expect(d.byPlatform.facebook.posts).toBe(2);
    expect(d.top[0].id).toBe(a);

    const html = reports.renderHtml(d);
    expect(html).toContain('Chai Point Cafe');
    expect(html).toContain('October 2026');
    expect(html).toContain('&lt;b&gt;20%&lt;/b&gt;');
    expect(html).not.toContain('<b>20%</b>');
    await expect(reports.monthlyData(knex, ws, 'oct')).rejects.toThrow(/Choose a month/);
  } finally { await knex.destroy(); }
});
