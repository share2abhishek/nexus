---
name: access-control
description: >-
  How authorisation works in Nexus: the single decision point access.check, roles at platform, org and
  workspace scope, the permission and feature catalogues, plan entitlements, menu registry, super admin
  console and support sessions. Use this whenever adding or changing a route, a screen, a menu item, a
  role, a permission, a plan feature or limit, a staff/super admin action, or anything that asks "may this
  user do this", even if the request only says "hide this for", "only admins", "plan", "upgrade" or "menu".
---

# Access control (Nexus)

Spec: `docs/platform/ACCESS-AND-ENTITLEMENTS.md` (read sections 0, 3, 5 and 6 before any change) and, for the role
catalogue, data scope, AI agents, teams and plan designer, `docs/billing/ACCESS-REQUIREMENTS.md` and `docs/billing/PLAN.md`.
Section 0 of the first says which document wins on each topic.
Build order: `docs/platform/ROADMAP.md`. Billing (plans, prices, subscriptions): `billing-core` skill.

## The one rule
Every route, job, webhook, bot and screen asks **`access.check(ctx, permissionKey, opts)`**. No inline
`role === 'owner'`, no `req.isPlatformAdmin`, no plan lookups in routes. If the check you need doesn't
exist, add a permission to the catalogue; don't write a condition.

Evaluation order (first failure wins): identity, edition and kill switch, **tenancy and record scope (404)**, org status,
subscription state, feature entitlement, role, limits, rate guard. Identity, tenancy, org status and role
**fail closed**; usage measurement **fails open**.

## Adding something new (checklist)
1. **Permission** in the permission catalogue (location per PLAN.md N2): key `area.action`, scope, category, `feature`,
   `limit` or `meter`, risk, default roles.
2. **Feature** (if it is sold separately) in `modules/access/features.js` (canonical list: ACCESS-REQUIREMENTS 4.1), and a value for every plan in the
   plan matrix (billing tables). No value = deny.
3. **Limit** (if countable) in `modules/access/limits.js` with type, unit, period, measurement.
4. **Route**: `access.middleware('<key>', { resource: req => ({ type, id }) })`. Ids resolve through the scoped
   repository (`tenant-isolation` skill).
5. **Service**: if callable from more than one place (job, bot), call `access.assert(ctx, ...)` inside it.
6. **Menu item** in `modules/access/menu.js` naming the permission; `whenLocked: 'show-locked'` for plan
   reasons, hidden for role reasons.
7. **Tests**: role matrix (allowed and denied roles), plan matrix (feature on/off), other org's id → 404,
   locked subscription behaviour, consistency checker green, route inventory green.

## Do not
- Give platform staff access to org content outside a support session. Never let a support session pay,
  change plan, transfer ownership or delete members.
- Let a menu override grant access (it may only hide or reorder).
- Cache a decision across orgs or longer than 60 s; user status and membership no longer than 5 s.
- Trust `users.role` on the server edition (staff come from `platform_staff`).
- Delete data on a downgrade; make it read-only and refuse new items.
- Let a custom role grant what its creator lacks or what the plan lacks.

## Responses
Deny answers carry `code`, `message`, and `upgrade` or `topup` hints. Codes are listed in spec 13.3 and
are stable; screens map them to text.
