# Access Review — EPIC-5 Three-Layer Access (ADR-0003)

**Scope:** the access model delivered in EPIC-5 (M5.1–M5.6) — data model, central
Access Resolver, guards, endpoints, and the web capability layer. Read alongside
[api/access.md](api/access.md), [permission-matrix.md](permission-matrix.md), and
[adr/0003-three-layer-access.md](adr/0003-three-layer-access.md).

> **Verdict:** the implementation faithfully realizes ADR-0003. Every gated
> surface — menus, pages, buttons, reports, APIs — is resolved by one central
> server-side resolver against **Subscription ∧ Feature-Flag ∧ Permission**, with
> the web layer used only to hide UI the API would already refuse.

---

## 1. The three layers

A request is authorized only when **all three** independent layers agree; a
failure of any one is a uniform `403 FORBIDDEN`.

| Layer            | Question it answers                                      | Source of truth                                                                                                                                       |
| ---------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Subscription** | Does the company's plan (± add-ons) include the feature? | `subscriptions → plans → plan_features`, plus `add_ons`                                                                                               |
| **Feature-Flag** | Is the feature enabled for this company, and globally?   | `company_feature_flags` (per-company override) ∩ `features.is_active` (platform kill switch)                                                          |
| **Permission**   | Does the member hold the required permission key?        | `permission_templates → role_permissions` (via `company_members.role`) ± `member_permissions` overrides, each gated by its `feature_permissions` edge |

The composition is expressed as pure data + functions in
[`shared/access/capabilities.ts`](../apps/api/src/shared/access/capabilities.ts):

- **Features** = `planFeatures ∪ addOns`, then per-company flags applied
  (enable/disable), then **intersected with the globally-active set** — a
  globally-inactive feature (e.g. `ai`) is never effective for anyone, regardless
  of plan or flag.
- **Permissions** = role template ± member overrides, then **any permission whose
  gating feature is not effective is dropped**. Core `access.*` permissions have
  no gating edge, so they are feature-independent.

This ordering matters and is correct: the global kill switch wins over a
per-company flag, and a permission can never outlive its feature.

## 2. Central resolver + enforcement points

There is exactly **one** resolver
([`AccessResolverService`](../apps/api/src/shared/access/access-resolver.service.ts))
and it is the single source consulted by every enforcement point:

- **API guards** — `@RequireCapability({ feature?, permission? })` +
  [`AccessGuard`](../apps/api/src/shared/access/access.guard.ts), which runs after
  `JwtAuthGuard`, resolves capabilities, and throws `403` on any-layer failure.
  Unannotated handlers pass through (so a handler is un-gated only by explicit
  omission, which is auditable in review).
- **`GET /v1/access/capabilities`** — the same resolver result, serialized for the
  web client.
- **Web gates** — `<FeatureGate>` / `<PermissionGate>` and `useNavItems` consume
  the capabilities endpoint. **These are convenience only**; the
  `CapabilitiesProvider` docstring and the controller both make the server the
  authority. Hiding a button never substitutes for the guard.

**Single-writer principle upheld:** the client never sends `companyId`; the active
tenant is taken from the token (ADR-003). The resolver short-circuits to
`EMPTY_CAPABILITIES` when the principal has no active tenant — no DB read, no
accidental grant.

## 3. Platform Super-Admin isolation

The platform Super-Admin privilege is deliberately **not** a tenant role:

- Authorized by [`SuperAdminGuard`](../apps/api/src/shared/access/super-admin.guard.ts)
  via a `platform_admins` grant lookup — **never** carried in a token, never
  derived from `company_members.role`.
- The grant table has a **self-SELECT RLS policy** (`user_id = app.current_user_id()`),
  so a signed-in user can read only their own grant row and cannot probe others';
  the `app.is_platform_admin()` SQL function is `STABLE, SECURITY INVOKER,
search_path=''` — it needs no elevated privilege and cannot leak.
- Bootstrapped from `SUPER_ADMIN_EMAILS` by the idempotent seed, isolated in both
  token and code from tenant roles.

Cross-tenant reach is minimal and explicit: only the `companies` SELECT policy was
widened (so the admin can list companies); **all writes** (feature toggle, plan
set) still bind the target company as the active tenant (`setTenantContext`) and go
through the strict per-company tenant policy. RLS is never widened to grant
Super-Admin write access — the privilege lives at the app layer.

## 4. Defense in depth (RLS is the backstop)

Two enforcement layers, consistent with the project's tenancy model:

1. **App layer** — the resolver/guards (feature + permission), plus the repository
   binding the company as active tenant for every tenant read/write.
2. **Postgres RLS** — every tenant-scoped access table (`subscriptions`,
   `company_feature_flags`, `add_ons`, `member_permissions`) carries `FORCE` RLS
   with `USING/WITH CHECK (company_id = app.current_company_id())`. Catalog tables
   (`features`, `plans`, …) are `FORCE` RLS with **public read + null-principal
   seed-only writes** — the running app can never mutate the catalog because every
   authenticated request binds a principal.

So even a bug that let a request reach the DB with the wrong tenant bound would be
denied at the row level. RLS is validated on real Postgres in the CI `database`
job (not locally — no Docker on this workstation).

## 5. Findings

**No blocking findings.** The model is sound, centralized, and defense-in-depth.
Observations carried forward (none block EPIC-5 closure):

| #   | Observation                                                                                             | Disposition                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Capability cache is in-process (60s TTL + explicit invalidation), single-instance by design — no Redis. | **Accepted** for current scale; documented in [cache strategy](#see-also). Revisit if the API is horizontally scaled with strict-consistency needs. |
| A2  | Per-member permission-assignment **UI** is deferred (needs a tenancy members-list endpoint).            | **Accepted.** The `PUT /access/members/{id}/permissions` API is delivered + tested; UI lands with the members list.                                 |
| A3  | Event-bus emission of `access.*` / `subscription.changed` is stubbed to the audit log.                  | **Accepted.** Wired to the real in-process bus in EPIC-6 (that epic owns the bus). Every change is already durably audited.                         |
| A4  | RLS + migration + resolver-against-DB behaviour is CI-only (no local Docker).                           | **Accepted** and consistent with the whole project; the CI `database` job is the gate.                                                              |

## See also

- [permission-matrix.md](permission-matrix.md) — features, permissions, plans, and the six templates.
- [api/access.md](api/access.md) — the endpoint contract + implementation notes.
- [core-data.md](core-data.md) §16.2 — the tenant-table RLS/trigger convention this epic follows.
- [epic-5-quality-gate.md](epic-5-quality-gate.md) — the formal §2.5 gate result.
