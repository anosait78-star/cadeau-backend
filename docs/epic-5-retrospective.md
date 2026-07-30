# EPIC-5 Retrospective — Three-Layer Access (ADR-0003)

**Branch:** `feat/epic-5-access` · **Commits:** `179a70a` (backend M5.1–M5.3),
`cb33388` (frontend M5.4–M5.6) · **Closed:** 2026-07-30.

---

## 1. What we set out to build

The enterprise access model from ADR-0003: every request authorized by
**Subscription ∧ Feature-Flag ∧ Permission**, resolved by a single server-side
Access Resolver, with a data-driven feature catalog (adding a module = adding a
key, no core change), the six permission templates, and a platform Super-Admin who
can toggle features / set plans for any company **without code**.

## 2. What we delivered

| Milestone | Delivered                                                                                                                                                                                                    | Status |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| M5.1      | 12 Prisma models + migration `20260801000000`; catalog + tenant tables with `FORCE` RLS; idempotent seeders (features, permissions + edges, plans, six templates, platform admins from `SUPER_ADMIN_EMAILS`) | ✅     |
| M5.2      | `AccessResolverService`, `CapabilityCache` (60s TTL + explicit invalidation), `@RequireCapability` + `AccessGuard`, DB-backed `SuperAdminGuard`, global `AccessCoreModule`                                   | ✅     |
| M5.3      | `/v1/access` (capabilities, features, permission-templates, member permissions) + Super-Admin `/v1/admin` (companies, feature toggle, subscription); every mutation audited + cache-invalidating             | ✅     |
| M5.4      | `CapabilitiesProvider` + `useCapabilities`, `<FeatureGate>` / `<PermissionGate>`, capability-filtered nav (`useNavItems`) across desktop sidebar, mobile bottom-nav/more-sheet, ⌘K palette                   | ✅     |
| M5.5      | `/admin` Super-Admin surface (behind `RequireSuperAdmin`); `/settings/roles` template viewer; ar/en                                                                                                          | ✅     |
| M5.6      | Unit tests across resolver/cache/guards/repos/seeders/DTOs/controllers + FE gates/provider/pages; docs                                                                                                       | ✅     |

**Test growth:** 306 → **382** (+76). Per package after EPIC-5: config 37 · web 74
· crypto 25 · database 67 · api 179.

## 3. What went well

- **Pure-core design.** The three-layer composition lives in `capabilities.ts` as
  pure data + functions with no I/O, so the subtle bits (global kill switch beats
  per-company flag; a permission can't outlive its feature) are trivially and
  exhaustively unit-tested. This was the single best decision of the epic.
- **One resolver, many enforcement points.** Guards, the capabilities endpoint, and
  the web gates all consult the same `AccessResolverService`. There is no second
  place where "can this user…" is decided — no drift risk.
- **Super-Admin isolation done right.** The privilege is a `platform_admins` grant
  with a self-SELECT RLS policy, never a token claim, never a tenant role. Writes
  still go through strict tenant RLS by binding the target company. Clean.
- **Data-driven catalog.** Features/permissions/plans/templates ship in code and
  seed idempotently — EPIC-7…15 each just add their key. ADR-0003's "no core
  change" promise is real, not aspirational.
- **Layering held.** `arch:check` stayed green throughout (322 modules, 0
  violations); the `shared/access` core has no dependency on any feature module.

## 4. What was hard / what we learned

- **Feature-gated permissions are subtle.** A member can _hold_ a permission by
  template yet not have it _effective_ because the feature isn't in the plan. We
  resolved this cleanly with the `feature_permissions` edge + a filter step, and
  documented it in the [permission matrix](permission-matrix.md#4-templates--permissions-the-six-role-presets)
  with a worked example — but it's the most likely place for future confusion.
- **Cache invalidation is a correctness concern, not an optimization.** Every
  mutation path (`toggleFeature`, `setSubscription`, member permission changes)
  must invalidate the right cache scope (company vs. member). We centralized this
  in the services next to the audit write so the two never drift.
- **Local environment gaps persist.** RLS, migrations, and resolver-against-DB
  behaviour can't run locally (no Docker). We relied on CI's `database` job as the
  gate and kept the pure logic exhaustively covered by local unit tests. This is
  the established project pattern, but it means the RLS policies in this migration
  are **verified in CI, not on this workstation.**

## 5. Deviations & deferrals (all accepted)

- `add_ons`, `member_permissions`, `platform_admins` are concrete realizations of
  the contract's abstract table list — additive, not scope creep.
- **Per-member assignment UI deferred** pending a tenancy members-list endpoint;
  the `PUT /access/members/{id}/permissions` API is delivered and tested.
- **Event-bus emission** of `access.*` / `subscription.changed` is stubbed to the
  durable audit log; it wires to the real in-process bus in EPIC-6 (which owns the
  bus). No behaviour is lost — every change is already audited.

## 6. Debt carried into later epics

| Item                                                            | Lands in                    |
| --------------------------------------------------------------- | --------------------------- |
| Per-member permission assignment **UI** + members-list endpoint | EPIC-6 / tenancy            |
| Real event-bus emission of access events                        | EPIC-6                      |
| Shared/distributed capability cache (only if API scaled out)    | when/if horizontally scaled |
| Penetration test: permission bypass via API                     | EPIC-16 launch gate         |

## 7. Metrics snapshot (at close)

- **Gates:** format ✓ · lint ✓ · type-check ✓ (8 tasks) · **382 tests ✓** · build
  ✓ (5 tasks) · arch ✓ (322 modules, 0 violations) · stable-only ✓ · audit
  high-clean (1 moderate, under gate) · web bundle **141.8 KB / 200 KB** gzip.
- **CI-only (not run locally):** `database` (migrations + RLS on real Postgres),
  `e2e` (Playwright + axe), `performance` (Lighthouse), `api-load` (k6), `sast`,
  secret-scan.

See [epic-5-quality-gate.md](epic-5-quality-gate.md) for the formal §2.5 result.
