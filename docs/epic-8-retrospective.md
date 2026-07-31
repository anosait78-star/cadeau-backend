# EPIC-8 Retrospective — Product Catalog + Variants

**Branch:** `feat/epic-8-products` · **Commit:** `00a3f0d` (backend M8.1–M8.3,
frontend M8.4, testing/docs M8.5) · **Closed:** 2026-07-31.

---

## 1. What we set out to build

The product catalog: a tenant-editable **Product** with one or more sellable
**Variants**, each carrying an optional SKU and barcode and a derived
moving-average cost. Classifiable by the EPIC-7 master data (categories, units),
gated by the EPIC-5 three-layer access model, emitting through the EPIC-6 event
bus, and presented in the Dual Shell as a capability-gated screen.

## 2. What we delivered

| Milestone | Delivered                                                                                                                                                                     | Status |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| M8.1      | `products` + `product_variants` Prisma models + migration `20260803000000`; `FORCE` RLS, `touch_updated_at`, partial unique `sku`/`barcode` indexes, `average_cost` CHECK ≥ 0 | ✅     |
| M8.2      | `ProductsService` + repository: tenant-scoped CRUD, per-product variant add/update, keyset list (`q`/`categoryId`/`active`), reference checks (422), code uniqueness (409)    | ✅     |
| M8.3      | `/v1/products` (8 routes), three-layer gated (`products.read`/`products.manage`), every write audited + `product.*` emitted; OpenAPI DTOs                                     | ✅     |
| M8.4      | Capability-gated Products screen (search, card list, create/edit/archive, inline variants, category/unit selects, ar/en, nav + route)                                         | ✅     |
| M8.5      | Unit/integration tests across service/repo/list-query/audit/controller/DTOs + FE page; docs (contract, review, domain, this retro, quality gate)                              | ✅     |

**Test growth:** the tree stands at **552** unit/integration tests after EPIC-8
(config 37 · web 90 · crypto 25 · database 71 · api 329).

## 3. What went well

- **Reuse over reinvention.** The module leans on primitives already built —
  `setTenantContext`/`stampForCreate`/`stampForUpdate` and the keyset helpers from
  `@cadeau/database`, the `AccessGuard`, the event bus, the master-data references.
  EPIC-8 added a feature without adding a framework.
- **The derived-cost boundary held.** `averageCost` has no write path at any layer
  (no DTO field, no repository write, a DB CHECK). The EPIC-13 seam is a clean
  read-only column, not a `TODO` waiting to be enforced.
- **Partial unique indexes are the right tool.** "Unique if present" for SKU and
  barcode fell out of one Postgres idiom, so codeless variants never collide and
  the app never has to special-case NULLs.
- **One search finds the product by any of its codes.** `q` reaching into
  `variants.some.sku/barcode` means a scanned barcode lands on the parent product —
  the behavior a POS/back-office user actually wants — for one `OR` clause.
- **Layering stayed green.** `arch:check` clean throughout (384 modules, 0
  violations); `domain` stays free of Prisma, data access confined to
  `infrastructure`.

## 4. What was hard / what we learned

- **The commit's "gates green" claim did not survive a clean re-run.** The
  delivery commit stated type-check was 8/8, but the products controller test
  typed its service mock as `Record<string, …>`, which under this project's strict
  `noPropertyAccessFromIndexSignature` + `noUncheckedIndexedAccess` fails with
  TS4111/TS18048. **Lesson:** a gate is only green if it is re-run from a cold
  cache before the closure gate — a cached "pass" can mask a real type error.
  Fixed by typing the mock as a mapped type over `ProductsService`.
- **Variant events need an aggregate decision.** Emitting a distinct
  `product.variant_created` vs. folding it into `product.updated` is a real design
  choice. We chose parent-scoped `product.updated` because downstream consumers
  track the product; the variant-level fact still lives in the audit log
  (`product_variant` entity). Documented so EPIC-9 doesn't re-litigate it.
- **`contains` search doesn't use an index.** A leading-wildcard `contains` is a
  tenant-scoped sequential scan. Fine at catalog scale, but it's the first thing to
  revisit if a tenant's catalog grows large (see debt table).

## 5. Deviations & deferrals (all accepted)

- **Permission naming:** the contract draft's `products.write` shipped as
  `products.manage`, matching the project-wide `read`/`manage` convention. Already
  in the EPIC-5 catalog — no catalog change.
- **`hasStock` list filter deferred to EPIC-9** — it depends on inventory tables
  that don't exist yet.
- **`Idempotency-Key` deferred** — no shared idempotency store exists in any module
  yet; `POST` behaves like the other modules until that infrastructure lands.
- **Barcode symbology validation not implemented** — barcodes are free-form
  identifiers in v1; check-digit validation would be an additive DTO constraint.

## 6. Debt carried into later epics

| Item                                                                   | Lands in                  |
| ---------------------------------------------------------------------- | ------------------------- |
| `hasStock` list filter (needs inventory tables)                        | EPIC-9                    |
| `stock.changed` per-variant + on-hand/committed quantities             | EPIC-9                    |
| `averageCost` actually computed from posted receipts                   | EPIC-13                   |
| `Idempotency-Key` honored on `POST` (shared idempotency store)         | when the store is built   |
| Trigram / tsvector index if `q` search becomes slow on a large catalog | when/if a tenant scales   |
| Barcode symbology (EAN/UPC check-digit) validation, if required        | future, additive DTO rule |

## 7. Metrics snapshot (at close)

- **Gates (this run):** format ✓ · lint ✓ · type-check ✓ (8/8, after the mock fix)
  · **552 tests ✓** (config 37 · web 90 · crypto 25 · database 71 · api 329) ·
  build ✓ (5/5) · arch ✓ (384 modules, 881 deps, 0 violations) · stable-only ✓ ·
  audit high-clean (1 moderate, under gate) · web bundle **146.8 KB / 200 KB** gzip.
- **CI-only (not run locally — no Docker/browser/k6):** `database` (migrations + RLS
  on real Postgres), `e2e` (Playwright desktop+mobile + axe), `performance`
  (Lighthouse), `api-load` (k6), `sast`, secret-scan.

See [epic-8-quality-gate.md](epic-8-quality-gate.md) for the formal §2.5 result and
[products-review.md](products-review.md) for the dimension review.
