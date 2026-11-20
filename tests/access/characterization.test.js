// A0 characterization (docs/platform/ROADMAP.md A0): the access engine decides exactly as the code before A0 did.
// OLD_MATRIX and oldGuard are frozen copies of services/rbac.js and middleware/tenancy.js requirePermission as they
// were at 2.4.0. Do not edit them: they are the record of the old behaviour.
const fs = require('fs');
const path = require('path');
const access = require('../../modules/access');
const { requirePermission } = require('../../middleware/tenancy');

const OLD_MATRIX = {
  manager: ['social.manage', 'members.manage', 'content.create', 'content.edit', 'content.submit',
    'content.approve', 'content.comment', 'content.publish', 'content.schedule', 'content.view', 'analytics.view'],
  creator: ['content.create', 'content.edit', 'content.submit', 'content.view', 'analytics.view'],
  reviewer: ['content.approve', 'content.comment', 'content.view', 'analytics.view'],
  client: ['content.approve', 'content.comment', 'content.view', 'analytics.view'],
  analyst: ['content.view', 'analytics.view'],
};
function oldCan(role, action) { const perms = OLD_MATRIX[role]; return Array.isArray(perms) && perms.includes(action); }
function oldGuard(action) {
  return (req, res, next) => {
    if (req.isPlatformAdmin) return next();
    if (!oldCan(req.role, action)) return res.status(403).json({ error: 'Forbidden', requiredPermission: action });
    next();
  };
}

const ROLES = ['manager', 'creator', 'reviewer', 'client', 'analyst', 'owner', 'admin', 'superadmin', 'ghost', '', null, undefined, '__proto__', 'constructor', 'toString'];

// Every permission key a route or the server passes to the guard today
const ROOT = path.join(__dirname, '..', '..');
const USED = [...new Set([...fs.readdirSync(path.join(ROOT, 'routes')).map((f) => `routes/${f}`), 'server/index.js']
  .flatMap((f) => [...fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/\b(?:permit|requirePermission)\('([a-z._]+)'\)/g)].map((m) => m[1])))].sort();
// The keys routes used before A0 (frozen). Keys added later (platform.*, voice.*) are server-only staff keys with their
// own test below.
const LEGACY_KEYS = new Set([...Object.values(OLD_MATRIX).flat(), 'content.delete']);
const LEGACY_USED = USED.filter((k) => LEGACY_KEYS.has(k));
const NEW_USED = USED.filter((k) => !LEGACY_KEYS.has(k));

const KEYS = [...new Set([...LEGACY_USED, ...Object.values(OLD_MATRIX).flat(), ...access.permissions.PERMISSIONS.map((p) => p.key)])];

const mockRes = () => ({ code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const reqFor = (role, { staff = false, userId = 7 } = {}) => ({ session: { userId }, workspaceId: 3, role, isPlatformAdmin: staff });

function run(guard, req) {
  const res = mockRes();
  let passed = false;
  guard(req, res, () => { passed = true; });
  return { passed, code: res.code, body: res.body };
}

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterAll(() => { console.log.mockRestore(); });

describe.each([['desktop', undefined], ['server', 'server']])('on the %s edition', (_name, mode) => {
  beforeAll(() => { if (mode) process.env.NEXUS_MODE = mode; else delete process.env.NEXUS_MODE; });
  afterAll(() => { delete process.env.NEXUS_MODE; });

  test('the routes use known permission keys', () => {
    expect(USED.length).toBeGreaterThanOrEqual(10);
    for (const k of USED) expect([k, !!access.permissions.get(k)]).toEqual([k, true]);
  });

  test('every role x every route permission: the new guard answers exactly as the old one', () => {
    for (const role of ROLES) {
      for (const key of LEGACY_USED) {
        const before = run(oldGuard(key), reqFor(role));
        const after = run(requirePermission(key), reqFor(role));
        expect([role, key, after.passed, after.code]).toEqual([role, key, before.passed, before.code]);
        if (!before.passed) expect(after.body).toMatchObject(before.body);
      }
    }
  });

  test('every role x every catalogued key that a workspace role could hold: roleGrants equals the old can()', () => {
    for (const role of ROLES) for (const key of KEYS) expect([role, key, access.roleGrants(role, key)]).toEqual([role, key, oldCan(role, key)]);
  });

  test('Radixile staff still pass every route permission, whatever their role (legacy bypass), and it is logged', () => {
    console.log.mockClear();
    for (const role of ROLES) {
      for (const key of LEGACY_USED) expect([role, key, run(requirePermission(key), reqFor(role, { staff: true, userId: mode ? 8 : 9 })).passed]).toEqual([role, key, true]);
    }
    expect(console.log.mock.calls.some(([line]) => /^\[ACCESS\] legacy_staff_bypass perm=/.test(line))).toBe(true);
  });
});

test('keys added after A0: staff pass on the server edition, no role does yet, and they do not exist on the desktop app', () => {
  const keys = NEW_USED;
  for (const k of keys) expect([k, access.permissions.get(k).editions]).toEqual([k, ['server']]);
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) {
    process.env.NEXUS_MODE = 'server';
    expect(run(requirePermission(key), reqFor('manager', { staff: true, userId: 11 })).passed).toBe(true);
    expect(run(requirePermission(key), reqFor('manager')).code).toBe(403);
    delete process.env.NEXUS_MODE;
    expect(run(requirePermission(key), reqFor('manager', { staff: true, userId: 11 })).code).toBe(404);
  }
});

test('nothing calls the old services/rbac.js any more', () => {
  expect(fs.existsSync(path.join(ROOT, 'services', 'rbac.js'))).toBe(false);
  const dirs = ['routes', 'services', 'middleware', 'server', 'repos', 'modules'];
  const files = dirs.flatMap(function list(d) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  });
  const offenders = files.filter((f) => /require\(['"][./]*(services\/)?rbac['"]\)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  expect(offenders).toEqual([]);
});

test('an unknown permission key is refused when the route is built, not at request time', () => {
  expect(() => access.middleware('content.publsh')).toThrow(/unknown permission/);
});

describe('steps the old guard did not have (all no-ops for today\'s data)', () => {
  test('no session answers 401 (requireAuth always ran first, so this never reached the old guard)', () => {
    const r = run(access.middleware('content.view'), { role: 'manager', workspaceId: 3 });
    expect(r.code).toBe(401);
  });
  test('an organisation suspended by the platform keeps reading only', () => {
    const req = { ...reqFor('manager'), orgStatus: 'suspended' };
    expect(run(access.middleware('content.view'), req).passed).toBe(true);
    const r = run(access.middleware('content.publish'), req);
    expect([r.code, r.body.code]).toEqual([403, 'orgsuspended']);
  });
});
