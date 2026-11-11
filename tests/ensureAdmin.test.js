// Upgraded installs without an admin, and accounts saved without a login token.
const { makeTestKnex } = require('./helpers/db');
const ensureAdmin = require('../services/ensureAdmin');

describe('ensureAdmin', () => {
  let knex;
  beforeEach(async () => {
    knex = makeTestKnex();
    await knex.migrate.latest();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => { console.log.mockRestore(); await knex.destroy(); });

  const add = (email, extra = {}) => knex('users').insert({ email, password_hash: 'h', role: 'user', ...extra });
  const roles = async () => Object.fromEntries((await knex('users').select('email', 'role')).map(u => [u.email, u.role]));

  const idOf = async (email) => (await knex('users').where({ email }).first('id')).id;

  test('the owner of the first organization becomes admin, not an older test account', async () => {
    await add('test@dev.test');
    await add('owner@shop.test');
    await knex('organizations').insert({ name: 'Shop', owner_user_id: await idOf('owner@shop.test') });
    expect((await ensureAdmin(knex)).email).toBe('owner@shop.test');
    expect(await roles()).toEqual({ 'test@dev.test': 'user', 'owner@shop.test': 'admin' });
  });

  test('without an organization owner, the most recently active account', async () => {
    await add('old@shop.test', { last_active: 1000 });
    await add('owner@shop.test', { last_active: 9000 });
    await add('never@shop.test');
    expect((await ensureAdmin(knex)).email).toBe('owner@shop.test');
  });

  test('skips suspended accounts', async () => {
    await add('gone@shop.test', { status: 'suspended', last_active: 9999 });
    await add('owner@shop.test');
    expect((await ensureAdmin(knex)).email).toBe('owner@shop.test');
  });

  test('runs only once: an install that later has no admin is not changed silently', async () => {
    await add('owner@shop.test');
    await ensureAdmin(knex);
    await knex('users').update({ role: 'user' });
    expect(await ensureAdmin(knex)).toBeNull();
    expect((await roles())['owner@shop.test']).toBe('user');
  });

  test('changes nothing when an admin already exists; a fresh install is checked again later', async () => {
    expect(await ensureAdmin(knex)).toBeNull(); // no users yet
    await add('a@shop.test');
    await add('boss@shop.test', { role: 'admin' });
    expect(await ensureAdmin(knex)).toBeNull();
    expect(await roles()).toEqual({ 'a@shop.test': 'user', 'boss@shop.test': 'admin' });
  });
});

describe('social accounts without a login token', () => {
  let knex;
  beforeAll(async () => { knex = makeTestKnex(); await knex.migrate.latest(); });
  afterAll(() => knex.destroy());

  test('are listed as not usable (shown as "Sign in again")', async () => {
    const repo = require('../repos/socialAccountsRepo')(knex);
    const org = await knex('organizations').insert({ name: 'O', owner_user_id: 1 }).returning('id');
    const ws = await knex('workspaces').insert({ org_id: org[0]?.id ?? org[0], name: 'W', slug: 'w', timezone: 'UTC' }).returning('id');
    const wsId = ws[0]?.id ?? ws[0];
    await repo.add(wsId, { platform: 'facebook', external_id: 'fb1', page_id: '123' }); // no token
    await repo.add(wsId, { platform: 'linkedin', external_id: 'li1', access_token: 'tok' });
    const list = await repo.list(wsId);
    expect(list.find(a => a.platform === 'facebook').usable).toBe(false);
    expect(list.find(a => a.platform === 'linkedin').usable).toBe(true);
  });
});
