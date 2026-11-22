// The quarantine list can only grow on purpose: every "QUARANTINE: Qn" marker in a test file must be listed in
// tests/QUARANTINE.md, and every listed id must still have a marker (remove the row when the test is fixed).
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const listed = new Set([...fs.readFileSync(path.join(dir, 'QUARANTINE.md'), 'utf8').matchAll(/^\| (Q\d+) \|/gm)].map((m) => m[1]));

function markers() {
  const found = new Map(); // id -> files
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!/\.test\.js$/.test(e.name) || p === __filename) continue;
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/QUARANTINE: (Q\d+)/g)) {
        found.set(m[1], [...(found.get(m[1]) || []), path.relative(dir, p)]);
      }
    }
  };
  walk(dir);
  return found;
}

test('every quarantined test is listed in tests/QUARANTINE.md', () => {
  const unlisted = [...markers().keys()].filter((id) => !listed.has(id));
  expect(unlisted).toEqual([]);
});

test('every listed quarantine still has its marker (remove fixed ones from the list)', () => {
  const found = markers();
  expect([...listed].filter((id) => !found.has(id))).toEqual([]);
});
