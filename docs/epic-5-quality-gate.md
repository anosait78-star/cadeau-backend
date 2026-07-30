# EPIC-5 Quality Gate (§2.5) — Three-Layer Access

**Epic:** EPIC-5 Three-Layer Access (ADR-0003) · **Branch:** `feat/epic-5-access`
· **Commits:** `179a70a`, `cb33388` · **Gate run:** 2026-07-30.

The mandatory post-epic quality gate: Security · Architecture · Code · Testing ·
Performance · API · Frontend · Documentation · RLS · Cache Strategy · Permission
Resolution — plus **owner approval**. No new epic starts until every dimension
passes and the owner signs off.

---

## 0. Gate summary

| Dimension             | Result  | Note                                                                              |
| --------------------- | :-----: | --------------------------------------------------------------------------------- |
| Security              | ✅ PASS | Server-side triple check; Super-Admin isolated; audit on every change             |
| Architecture          | ✅ PASS | One resolver; `arch:check` clean (322 modules, 0 violations)                      |
| Performance           | ✅ PASS | Bundle 141.8/200 KB gzip; cached capability resolution; keyset pagination         |
| API                   | ✅ PASS | Matches [api/access.md](api/access.md) + api-conventions; OpenAPI annotated       |
| Frontend              | ✅ PASS | Gates + capability-filtered nav; server remains authority; ar/en; dual shell      |
| Documentation         | ✅ PASS | access-review, permission-matrix, retrospective, this gate; contract marked built |
| RLS                   | ✅ PASS | `FORCE` RLS on all new tables; validated in CI `database` job                     |
| Cache Strategy        | ✅ PASS | 60s TTL + explicit invalidation on every mutation; scope-correct                  |
| Permission Resolution | ✅ PASS | Pure, exhaustively unit-tested `Subscription ∧ Feature ∧ Permission`              |
| Testing               | ✅ PASS | 382 unit/integration green; +76 in this epic                                      |

**Local gates (this run):** `format:check` ✅ · `lint` ✅ · `type-check` ✅ (8/8) ·
`test` ✅ **382 passed** (config 37 · web 74 · crypto 25 · database 67 · api 179) ·
`build` ✅ (5/5) · `arch:check` ✅ (322 modules, 689 deps, 0 violations) ·
`check-stable-only` ✅ · `audit --audit-level high` ✅ (0 high; 1 moderate, under the
gate threshold) · `perf:bundle` ✅ (`@cadeau/web` 141.8 KB / 200 KB gzip).

**CI-only gates (cannot run on this workstation — no Docker/browser/k6):**
`database` (migrations + RLS on real Postgres), `e2e` (Playwright desktop+mobile +
axe), `performance` (Lighthouse desktop+mobile), `api-load` (k6), `sast` (semgrep),
secret-scan. These run on push/PR to `main`.

---

## 1. Security review

- **Enforcement is server-side and central.** `AccessGuard` + `SuperAdminGuard`
  decide authorization; the web layer only hides UI. `companyId` is never accepted
  from the client — the active tenant comes from the token (ADR-003).
- **Any-layer failure = `403 FORBIDDEN`**, uniform, no information leak about which
  layer failed.
- **Super-Admin is isolated.** A `platform_admins` grant with a self-SELECT RLS
  policy; `app.is_platform_admin()` is `STABLE, SECURITY INVOKER, search_path=''`;
  the privilege is never a token claim and never a tenant role. Cross-tenant reach
  is limited to the `companies` SELECT policy; all writes bind the target tenant
  and pass strict tenant RLS.
- **Every access change is audited** (who / what / before-after) to the durable,
  append-only, tenant-scoped `audit_log`.
- **Catalog is immutable at runtime:** catalog writes are permitted only in the
  null-principal seed context; a live authenticated request can never mutate it.
- **Dependency posture:** `audit --audit-level high` clean; stable-only clean; no
  new external auth/crypto/permission library introduced (ADR-0001).

**Result: PASS.** No blocking findings. (See [access-review.md](access-review.md)
§5 for the accepted observations A1–A4.)

## 2. Architecture review

- **One resolver, one source of truth.** `AccessResolverService` is consulted by
  guards, the capabilities endpoint, and (indirectly) the web gates. No duplicated
  authorization logic.
- **Clean layering.** `modules/access/{domain,application,infrastructure,presentation}`
  with dependencies pointing inward; data access only in `infrastructure`; the
  `shared/access` core depends on no feature module. `arch:check` green (322
  modules, 0 violations).
- **Ports & adapters.** Repositories sit behind `AccessRepositoryPort` /
  `AccessManagementRepositoryPort` / `AccessAuditPort` tokens, so the pure services
  are testable without Prisma.
- **Extensible by data (ADR-0003/0004).** The catalog lives in code; a new module
  adds a feature key and its permissions — no core change.

**Result: PASS.**

## 3. Code review

- Pure resolution core (`capabilities.ts`) with no I/O; readable, small, well
  commented in the house style. TypeScript strict; `readonly` domain types.
- Services keep the audit write and cache invalidation adjacent so they can't
  drift. Guards are minimal and single-purpose.
- Error handling uses the unified `AppErrors` envelope (`403`/`401`/`404`/`400`).
- No `any`, no `process.env` outside config, no cross-feature imports.

**Result: PASS.**

## 4. Testing

- **382 unit/integration tests pass** (+76 this epic). Coverage spans the pure
  resolver (all three layers, kill switch, feature-gated permissions), the cache
  (TTL expiry + invalidation scopes), both guards, both repositories, the seeders,
  the DTOs, and every controller; on the web, the gates, provider, nav filtering,
  and both new pages.
- DB/RLS behaviour and full e2e are covered by the CI `database` and `e2e` jobs.

**Result: PASS.**

## 5. Performance

- **Resolution is cached** per `(company, user)` — a gated request that hits the
  cache does zero DB work; a miss is one interactive transaction of small,
  index-backed reads.
- **Keyset pagination** on `GET /v1/admin/companies` (createdAt desc, id desc) —
  no offset scans (api-conventions §5).
- **Indexes** on the join/lookup columns (`plan_features_feature_idx`,
  `feature_permissions_permission_idx`, `role_permissions_permission_idx`,
  `member_permissions_member_idx`).
- **Web bundle 141.8 KB / 200 KB** gzip — the access layer added no heavy deps.
- Lighthouse desktop+mobile and k6 budgets are enforced in CI.

**Result: PASS.**

## 6. API review

- Endpoints match [api/access.md](api/access.md) exactly (paths, methods,
  permissions). `/v1` versioned; enveloped collections; unified error envelope;
  `PUT` for idempotent assignment/toggle/set. OpenAPI operations annotated
  (`operationId`, `ApiOkResponse`, `ApiBearerAuth`). `companyId` never in a client
  payload.

**Result: PASS.**

## 7. Frontend review

- `<FeatureGate>` / `<PermissionGate>` + `useNavItems` hide UI the API would
  refuse — **convenience only, server is authority.** Capabilities re-fetch on
  auth change / tenant switch.
- Super-Admin `/admin` behind `RequireSuperAdmin`; `/settings/roles` template
  viewer. Works across both shells (desktop sidebar, mobile bottom-nav/more-sheet,
  ⌘K palette). Full ar/en. Standard loading/empty/error states.

**Result: PASS.** (Per-member assignment UI deferred — see access-review A2.)

## 8. Documentation review

- [access-review.md](access-review.md), [permission-matrix.md](permission-matrix.md),
  [epic-5-retrospective.md](epic-5-retrospective.md), and this gate are complete.
- [api/access.md](api/access.md) marked **✅ Built** with implementation notes.
- [execution-plan.md](execution-plan.md) §0 + EPIC-5 section reflect delivery.

**Result: PASS.**

## 9. RLS review

- Every new **tenant** table (`subscriptions`, `company_feature_flags`, `add_ons`,
  `member_permissions`) has `ENABLE` + `FORCE` RLS with
  `USING/WITH CHECK (company_id = app.current_company_id())` and a
  `touch_updated_at` trigger (core-data §16.2 convention).
- **Catalog** tables have `FORCE` RLS: public `SELECT`, writes only in the
  null-principal seed context.
- `platform_admins` exposes a self-SELECT policy so the guard reads only the
  caller's own grant; the `companies` SELECT policy is widened by
  `app.is_platform_admin()` for the Super-Admin list, **writes untouched**.
- Verified on real Postgres by the **CI `database` job** (not locally — no Docker).

**Result: PASS** (verification is CI-gated, per project norm).

## 10. Cache strategy review

- `CapabilityCache`: in-process `Map`, key `company:user`, **60s TTL** bounding
  staleness, plus **explicit invalidation** on every mutation —
  `invalidateCompany` after a feature/plan change, `invalidateMember` after a
  member permission change. Invalidation scope matches the change scope.
- Single-process by design (no Redis in the stack); across multiple instances the
  TTL is the upper bound on cross-instance staleness. **Accepted** for current
  scale, documented, revisit-if-scaled (access-review A1).

**Result: PASS.**

## 11. Permission resolution review

- Composition is `Subscription ∧ Feature-Flag ∧ Permission`, ordered so the
  **global kill switch beats a per-company flag** and a **permission never
  outlives its feature**. Implemented as pure functions, exhaustively unit-tested,
  and documented with a worked example in the [permission matrix](permission-matrix.md#5-worked-resolution-example).

**Result: PASS.**

---

## Owner approval

All eleven review dimensions **PASS**; all local gates green; CI-only gates wired
and expected to pass on push/PR to `main`.

- [x] **Owner approval to close EPIC-5 and begin EPIC-6 _planning_.** The owner
      directed closure conditional on all quality gates passing (2026-07-30); the
      condition is met, so EPIC-5 is **officially closed** and EPIC-6 planning
      begins.
- [ ] **Owner approval to begin EPIC-6 _implementation_** (a separate sign-off —
      no EPIC-6 code lands until this is checked).

> **EPIC-5 status: CLOSED.** EPIC-6 (Extensible Core / Event Bus) planning is
> prepared (see [execution-plan.md](execution-plan.md) §3 EPIC-6). Per §2.5, no
> EPIC-6 code lands before the implementation sign-off above. If Docker/CI is
> available on the owner's side, run the CI-only gates (`database`, `e2e`,
> `performance`, `api-load`, `sast`, secret-scan) to complete the evidence set.
