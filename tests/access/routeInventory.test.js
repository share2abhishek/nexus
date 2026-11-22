// Route inventory (S0, docs/platform/ROADMAP.md). Every route the app serves must be one of:
//   - guarded by a permission (requirePermission) or an admin guard (requireAdmin / requireSuperAdmin);
//   - public on purpose: listed in PUBLIC below, with the reason;
//   - for every signed-in user on purpose (needs requireAuth, no permission): listed in SIGNED_IN, with the reason;
//   - a recorded exception in routeInventory.baseline.json, to be burned down in A0:
//       authOnly    signed-in users only, but no permission checked
//       inlineAuth  no guard middleware; the handler checks the session itself (proved below: an anonymous call is refused)
// A new route that is none of these fails the test. A baseline entry that got fixed (or removed) fails too, so the
// baseline only ever shrinks. Regenerate deliberately with:  UPDATE_ROUTE_BASELINE=1 npx jest tests/access/routeInventory
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { makeTestKnex } = require('../helpers/db');

const mockKnex = makeTestKnex();
jest.mock('../../services/knex', () => mockKnex);

const BASELINE_FILE = path.join(__dirname, 'routeInventory.baseline.json');

// Open on purpose. [method or '*', path regexp, reason]
const PUBLIC = [
  ['GET', /^\/__health$/, 'health check for the deploy script and monitoring (no data)'],
  ['GET', /^\/(landing|help|login)\.html$/, 'public pages'],
  ['GET', /^\/(robots\.txt|sitemap\.xml)$/, 'search engines'],
  ['GET', /^\/legal/, 'legal pages'],
  ['GET', /^\/vendor\/(chart\.umd|fabric\.min)\.js$/, 'static script'],
  ['GET', /^\/blog(,\/blog\/|\/:slug)?$/, 'public website blog (published posts only)'],
  ['GET', /^\/(|app|\*)$/, 'landing page, app shell and static files (the app shell itself asks for sign-in)'],
  ['GET', /^\/webchat\/:token$/, 'website chat share page (secret token)'],
  ['*', /^\/api\/webhooks\//, 'webhooks and the website chat: verified by signature or secret token'],
  ['*', /^\/api\/assistant\/public\//, 'landing-page help chat for visitors (rate limited)'],
  ['GET', /^\/auth\/status$/, 'which social platforms are configured (no customer data)'],
  ['GET', /^\/auth\/(linkedin|facebook|pinterest|twitter|google|tiktok)(\/callback)?$/, 'OAuth start and callback (the provider redirects back without our session header)'],
  ['GET', /^\/auth\/connect\/platforms$/, 'list of connectable platforms (no customer data)'],
  ['*', /^\/users\/(registration-info|register|verify-email|forgot-password|reset-password|login|recover|logout)$/, 'sign-up, sign-in and password recovery'],
  ['GET', /^\/users\/me$/, 'who is signed in: answers { authenticated: false } to anyone else'],
  ['*', /^\/(a\/:id|v1\/approvals\/:id(\/response)?)$/, 'client approval links (secret link id)'],
  ['*', /^\/billing\/(webhook|return)$/, 'billing service notices (signed) and the way back after paying'],
];
// Signed in is enough, on purpose: nothing here belongs to a workspace or another person. [method or '*', path, reason]
const SIGNED_IN = [
  ['GET', /^\/api\/me\/access$/, 'what the signed-in person may do in their own active workspace (access.explain)'],
  ['GET', /^\/api\/release-notes$/, 'What\'s new: the published release notes, the same for everyone'],
];
const isSignedInRoute = (r) => SIGNED_IN.some(([m, re]) => (m === '*' || m === r.method) && re.test(r.path));
const isPublic = (r) => PUBLIC.some(([m, re]) => (m === '*' || m === r.method) && re.test(r.path));

const key = (r) => `${r.method} ${r.path}`;
const category = (r) => {
  if (r.guards.superAdmin || r.guards.admin) return 'admin';
  if (r.guards.permission) return 'permission';
  if (r.guards.auth) return isSignedInRoute(r) ? 'signedIn' : 'authOnly';
  return isPublic(r) ? 'public' : 'open';
};
const fill = (p) => `/${p.replace(/:\w+/g, '1').replace(/\*/g, 'x').replace(/,.*$/, '').replace(/^\/+/, '')}`;

let app;
let routes;
beforeAll(async () => {
  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: path.join(os.tmpdir(), 'nexus-no-such-env-file'), // never read the developer's .env
    NEXUS_NO_BOOT: '1', NEXUS_NO_BROWSER: 'true', NEXUS_MODE: 'server', DB_CLIENT: 'sqlite',
    NEXUS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-inv-')),
    SESSION_SECRET: require('crypto').randomBytes(32).toString('hex'),
  });
  await mockKnex.migrate.latest();
  app = require('../../server/index.js');
  routes = require('./routeWalk').inventory(app).filter((r) => r.method !== 'OPTIONS');
}, 60000);
afterAll(() => mockKnex.destroy());

async function anonymousStatus(r) {
  const res = await request(app)[r.method.toLowerCase()](fill(r.path)).set('Accept', 'application/json').send({});
  return res.status;
}

test('every route is guarded, public on purpose, or a recorded exception', async () => {
  if (process.env.UPDATE_ROUTE_BASELINE === '1') {
    const authOnly = routes.filter((r) => category(r) === 'authOnly').map(key).sort();
    const inlineAuth = [];
    const findings = [];
    for (const r of routes.filter((x) => category(x) === 'open')) {
      const s = await anonymousStatus(r);
      if ([401, 403, 404].includes(s)) inlineAuth.push(key(r)); else findings.push(`${key(r)} -> ${s}`);
    }
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({ authOnly, inlineAuth: inlineAuth.sort() }, null, 2)}\n`);
    if (findings.length) throw new Error(`Open routes that answer an anonymous caller (not written to the baseline):\n${findings.join('\n')}`);
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const allowed = { authOnly: new Set(baseline.authOnly), inlineAuth: new Set(baseline.inlineAuth) };
  const problems = [];
  for (const r of routes) {
    const c = category(r);
    if (c === 'authOnly' && !allowed.authOnly.has(key(r))) problems.push(`no permission checked (add access.require / requirePermission): ${key(r)}`);
    if (c === 'open' && !allowed.inlineAuth.has(key(r))) problems.push(`no guard and not in PUBLIC: ${key(r)}`);
  }
  expect(problems).toEqual([]);
});

test('the baseline only shrinks: every entry is still a route in that state', () => {
  if (process.env.UPDATE_ROUTE_BASELINE === '1') return;
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const now = new Map(routes.map((r) => [key(r), category(r)]));
  const stale = [
    ...baseline.authOnly.filter((k) => now.get(k) !== 'authOnly').map((k) => `authOnly: ${k} (now ${now.get(k) || 'gone'})`),
    ...baseline.inlineAuth.filter((k) => now.get(k) !== 'open').map((k) => `inlineAuth: ${k} (now ${now.get(k) || 'gone'})`),
  ];
  expect(stale).toEqual([]); // remove fixed entries from routeInventory.baseline.json
});

test('routes without a guard middleware still refuse an anonymous caller (hosted edition)', async () => {
  if (process.env.UPDATE_ROUTE_BASELINE === '1') return;
  const { inlineAuth } = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const answered = [];
  for (const r of routes.filter((x) => inlineAuth.includes(key(x)))) {
    const s = await anonymousStatus(r);
    if (![401, 403, 404].includes(s)) answered.push(`${key(r)} -> ${s}`);
  }
  expect(answered).toEqual([]);
});

test('admin routes refuse an anonymous caller', async () => {
  const answered = [];
  for (const r of routes.filter((x) => category(x) === 'admin')) {
    const s = await anonymousStatus(r);
    if (![401, 403].includes(s)) answered.push(`${key(r)} -> ${s}`);
  }
  expect(answered).toEqual([]);
});
