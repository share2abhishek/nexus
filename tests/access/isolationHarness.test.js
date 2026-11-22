// Two-organisation isolation harness (S0, docs/platform/ROADMAP.md; rules in docs/platform/ACCESS-AND-ENTITLEMENTS.md 11).
//
// Organisations A and B, each with an owner and a workspace. Every table that has workspace_id gets one row of B's,
// with id 9001 and a marker text in its text columns. Signed in as A's owner (hosted edition), every route that takes
// an id is called with B's id (9001) for GET, PUT, PATCH, DELETE and POST. Two kinds of leak are detected:
//   read leak   B's marker appears in the response A got
//   write leak  one of B's rows was changed or deleted by A's call
// S0 records what it finds in isolation.baseline.json and fixes nothing; any leak is then fixed straight away (P0).
// The test fails on a leak not in the baseline, and on a baseline entry that no longer leaks (so it only shrinks).
// Regenerate deliberately with:  UPDATE_ISOLATION_BASELINE=1 npx jest tests/access/isolationHarness
// SQLite only: seeding every table generically needs foreign keys switched off for the seed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { makeTestKnex } = require('../helpers/db');

const mockKnex = makeTestKnex();
jest.mock('../../services/knex', () => mockKnex);
// No call may leave the test: stub outbound HTTP and e-mail
jest.mock('axios', () => {
  const fail = () => Promise.reject(Object.assign(new Error('network disabled in the isolation harness'), { code: 'ENETDISABLED' }));
  const ax = Object.assign(fail, { get: fail, post: fail, put: fail, patch: fail, delete: fail, head: fail, request: fail, create: () => ax, isAxiosError: () => false, defaults: { headers: { common: {} } }, interceptors: { request: { use() {} }, response: { use() {} } } });
  return ax;
});
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: async () => { throw new Error('mail disabled in the isolation harness'); }, verify: async () => true }) }));

const BASELINE_FILE = path.join(__dirname, 'isolation.baseline.json');
const B_ID = 9001;
const MARK = 'ORGB_SECRET_7f3a';
const PG = !!process.env.PG_TEST_URL;
const maybe = PG ? test.skip : test;

let app;
let routes;
let seeded = [];
let wsA;
let wsB;

async function columns(table) {
  return mockKnex.raw(`PRAGMA table_info("${table}")`);
}

// One row of B's in every table with workspace_id, filled generically
async function seedB(ids, only = null) {
  const tables = (await mockKnex.raw("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'")).map((t) => t.name);
  await mockKnex.raw('PRAGMA foreign_keys = OFF');
  for (const t of tables) {
    const cols = await columns(t);
    const names = cols.map((c) => c.name);
    if (!names.includes('workspace_id') || !names.includes('id')) continue;
    if (only && !only.includes(t)) continue;
    const row = {};
    for (const c of cols) {
      const type = String(c.type || '').toLowerCase();
      if (c.name === 'id') row.id = B_ID;
      else if (c.name === 'workspace_id') row.workspace_id = ids.wsB;
      else if (c.name === 'org_id' || c.name === 'account_id') row[c.name] = ids.orgB;
      else if (['user_id', 'created_by', 'owner_user_id', 'assigned_to'].includes(c.name) && /int/.test(type)) row[c.name] = ids.userB;
      else if (/int|real|num|float|double|decimal|bool/.test(type)) row[c.name] = c.dflt_value != null ? undefined : 1;
      else row[c.name] = c.dflt_value != null && c.notnull ? undefined : (/email/.test(c.name) ? `${MARK}@orgb.test` : /phone/.test(c.name) ? '919999990001' : MARK);
      if (row[c.name] === undefined) delete row[c.name];
    }
    try { await mockKnex(t).insert(row); if (!seeded.includes(t)) seeded.push(t); } catch { /* table needs more than a generic row: not covered */ }
  }
  await mockKnex.raw('PRAGMA foreign_keys = ON');
}

const snapshot = async () => Object.fromEntries(await Promise.all(seeded.map(async (t) => [t, JSON.stringify(await mockKnex(t).where({ id: B_ID }).first() || null)])));

beforeAll(async () => {
  if (PG) return;
  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: path.join(os.tmpdir(), 'nexus-no-such-env-file'),
    NEXUS_NO_BOOT: '1', NEXUS_NO_BROWSER: 'true', NEXUS_MODE: 'server', DB_CLIENT: 'sqlite',
    NEXUS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-iso-')),
    SESSION_SECRET: require('crypto').randomBytes(32).toString('hex'),
  });
  await mockKnex.migrate.latest();
  const hash = await require('bcryptjs').hash('Passw0rd-for-tests', 4);
  const user = async (email) => { const [r] = await mockKnex('users').insert({ email, password_hash: hash, role: 'user', email_verified_at: 1 }).returning('id'); return r?.id ?? r; };
  const org = async (name, owner) => { const [r] = await mockKnex('organizations').insert({ name, owner_user_id: owner, plan: 'full', plan_status: 'active' }).returning('id'); return r?.id ?? r; };
  const ws = async (orgId, slug) => { const [r] = await mockKnex('workspaces').insert({ org_id: orgId, name: slug, slug }).returning('id'); return r?.id ?? r; };
  const userA = await user('owner@orga.test'); const userB = await user('owner@orgb.test');
  const orgA = await org('Org A', userA); const orgB = await org('Org B', userB);
  wsA = await ws(orgA, 'org-a'); wsB = await ws(orgB, 'org-b');
  for (const [o, u] of [[orgA, userA], [orgB, userB]]) await mockKnex('org_members').insert({ org_id: o, user_id: u, role: 'owner' });
  await mockKnex('memberships').insert([{ user_id: userA, workspace_id: wsA, role: 'manager' }, { user_id: userB, workspace_id: wsB, role: 'manager' }]);
  await seedB({ wsB, orgB, userB });
  app = require('../../server/index.js');
  routes = require('./routeWalk').inventory(app);
}, 120000);
afterAll(() => mockKnex.destroy());

const PUBLIC_PREFIX = /^\/(api\/webhooks|api\/assistant\/public|auth\/(linkedin|facebook|pinterest|twitter|google|tiktok)|users\/(register|login|recover|forgot|reset|verify)|billing\/(webhook|return)|a\/|v1\/approvals|webchat\/|admin\/)/;

async function signedInAsA() {
  const agent = request.agent(app);
  const login = await agent.post('/users/login').send({ email: 'owner@orga.test', password: 'Passw0rd-for-tests' });
  expect(login.status).toBe(200);
  await agent.post('/session/active-workspace').send({ workspaceId: wsA });
  return agent;
}

// Calls each route as A with B's id; returns the read and write leaks it saw
const statuses = {};
async function probe(agent, targets) {
  const readLeaks = [];
  const writeLeaks = [];
  let before = await snapshot();
  for (const r of targets) {
    const url = r.path.replace(/:\w+/g, String(B_ID)).replace(/,.*$/, '');
    let res;
    try {
      res = await agent[r.method.toLowerCase()](url).set('x-workspace-id', String(wsA)).set('Accept', 'application/json').send({ name: 'changed by A', status: 'changed', text: 'changed by A' });
    } catch { continue; }
    const key = `${r.method} ${r.path}`;
    statuses[res.status] = (statuses[res.status] || 0) + 1;
    if (res.status < 300 && (res.text || '').includes(MARK)) readLeaks.push(key);
    const after = await snapshot();
    const changed = seeded.filter((t) => after[t] !== before[t]);
    if (changed.length) writeLeaks.push(`${key} (${changed.join(', ')})`);
    before = after;
  }
  return { readLeaks, writeLeaks };
}

maybe('the harness catches a planted leak (read and delete without scoping)', async () => {
  const table = seeded.find((t) => t !== 'workspaces');
  app.post('/api/__planted_leak/:id', async (req, res) => {
    const row = await mockKnex(table).where({ id: Number(req.params.id) }).first();
    await mockKnex(table).where({ id: Number(req.params.id) }).del();
    res.json(row || {});
  });
  const agent = await signedInAsA();
  const { readLeaks, writeLeaks } = await probe(agent, [{ method: 'POST', path: '/api/__planted_leak/:id' }]);
  expect(readLeaks).toEqual(['POST /api/__planted_leak/:id']);
  expect(writeLeaks).toEqual([`POST /api/__planted_leak/:id (${table})`]);
  await seedB({ wsB, orgB: (await mockKnex('workspaces').where({ id: wsB }).first()).org_id, userB: (await mockKnex('users').where({ email: 'owner@orgb.test' }).first()).id }, [table]);
}, 120000);

maybe('organisation A cannot read or change organisation B\'s rows by id', async () => {
  const agent = await signedInAsA();
  const targets = routes.filter((r) => /:\w+/.test(r.path) && ['GET', 'PUT', 'PATCH', 'DELETE', 'POST'].includes(r.method) && !PUBLIC_PREFIX.test(r.path) && !/^\/workspaces\/:workspaceId/.test(r.path));
  const { readLeaks, writeLeaks } = await probe(agent, targets);

  const found = { seededTables: seeded.length, probedRoutes: targets.length, readLeaks: readLeaks.sort(), writeLeaks: writeLeaks.sort() };
  if (process.env.UPDATE_ISOLATION_BASELINE === '1') {
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({ readLeaks: found.readLeaks, writeLeaks: found.writeLeaks }, null, 2)}\n`);
    console.log(`[isolation] statuses ${JSON.stringify(statuses)}`);
    console.log(`[isolation] seeded ${found.seededTables} tables, probed ${found.probedRoutes} routes, ${readLeaks.length} read leaks, ${writeLeaks.length} write leaks`);
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  expect(found.readLeaks.filter((k) => !baseline.readLeaks.includes(k))).toEqual([]);   // new read leaks
  expect(found.writeLeaks.filter((k) => !baseline.writeLeaks.includes(k))).toEqual([]); // new write leaks
  expect(baseline.readLeaks.filter((k) => !found.readLeaks.includes(k))).toEqual([]);   // fixed: remove from the baseline
  expect(baseline.writeLeaks.filter((k) => !found.writeLeaks.includes(k))).toEqual([]);
  expect(found.seededTables).toBeGreaterThan(20); // the harness really covers the data
  // and really ran signed in: most calls reached the route instead of being refused for the session
  expect((statuses[401] || 0)).toBeLessThan(targets.length / 4);
}, 600000);
