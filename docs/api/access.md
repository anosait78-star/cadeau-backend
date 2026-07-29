# Access API Contract

**Status:** ⬜ Draft — planned in **EPIC-5** · **Base paths:** `/v1/access`, `/v1/admin` ·
**Access:** authenticated + Super-Admin · **Feature key:** — (core, always on)

The three-layer access model (**Subscription ∧ Feature-Flag ∧ Permission**) and
its management surface, resolved server-side by the central Access Resolver
(ADR-003). Platform Super-Admin is a **separate privilege**, isolated in token and
code from tenant roles. Draft — follows [../api-conventions.md](../api-conventions.md).

## Resources

- `Feature` — a catalog entry (a `FEATURE_KEY`); adding a module = adding a key, no core change.
- `Plan` / `PlanFeature` — subscription tiers and the features they include.
- `Subscription` — a company's active plan.
- `CompanyFeatureFlag` — per-company on/off override for a feature.
- `Permission` / `RolePermission` / `FeaturePermission` — the permission graph.
- `PermissionTemplate` — the six presets (Owner, Store Manager, Call Center, Warehouse, Finance, Marketing).
- `EffectiveCapabilities` — the resolved, cached capability set for the caller.

## Planned endpoints

| Method | Path                                                    | Purpose                                                            | Permission      |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------ | --------------- |
| GET    | `/v1/access/capabilities`                               | The caller's effective capabilities (cached).                      | authenticated   |
| GET    | `/v1/access/features`                                   | Features available to the company.                                 | `access.read`   |
| GET    | `/v1/access/permission-templates`                       | The six role templates.                                            | `access.read`   |
| PUT    | `/v1/access/members/{memberId}/permissions`             | Assign permissions/template to a member.                           | `access.manage` |
| GET    | `/v1/admin/companies`                                   | (Super-Admin) all companies.                                       | super-admin     |
| PUT    | `/v1/admin/companies/{companyId}/features/{featureKey}` | (Super-Admin) toggle a feature for a company — **no code change**. | super-admin     |
| PUT    | `/v1/admin/companies/{companyId}/subscription`          | (Super-Admin) set a company's plan.                                | super-admin     |

## List parameters

- `features` — filter: `enabled`; sort (whitelist): `key` (default).

## Events emitted (ADR-004)

- `access.permissions_changed`, `access.feature_toggled`, `subscription.changed`.

## Notes

- Every access change is **audited** (who, what, before/after).
- Menus, pages, buttons, reports, and APIs are all gated by the same triple check;
  a failure of any layer is `403 FORBIDDEN`.
- Effective-capabilities cache is invalidated on any permission/flag/plan change.
