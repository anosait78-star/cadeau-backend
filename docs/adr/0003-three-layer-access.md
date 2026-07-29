# ADR-0003: Enterprise Permission & Feature Management (Three-Layer Access)

- **Status:** Accepted (binding)
- **Date:** 2026-07-26
- **Deciders:** Product owner
- **Supersedes / Superseded by:** —

## Context

The platform is multi-tenant SaaS with paid plans and add-ons. Access depends on
what a company pays for, what the platform has enabled for them, and what the
individual user is permitted to do — three orthogonal concerns that must all be
enforced on the server.

## Decision

Every protected capability is gated by the triple **Subscription ∧ Feature-Flag ∧
Permission**, resolved by a central **Access Resolver** in the BFF (server-side
enforcement; the client never decides access).

- The **Feature Catalog is data**: adding a module = adding a `FEATURE_KEY`, no core change.
- A platform **Super-Admin** (privilege isolated in token and code from tenant roles)
  can enable/disable any feature for any company with **no code change**.
- Menus, pages, buttons, reports, and APIs are all governed by the three layers.
- Ships with six **Permission Templates** (Owner, Store Manager, Call Center,
  Warehouse, Finance, Marketing) and is ready for paid add-ons.

## Consequences

- **Positive:** new modules and plans are configuration, not redeploys; least-privilege
  by construction; a failure of any layer is a single `403`.
- **Negative / trade-offs:** an Access Resolver + effective-capabilities cache (with
  invalidation) to build and keep correct; every access change must be audited.
- **Follow-ups:** built in **EPIC-5**; `companyId` is derived server-side, never from
  the client ([api-conventions.md](../api-conventions.md) §12.2).

## Alternatives considered

- **Role-only (RBAC) access** — rejected: cannot express subscription/feature gating.
- **Client-enforced feature flags** — rejected: trivially bypassable; access must be server-side.
- **External auth/permission service (e.g. Supabase)** — rejected: user/permission
  management stays fully in-house (locked stack).
