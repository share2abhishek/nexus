---
name: billing-delivery
description: >-
  How to build the Nexus billing module phase by phase with Claude models: phase order, what to give each
  agent, test and review gates, and safe release. Use this whenever starting or continuing a billing phase
  (B0 to B8), planning agents for billing work, or preparing a billing release or migration.
---

# Delivering the billing module

Source of truth: `docs/billing/REQUIREMENTS.md` (phases are in section 12). Read `billing-core` first.
The single combined order of all phases (S0, A0, T1, B0–B8, R1–R3, S1, L1, L2, P1, T2) is in `docs/platform/ROADMAP.md`; follow it, and use the
`access-control`, `tenant-isolation` and `usage-limits` skills for the non-billing phases. The same brief template and
per-phase loop below apply to them.

## Rules of the road

1. **One phase at a time**, in the `ROADMAP.md` wave order (each card names the review skill to use), on a branch
   `feature/<phase>`, rehearsed on staging, merged to `master` only when CI is green (every `master` commit deploys). Each phase ships alone, with a version bump, release notes and a changelog entry.
   Do not start B5 or B7 enforcement until B1 and B6 data has run for a month.
2. **Plan before code.** For a phase, read its section, list the files you will add and change, list the tests, then build.
   Ask the owner only for decisions in section 15 that the default does not settle.
3. **Pure maths first.** Copy `docs/billing/reference/price-calculator.js` into `modules/billing/domain/`, add tests, and only then build services on it.
4. **Database portability.** Every migration and query is run on SQLite and on Postgres in tests. No `FOR UPDATE` dependence.
5. **Characterization before replacement.** Before swapping `services/entitlements.js` internals, record its current output for every plan and state and assert equality afterwards.
6. **Never deploy behaviour and its switch together.** Lockout and enforcement ship with the env switch off.

## Using Claude models

| Task | Model | Notes |
|---|---|---|
| Money code: invoices, capture, wallet, grants, proration | the strongest available (for example `claude-opus-5-5`) | review every diff yourself |
| Routes, screens, i18n, migrations from a spec | `claude-sonnet-5-5` | give the exact REST contract and error codes |
| Test writing from a contract, fixtures | `claude-sonnet-5-5` | one agent per area, own files only |
| Read-only review | a different agent than the author | use the `billing-money-review` checklist |

Brief template for a build agent:
```
Read docs/billing/REQUIREMENTS.md sections 3, 4 and <the phase's sections>, plus .claude/skills/billing-core/references/rules.md.
Build only <phase scope>. Files you own: <list>. Do not touch <list>.
REST contract: <paths, fields, enums, error codes copied from section 7>.
Tests required: <from the phase's "Done when" and section 12.1>.
Money is integer minor units. No network call inside a transaction. Customer routes take the account from the session only.
Run the tests on SQLite and Postgres. Report: files changed, endpoints, migrations, test counts, decisions, anything not done.
```
Put the same contract in the backend and the frontend brief. Mismatched field names cost more than parallelism saves.

## Per-phase loop

1. Build (backend, then frontend against the real contract).
2. Tests: unit, integration with the role matrix and a cross-account check, concurrency, failure injection (requirements section 14).
3. Review with `billing-money-review`. Anything rewritten in a fix round gets reviewed again.
4. Verify: run the full test suite and the migration on an empty SQLite, an empty Postgres and a copy of production data.
5. UAT checklist for the owner, with what has never run for real (live gateway, real e-mail, PDF fonts).
6. Release: migration first, then code; a rollback note in the migration; release notes with customer-safe wording; staff-only items kept separate.

## Release safety

- Take a "before" snapshot of invoice totals, wallet balances and subscription states; after the release run the same query and compare. Stop on any unexplained difference.
- A deploy that needs a table runs the migration first. Never start new code against a database missing its tables.
- After deploy: check the process version, health, error count in the log, and one endpoint per new route (401 without login proves the route exists and is protected).
- Importing existing customers into `bill_subscription` is its own deliberate, logged step with a dry run first.
