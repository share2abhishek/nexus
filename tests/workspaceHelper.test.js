jest.mock('../services/knex', () => require('./helpers/db').makeTestKnex());
const knex = require('../services/knex');
const { ensureDefaultWorkspace } = require('../services/workspaceHelper');

describe('ensureDefaultWorkspace', () => {
  beforeAll(async () => { await knex.migrate.latest(); });
  afterAll(async () => { await knex.destroy(); });

  test('concurrent first calls create exactly one workspace and org', async () => {
    const [id] = await knex('users').insert({ email: 'race@example.test', password_hash: 'h', name: "Priya" }).returning('id');
    const userId = id?.id ?? id;

    const results = await Promise.all(Array.from({ length: 5 }, () => ensureDefaultWorkspace(userId)));

    expect(new Set(results).size).toBe(1);
    expect((await knex('memberships').where({ user_id: userId })).length).toBe(1);
    expect((await knex('organizations').where({ owner_user_id: userId })).length).toBe(1);
    const ws = await knex('workspaces').where({ id: results[0] }).first();
    expect(ws.name).toBe("Priya's Workspace");
    expect(ws.timezone).toBe('Asia/Kolkata');
  });

  test('a later call returns the existing workspace', async () => {
    const [id] = await knex('users').insert({ email: 'again@example.test', password_hash: 'h' }).returning('id');
    const userId = id?.id ?? id;
    const first = await ensureDefaultWorkspace(userId);
    expect(await ensureDefaultWorkspace(userId)).toBe(first);
  });
});
