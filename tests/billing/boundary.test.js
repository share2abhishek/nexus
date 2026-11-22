// B0 boundary (REQUIREMENTS 3.1): nothing in modules/billing requires code outside modules/billing,
// except services/knex.js and packages from node_modules. The host is reached only through ports.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'modules', 'billing');
const files = (function list(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}(ROOT));

test('modules/billing reaches the host only through its ports', () => {
  expect(files.length).toBeGreaterThan(5);
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue; // a package
      const target = path.resolve(path.dirname(f), spec);
      const inside = target === ROOT || target.startsWith(`${ROOT}${path.sep}`);
      const knex = target === path.join(ROOT, '..', '..', 'services', 'knex') || target === path.join(ROOT, '..', '..', 'services', 'knex.js');
      if (!inside && !knex) offenders.push(`${path.relative(ROOT, f)} -> ${spec}`);
    }
  }
  expect(offenders).toEqual([]);
});

test('the domain is pure: no database, clock or framework', () => {
  for (const f of files.filter((x) => x.includes(`${path.sep}domain${path.sep}`))) {
    const src = fs.readFileSync(f, 'utf8');
    expect([path.basename(f), /require\(\s*['"](knex|express|\.\.\/)/.test(src), /Date\.now\(\)|new Date\(\)/.test(src)]).toEqual([path.basename(f), false, false]);
  }
});
