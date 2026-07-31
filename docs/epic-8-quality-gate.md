# EPIC-8 Quality Gate (§2.5) — Product Catalog + Variants

**Epic:** EPIC-8 Products · **Branch:** `feat/epic-8-products` · **Commit:** `00a3f0d`
· **Gate run:** 2026-07-31.

The mandatory post-epic quality gate: Security · Architecture · Code · Testing ·
Performance · API/Contract · Documentation · Extensibility · AI-out guarantee —
plus **owner approval**. No new epic starts until every dimension passes and the
owner signs off.

---

## 0. Gate summary

| Dimension         | Result  | Note                                                                         |
| ----------------- | :-----: | ---------------------------------------------------------------------------- |
| Security          | ✅ PASS | Two-layer tenant isolation (RLS + scoped repo); durable audit before emit    |
| Architecture      | ✅ PASS | Clean 4-layer module; deps inward; `arch:check` 0 violations                 |
| Code              | ✅ PASS | Strict TS, no `any`; derived `averageCost` has no write path; **1 gate fix** |
| Testing           | ✅ PASS | 552 unit/integration green; type-check mock defect found & fixed             |
| Performance       | ✅ PASS | Keyset lists on covering indexes; web bundle 146.8 KB / 200 KB gzip          |
| API / Contract    | ✅ PASS | [api/products.md](api/products.md) matches the delivered 8-route controller  |
| Documentation     | ✅ PASS | contract, review, domain, retrospective, this gate                           |
| Extensibility     | ✅ PASS | Uses the EPIC-5/6/7 seams; EPIC-9/11/13 hooks declared, not stubbed in code  |
| AI-out (ADR-0004) | ✅ PASS | No AI import; `no-ai-imports` guard still green                              |

**Local gates (this run):** `format:check` ✅ · `lint` ✅ · `type-check` ✅ (8/8) ·
`test` ✅ **552 passed** (config 37 · web 90 · crypto 25 · database 71 · api 329) ·
`build` ✅ (5/5) · `arch:check` ✅ (384 modules, 881 deps, 0 violations) ·
`check-stable-only` ✅ · `audit --audit-level high` ✅ (0 high; 1 moderate, under the
gate threshold) · `perf:bundle` ✅ (`@cadeau/web` 146.8 KB / 200 KB gzip).

**CI-only gates:** `database` (migrations + RLS on real Postgres), `e2e`
(Playwright desktop+mobile + axe), `performance` (Lighthouse), `api-load` (k6),
`sast`, secret-scan — run on push/PR to `main`. This epic adds a migration and a UI
screen, so `database`/`e2e`/`performance` produce fresh evidence there; they cannot
run on this workstation (no Docker/browser/k6).

> **Gate integrity note.** The delivery commit `00a3f0d` recorded "type-check 8/8"
> green, but a cold re-run for this gate found `products.controller.test.ts` failing
> type-check (13 × TS4111/TS18048) — its service mock was typed as
> `Record<string, …>`, which this project's strict compiler rejects for
> property-access and index-undefined-ness. **Fixed** by typing the mock as a mapped
> type over `ProductsService`. No production code changed. All gates were then
> re-run from clean and pass. See [products-review.md](products-review.md) §Findings.

---

## 1. Security review

- **Two-layer tenant isolation.** Every product/variant table has `FORCE` RLS with
  `USING/WITH CHECK (company_id = app.current_company_id())`, and the repository
  additionally binds `setTenantContext` and filters on `companyId` inside each
  transaction. Both layers must agree for a row to be visible or writable.
- **Tenant comes from the token, never the payload** (ADR-003). `requireTenant`
  rejects a principal without an active company (`403`).
- **Reference checks run under RLS**, so a `categoryId`/`unitId` from another tenant
  is simply not found → `422`, never a cross-tenant leak.
- **Audit is the source of truth.** Each write appends an append-only `audit_log`
  row **before** the additive event emission; a failed/absent subscriber cannot
  lose the record.
- `average_cost` is un-writable from the API (no DTO field; whitelist pipe strips
  it), removing a class of client-supplied-money bugs. `audit`/`stable-only` clean.

**Result: PASS.**

## 2. Architecture review

- **Clean four-layer module** (`domain`/`application`/`infrastructure`/`presentation`)
  with dependencies pointing inward; Prisma confined to `infrastructure`; ports
  (`ProductsRepositoryPort`, `ProductsAuditPort`) invert the boundary.
- No cross-feature imports; master data / access / events are consumed through
  their shared surfaces. `arch:check` **green: 384 modules, 881 deps, 0 violations.**

**Result: PASS.**

## 3. Code review

- TypeScript strict, `readonly` views, no `any`, no `process.env` in the module.
- The derived-cost invariant is enforced structurally (no write path), not by
  convention. PATCH omit-vs-null handled by an explicit `"field" in data` guard.
- Prisma P2002 mapped to a field-specific `409`; cursor tampering to `400`; missing
  reference to `422` — all through the unified error envelope.
- **One defect found and fixed** (the controller-test mock typing, §0 note); it was
  a test-only type error, no runtime impact.

**Result: PASS.**

## 4. Testing

- **552 tests pass** — service (tenant enforcement, audit + emit, error mapping),
  repository (RLS transactions, keyset, uniqueness, reference checks), list-query
  parsing, audit adapter, controller (HTTP semantics, Location headers), DTOs, and
  the frontend page (90 web tests). Full catalog payload typing is compile-time
  enforced.
- The type-check gate is now green from a cold cache (8/8) after the mock fix.

**Result: PASS.**

## 5. Performance

- **Keyset pagination only**, backed by covering indexes
  (`products_keyset_idx (company_id, name, id)` and
  `products_created_keyset_idx (company_id, created_at DESC, id DESC)`) — no OFFSET
  scans. Category/unit lookups indexed.
- **Known limit, recorded as debt:** `q` uses `contains` (leading-wildcard), a
  tenant-scoped sequential scan; a `pg_trgm`/tsvector index is the upgrade path if a
  catalog grows large. Acceptable at expected scale.
- Web bundle **146.8 KB / 200 KB** gzip after adding the Products screen.

**Result: PASS.**

## 6. API / contract review

- [api/products.md](api/products.md) documents all 8 routes, permissions, list
  params, payloads, events, and the `hasStock`/`Idempotency-Key` deferrals. It
  matches the delivered controller exactly (routes, status codes, `operationId`s).
- No breaking change to any existing contract; the `products` feature and its
  permissions were already in the EPIC-5 catalog.

**Result: PASS.**

## 7. Documentation review

- [api/products.md](api/products.md) (✅ Delivered), [events.md](events.md)
  (`product.*` catalog), [execution-plan.md](execution-plan.md) (EPIC-8 delivered,
  552 baseline), plus the three closure docs added this gate:
  [products-review.md](products-review.md), [product-domain.md](product-domain.md),
  [epic-8-retrospective.md](epic-8-retrospective.md). Deferrals are explicit.

**Result: PASS.**

## 8. Extensibility review (ADR-0004)

- EPIC-8 is itself a demonstration of the extensible-by-data model: it attached a
  full feature by consuming existing seams (feature/permission catalog, event bus,
  master-data references) with **no core change**. Downstream hooks (`stock.changed`
  EPIC-9, order lines EPIC-11, `averageCost` from receipts EPIC-13) are declared in
  the closed event catalog / schema, not stubbed in module code.

**Result: PASS.**

## 9. AI-out guarantee (ADR-0004)

- No AI SDK / hosted-inference import anywhere in the products module; the
  `no-ai-imports` architecture rule remains green across the tree. The `ai` feature
  stays inactive.

**Result: PASS.**

---

## Owner approval

All dimensions **PASS**; all local gates green (one type-check defect found and
fixed during the gate); CI-only gates wired for push/PR.

- [x] **All EPIC-8 quality-gate dimensions pass** — verified 2026-07-31.
- [ ] **Owner approval to close EPIC-8 and begin EPIC-9 (Inventory & Warehouses).**
      Pending owner sign-off.

> **EPIC-8 status: complete and gate-passing, pending the closure checkbox above.**
> Adds a migration and a UI screen — run the CI-only `database`/`e2e`/`performance`
> jobs on push to complete the evidence set. Do not begin EPIC-9 until the box is
> checked.
