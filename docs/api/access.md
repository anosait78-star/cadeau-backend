# Access API Contract

**Status:** ✅ Built — **EPIC-5** (M5.1–M5.6) · **Base paths:** `/v1/access`, `/v1/admin` ·
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

- Every access change is **audited** (who, what, before/after) to the durable,
  append-only `audit_log` (tenant-scoped). Event-bus emission of the same
  vocabulary is wired in EPIC-6.
- Menus, pages, buttons, reports, and APIs are all gated by the same triple check;
  a failure of any layer is `403 FORBIDDEN`.
- Effective-capabilities cache is invalidated on any permission/flag/plan change.

## Implementation notes (EPIC-5)

- **Resolver:** `shared/access/AccessResolverService` resolves
  `EffectiveCapabilities = { features, permissions }` = plan features ∪ add-ons,
  overridden by per-company flags, ∩ globally-active features; permissions = the
  member's template (`company_members.role`) ± `member_permissions` overrides,
  each gated by its `feature_permissions` edge. Cached per `(company, user)` with
  a 60s TTL + explicit invalidation (`CapabilityCache`, in-process — single
  process by design; no Redis in the stack).
- **Guards:** `@RequireCapability({ feature?, permission? })` + `AccessGuard`
  gate the tenant routes; `SuperAdminGuard` gates `/v1/admin` via a
  `platform_admins` lookup (a platform privilege, isolated from tenant roles and
  never carried in a token). Bootstrapped from `SUPER_ADMIN_EMAILS` by the
  access seed.
- **Tables:** the contract's set is realized as `features`, `plans`,
  `plan_features`, `permissions`, `feature_permissions`, `permission_templates`,
  `role_permissions`, `subscriptions`, `company_feature_flags`, plus three
  concrete additions — `add_ons` (feature grants beyond the plan),
  `member_permissions` (per-member grant/revoke overrides), and `platform_admins`
  (the Super-Admin grant). Catalog tables are seeded system reference data
  (`FORCE` RLS: public read, writes only in the null-principal seed context);
  tenant tables carry the base columns + tenant RLS.
- **`PUT /access/members/{memberId}/permissions`** body:
  `{ templateKey?: string, permissions?: { key, granted }[] }` — assigns a
  template and/or replaces the member's overrides (at least one required).
- **Frontend:** `CapabilitiesProvider` + `useCapabilities` expose `has(...)`;
  `<FeatureGate>` / `<PermissionGate>` and the capability-filtered nav hide UI the
  API would refuse. A Super-Admin surface (`/admin`) lists companies and toggles
  features / sets plans live; a Roles & Access settings page displays the
  templates. Per-member assignment UI is deferred pending a tenancy
  members-list endpoint; the `PUT …/permissions` API itself is delivered + tested.
