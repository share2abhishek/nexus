// Every release must have release notes: the version in package.json needs its own
// section in docs/RELEASE-NOTES.md. Cut releases with `npm run release -- <version>`.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const notes = fs.readFileSync(path.join(ROOT, 'docs', 'RELEASE-NOTES.md'), 'utf8');
const { version } = require('../package.json');

describe('release notes', () => {
  test('have an Unreleased section for changes since the last release', () => {
    expect(notes).toMatch(/^## Unreleased[ \t]*$/m);
  });

  test(`have a section for the current version (${version}) with at least one entry`, () => {
    const re = new RegExp(`^## ${version.replace(/\./g, '\\.')} — .+\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm');
    const m = notes.match(re);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/^\s*[-*] \S/m);
  });

  test('package-lock.json has the same version as package.json', () => {
    const lock = require('../package-lock.json');
    expect(lock.version).toBe(version);
    expect(lock.packages[''].version).toBe(version);
  });
});
