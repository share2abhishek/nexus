#!/usr/bin/env node
// Cut a release: npm run release -- <version>   (add --no-git to skip commit and tag)
//
// Turns the "## Unreleased" section of docs/RELEASE-NOTES.md into "## <version> — <date>",
// starts a new empty Unreleased section, writes the version everywhere it appears, then
// commits "chore(release): <version>" and tags v<version>.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NOTES = path.join(ROOT, 'docs', 'RELEASE-NOTES.md');
const args = process.argv.slice(2);
const noGit = args.includes('--no-git');
const version = args.find(a => !a.startsWith('--'));

function fail(msg) { console.error(`release: ${msg}`); process.exit(1); }
const parse = v => v.split('.').map(Number);
function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('give the new version, e.g. npm run release -- 2.3.1');
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (!newer(version, pkg.version)) fail(`${version} is not newer than the current version ${pkg.version}`);

if (!noGit) {
  if (git('status', '--porcelain', '--untracked-files=no')) fail('commit or stash your changes first (the release commit should contain only the release)');
  if (git('tag', '-l', `v${version}`)) fail(`tag v${version} already exists`);
}

// 1. Release notes
let notes = fs.readFileSync(NOTES, 'utf8');
const m = notes.match(/^## Unreleased[ \t]*\n([\s\S]*?)(?=^---[ \t]*$|^## )/m);
if (!m) fail('docs/RELEASE-NOTES.md has no "## Unreleased" section');
if (!/^\s*[-*] \S/m.test(m[1])) fail('the Unreleased section is empty: write what changed in this release first');
if (new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(notes)) fail(`docs/RELEASE-NOTES.md already has a ${version} section`);
const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
notes = notes.replace(m[0], `## Unreleased\n\n---\n\n## ${version} — ${date}\n${m[1]}`);
fs.writeFileSync(NOTES, notes);

// 2. Version everywhere it is written
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const lockPath = path.join(ROOT, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

const [major, minor] = parse(version);
const edits = [
  ['public/help.html', /Help for version \d+\.\d+/g, `Help for version ${major}.${minor}`],
  ['docs/support/technical-guide.md', /App version \d+\.\d+\.\d+ \(`package\.json`\)/g, `App version ${version} (\`package.json\`)`],
  ['docs/support/technical-guide.md', /"version":"\d+\.\d+\.\d+"/g, `"version":"${version}"`],
];
for (const [rel, re, to] of edits) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(re, to);
  if (after === before) console.warn(`release: warning: version not found in ${rel}`);
  fs.writeFileSync(file, after);
}

// 3. Commit and tag
if (noGit) { console.log(`Prepared ${version}. Not committed (--no-git).`); process.exit(0); }
git('add', 'docs/RELEASE-NOTES.md', 'package.json', 'package-lock.json', 'public/help.html', 'docs/support/technical-guide.md');
// The deploy hook must run after the tag exists, so skip it on the commit and run it here.
execFileSync('git', ['commit', '-q', '-m', `chore(release): ${version}`], { cwd: ROOT, env: { ...process.env, NEXUS_NO_DEPLOY: '1' } });
git('tag', '-a', `v${version}`, '-m', `Social-Nexus ${version}`);
console.log(`Released ${version} (commit ${git('rev-parse', '--short', 'HEAD')}, tag v${version}).`);
const hook = path.resolve(ROOT, git('rev-parse', '--git-path', 'hooks/post-commit'));
let hookOn = false;
try { fs.accessSync(hook, fs.constants.X_OK); hookOn = true; } catch {}
if (hookOn) execFileSync(hook, { cwd: ROOT, stdio: 'inherit' });
else console.log('Push it with:  git push --follow-tags');
