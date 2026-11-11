// Upgrading removes YouTube/TikTok logins and takes them off posts not yet sent
const { makeTestKnex } = require('./helpers/db');
const retire = require('../db/migrations/20261029000001_retire_youtube_tiktok');

test('removes YouTube/TikTok logins and strips them from unsent posts', async () => {
  const knex = makeTestKnex();
  try {
    await knex.migrate.latest();
    const [org] = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const [ws] = await knex('workspaces').insert({ org_id: org?.id ?? org, name: 'W', slug: 'w', timezone: 'UTC' }).returning('id');
    const wsId = ws?.id ?? ws;
    const acc = async (platform) => { const [r] = await knex('social_accounts').insert({ workspace_id: wsId, platform, external_id: platform + '1', access_token: 't' }).returning('id'); return r?.id ?? r; };
    const yt = await acc('youtube'); await acc('tiktok'); const li = await acc('linkedin');
    const item = async (status, platforms, ids = []) => {
      const [r] = await knex('content_items').insert({ workspace_id: wsId, body: 'x', status, platforms: JSON.stringify(platforms), social_account_ids: JSON.stringify(ids) }).returning('id');
      return r?.id ?? r;
    };
    const mixed = await item('scheduled', ['linkedin', 'youtube'], [li, yt]);
    const onlyYt = await item('scheduled', ['youtube']);
    const sent = await item('published', ['youtube']);

    await retire.up(knex);

    expect(await knex('social_accounts').pluck('platform')).toEqual(['linkedin']);
    const get = (id) => knex('content_items').where({ id }).first();
    const m = await get(mixed);
    expect([m.status, JSON.parse(m.platforms), JSON.parse(m.social_account_ids)]).toEqual(['scheduled', ['linkedin'], [li]]);
    const o = await get(onlyYt);
    expect(o.status).toBe('failed');
    expect(o.error_message).toMatch(/not available yet/);
    expect(JSON.parse((await get(sent)).platforms)).toEqual(['youtube']); // history unchanged
  } finally {
    await knex.destroy();
  }
});
