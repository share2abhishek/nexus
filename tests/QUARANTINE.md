# Quarantined tests

A quarantined test is skipped in the normal run because it fails for a reason outside the change being made
(a live network dependency, a broken fixture), not because the product is wrong. Every entry has a reason, an owner and a
plan. `tests/quarantine.test.js` fails when a file carries a `QUARANTINE: Qn` marker that isn't listed here, so the
list can only grow by editing this file in a reviewed change.

**Gate (docs/platform/ROADMAP.md, "Gates between phases"):** the suite is green apart from this list, and this list does not grow.

| Id | Test | Why it is quarantined | Owner | Since | Way out |
|---|---|---|---|---|---|
| Q1 | `tests/realData.urbanSociety.functional.test.js` (whole suite) | Crawls the live urbansociety.in website and uses the app's shared database (`services/knex`) instead of a test database, so it fails without that data and can't run in CI. Run on purpose with `LIVE_TESTS=1`. | Radixile dev team | 2026-11-19 (Q0) | Rewrite against `makeTestKnex()` with recorded crawl fixtures, then remove the marker |

## Fixed in Q0 (19 Nov 2026), not quarantined
| Test | Cause | Fix |
|---|---|---|
| `seoAutopilot.test.js` (6), `kbRetrieval.test.js` (3), `routes.workspaces.test.js` (2) | Code under test reaches `services/knex` (business AI settings, default workspace) while the test used a separate database | The tests point `services/knex` at their test database (the pattern other tests already use) |
| `postDesigner.test.js` (1), `sellbird.functional.test.js` (1) | Scripts are now loaded with a cache-busting `?v=` | The tests accept the version suffix |
| `metaVerification.ui.test.js` (1) | **Product bug:** a form placeholder in `index.html` named another company ("Urban Society"); the lead pipeline also fell back to "Urban Society Prospect" / "Urban Society Lead" | Neutral wording in the app |
| `localFolder.security.test.js` (1) | On macOS and Linux `..\secret.txt` is a legal file name; on Windows it escapes the folder | The folder check refuses any name with a backslash |
| `sesEmail.test.js` (suite) | `@aws-sdk/client-sesv2` missing from the local `node_modules` (it is in `package.json`) | `npm install` locally; CI installs it with `npm ci` |
