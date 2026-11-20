// "What's new" page: docs/RELEASE-NOTES.md parsed for the app (services/releaseNotes.js).
const { parse, forViewer } = require('../services/releaseNotes');
const { version } = require('../package.json');

const MD = `# Notes

Intro text that is not a release.

## Unreleased

### New
- Not live yet

## 2.4.0 — 1 December 2026

### Website chat
- **Bold part:** rest with \`code\`
  and a continuation line.
- <img src=x onerror=alert(1)> stays text

### Super Admin
- Staff only

### Upgrading a hosted (server edition) install — read first
1. Installer step

## 2.3.0 — 17 November 2026

A paragraph under the heading.
`;

describe('release notes page', () => {
  const rel = parse(MD);

  test('only released versions, newest first; Unreleased is never shown', () => {
    expect(rel.map((r) => r.version)).toEqual(['2.4.0', '2.3.0']);
    expect(JSON.stringify(rel)).not.toMatch(/Not live yet/);
    expect(rel[0].date).toBe('1 December 2026');
  });

  test('bold and code render; continuation lines join; any other markup is escaped', () => {
    const chat = rel[0].sections.find((s) => s.title === 'Website chat');
    expect(chat.items[0]).toBe('<strong>Bold part:</strong> rest with <code>code</code> and a continuation line.');
    expect(chat.items[1]).toBe('&lt;img src=x onerror=alert(1)&gt; stays text');
  });

  test('staff and upgrade sections are marked staff-only; text under a version heading is kept', () => {
    expect(rel[0].sections.filter((s) => s.staffOnly).map((s) => s.title)).toEqual(['Super Admin', 'Upgrading a hosted (server edition) install — read first']);
    expect(rel[1].sections[0]).toEqual({ title: '', staffOnly: false, items: ['A paragraph under the heading.'] });
  });

  test('the real file: the current version is listed first and customers never see staff sections', () => {
    const customer = forViewer({ staff: false });
    expect(customer[0].version).toBe(version);
    const titles = customer.flatMap((r) => r.sections.map((s) => s.title));
    expect(titles.some((t) => /^(super admin|upgrading)/i.test(t))).toBe(false);
    const staff = forViewer({ staff: true });
    expect(staff.flatMap((r) => r.sections).length).toBeGreaterThanOrEqual(customer.flatMap((r) => r.sections).length);
    expect(JSON.stringify(customer)).not.toMatch(/<(?!\/?(strong|code)>)/);
  });
});
