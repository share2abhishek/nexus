---
name: tenant-isolation
description: >-
  Rules and review checklist that keep every Nexus organisation's data separate: org_id on every tenant
  table, scoped repositories, id resolution with 404, jobs, webhooks, caches, files, AI retrieval and
  exports. Use this whenever writing or reviewing a query, a migration, a route with an id, a background job,
  a webhook, a cache, file storage, AI knowledge-base retrieval, an export, or a notification, and before
  any release that touches data access.
---

# Tenant isolation (Nexus)

Spec: `docs/platform/ACCESS-AND-ENTITLEMENTS.md` section 11 (rules), 11.2 (migration), 11.3 (RLS).

## Rules
1. Every tenant table has `org_id NOT NULL` (plus `workspace_id` where the row belongs to one), indexed first. Billing tables call it
   `account_id` (same value, same rules).
2. Tenant queries only through `repo.forCtx(ctx)`; raw `knex('<tenant table>')` outside `repos/` fails a test.
3. Insert takes `org_id` from ctx, never input. Update and delete include `org_id` and must affect exactly one
   row, else 404.
4. An id from a URL or body is a pointer: load it scoped; a row of another org is **404**, not 403.
5. Joins between tenant tables also join on `org_id`.
6. Jobs loop per org with `access.systemContext(orgId, ...)`; one org's failure never stops the loop.
7. Webhooks find the org from a verified binding (signature + registered page, phone or form id), never from
   the payload.
8. Caches are keyed by org. Any module-level `Map` of tenant data needs that key and eviction.
9. Files only through the files service: keys under `{org_id}/{workspace_id}/...`, signed URLs 15 min.
10. AI: knowledge-base retrieval, embeddings and memory filtered by org and workspace **in the query**.
11. Exports contain one org. Notifications resolve recipients inside the org. Logs carry ids, never content.
12. Users in several orgs: one active org per session; nothing ever shows two orgs' data together.

## Review checklist (each "no" is a finding with a concrete A-reads-B scenario)
- Does every new query on a tenant table go through `forCtx`? Is `org_id` in every WHERE and JOIN?
- Can a guessed id from another org be read, changed, deleted, exported, attached or used as a parent?
- Can a body, header or query field change which org or workspace is used?
- Does a job, webhook or bot act with the right org, and only that org?
- Is any cache, singleton or in-memory list shared across orgs?
- Can a file key, signed URL or path reach another org's file?
- Can AI retrieval or a prompt include another org's data?
- Is the two-org isolation harness extended for the new route, and green?
