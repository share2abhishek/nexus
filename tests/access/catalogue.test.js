// A0 catalogue consistency (docs/platform/ACCESS-AND-ENTITLEMENTS.md 7.4, rules 1, 2 and 4 so far):
// every key a permission, menu item or feature names exists, and every sidebar page is in the menu registry.
const fs = require('fs');
const path = require('path');
const { PERMISSIONS, WORKSPACE_ROLES, get: perm } = require('../../modules/access/permissions');
const { FEATURES, get: feature } = require('../../modules/access/features');
const { LIMITS, get: limit } = require('../../modules/access/limits');
const { MENU, flat } = require('../../modules/access/menu');

const featureKeys = (f) => (f && typeof f === 'object' ? f.anyOf : f ? [f] : []);
const CATEGORIES = ['read', 'create', 'edit', 'delete', 'publish', 'send', 'automate', 'ai', 'upload', 'export', 'billing', 'admin', 'account', 'settings'];
const dupes = (keys) => keys.filter((k, i) => keys.indexOf(k) !== i);

test('keys are unique and well formed', () => {
  expect(dupes(PERMISSIONS.map((p) => p.key))).toEqual([]);
  expect(dupes(FEATURES.map((f) => f.key))).toEqual([]);
  expect(dupes(LIMITS.map((l) => l.key))).toEqual([]);
  for (const p of PERMISSIONS) {
    expect([p.key, /^[a-z_]+(\.[a-z_]+){1,3}$/.test(p.key)]).toEqual([p.key, true]);
    expect([p.key, CATEGORIES.includes(p.category)]).toEqual([p.key, true]);
    expect([p.key, ['workspace', 'org', 'billing', 'account', 'platform'].includes(p.scope)]).toEqual([p.key, true]);
  }
});

test('every feature and limit a permission names exists', () => {
  for (const p of PERMISSIONS) {
    for (const k of featureKeys(p.feature)) expect([p.key, k, !!feature(k)]).toEqual([p.key, k, true]);
    if (p.limit) expect([p.key, p.limit, !!limit(p.limit)]).toEqual([p.key, p.limit, true]);
  }
});

test('every feature a feature requires exists', () => {
  for (const f of FEATURES) for (const k of [...f.requires, ...f.requiresAny]) expect([f.key, k, !!feature(k)]).toEqual([f.key, k, true]);
});

test('roles grant only catalogued workspace permissions', () => {
  for (const [role, keys] of Object.entries(WORKSPACE_ROLES)) {
    for (const k of keys) expect([role, k, perm(k)?.scope]).toEqual([role, k, 'workspace']);
  }
});

test('every menu item names an existing permission and feature, and the feature matches the permission\'s', () => {
  for (const it of flat()) {
    const p = perm(it.permission);
    expect([it.id, it.permission, !!p]).toEqual([it.id, it.permission, true]);
    expect([it.id, it.feature, !!feature(it.feature)]).toEqual([it.id, it.feature, true]);
    const pf = featureKeys(p.feature);
    // Rule 2: the item's feature is the permission's, or the permission needs no feature beyond core
    if (pf.length && !pf.includes('core') && it.feature !== 'core') { // a core permission (settings, integrations) may sit under any feature
      const related = pf.includes(it.feature) || pf.some((k) => feature(it.feature).requires.includes(k));
      expect([it.id, it.feature, pf, related]).toEqual([it.id, it.feature, pf, true]);
    }
  }
});

test('every sidebar page in public/index.html is in the menu registry', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  const nav = html.slice(html.indexOf('<nav class="sidebar-nav"'), html.indexOf('</nav>'));
  const pages = [...new Set([...nav.matchAll(/data-page="([^"]+)"/g)].map((m) => m[1]))];
  const ids = new Set(flat().map((i) => i.page || i.id));
  expect(pages.length).toBeGreaterThan(30);
  expect(pages.filter((p) => !ids.has(p))).toEqual([]);
  expect(MENU.length).toBeGreaterThan(20);
});
