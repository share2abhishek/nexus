// The app's screens are plain scripts that share one global scope. When two scripts define a
// function with the same name, the one loaded last silently replaces the other: a button on one
// screen then runs the other screen's code (this made "select all" do nothing in Outreach and
// could have sent "Delete selected" to the WhatsApp contacts). New clashes must be caught here.
const fs = require('fs');
const path = require('path');

// Clashes that already existed and are harmless (same helper, or the screens never overlap)
const KNOWN = new Set(['toggleLeadSubmenu', 'navigateToLeadTab', 'escapeHtml', 'deleteCampaign']);

test('no two screen scripts define the same global function name', () => {
  const dir = path.join(__dirname, '..', 'public', 'js');
  const where = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)) (where[m[1]] = where[m[1]] || new Set()).add(f);
  }
  const clashes = Object.entries(where).filter(([name, files]) => files.size > 1 && !KNOWN.has(name))
    .map(([name, files]) => `${name} (${[...files].join(', ')})`);
  expect(clashes).toEqual([]);
});
