const { makeTestKnex } = require('./helpers/db');

describe('repos workspace isolation', () => {
  let knex, social, ws;
  beforeAll(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    ws = require('../repos/workspacesRepo')(knex);
    social = require('../repos/socialAccountsRepo')(knex);
  });
  afterAll(async () => { await knex.destroy(); });

  test('social accounts are isolated per workspace', async () => {
    const org = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const orgId = org[0].id ?? org[0];
    const a = await ws.create({ orgId, name: 'A', slug: 'a' });
    const b = await ws.create({ orgId, name: 'B', slug: 'b' });
    await social.add(a.id, { platform: 'x', external_id: '1', account_label: 'A-x', access_token: 't' });
    await social.add(b.id, { platform: 'x', external_id: '2', account_label: 'B-x', access_token: 't' });

    const aAccts = await social.list(a.id);
    const bAccts = await social.list(b.id);
    expect(aAccts).toHaveLength(1);
    expect(aAccts[0].account_label).toBe('A-x');
    expect(bAccts).toHaveLength(1);
    expect(bAccts.find(x => x.account_label === 'A-x')).toBeUndefined();
  });

  test('multiple accounts per platform per workspace', async () => {
    const org = await knex('organizations').insert({ name: 'O2', owner_user_id: 1 }).returning('id');
    const orgId = org[0].id ?? org[0];
    const c = await ws.create({ orgId, name: 'C', slug: 'c' });
    await social.add(c.id, { platform: 'fb', external_id: '10', account_label: 'Main', access_token: 't' });
    await social.add(c.id, { platform: 'fb', external_id: '11', account_label: 'Support', access_token: 't' });
    expect(await social.list(c.id)).toHaveLength(2);
  });
});
