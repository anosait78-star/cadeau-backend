# EPIC-9 Quality Gate (§2.5) — Inventory & Warehouses

**Epic:** EPIC-9 Inventory · **Branch:** `feat/epic-9-inventory` · **Commit:** `70fd2f4`
· **Gate run:** 2026-07-31.

The mandatory post-epic quality gate: Security · Architecture · Code · Testing ·
Performance · API/Contract · Documentation · Extensibility · AI-out guarantee —
plus **owner approval**. No new epic starts until every dimension passes and the
owner signs off.

---

## 0. Gate summary

| Dimension         | Result  | Note                                                                       |
| ----------------- | :-----: | -------------------------------------------------------------------------- |
| Security          | ✅ PASS | Two-layer tenant isolation (RLS + scoped repo); durable audit before emit  |
| Architecture      | ✅ PASS | Clean 4-layer module; deps inward; `arch:check` 0 violations               |
| Code              | ✅ PASS | Strict TS, no `any`; DB-enforced invariants; **no defects found**          |
| Testing           | ✅ PASS | 668 unit/integration green from a cold cache; concurrency branches covered |
| Performance       | ✅ PASS | Keyset lists on covering indexes; web bundle 150.2 KB / 200 KB gzip        |
| API / Contract    | ✅ PASS | [api/inventory.md](api/inventory.md) matches the delivered 11 routes       |
| Documentation     | ✅ PASS | contract, review, domain, retrospective, this gate                         |
| Extensibility     | ✅ PASS | Uses the EPIC-5/6/8 seams; EPIC-11/13/14/15 hooks declared, not stubbed    |
| AI-out (ADR-0004) | ✅ PASS | No AI import; `no-ai-imports` guard still green                            |

**Local gates (this run):** `format:check` ✅ · `lint` ✅ · `type-check` ✅ (8/8) ·
`test` ✅ **668 passed** (config 37 · web 100 · crypto 25 · database 71 · api 435) ·
`build` ✅ (5/5) · `arch:check` ✅ (408 modules, 965 deps, 0 violations) ·
`check-stable-only` ✅ · `audit --audit-level high` ✅ (0 high; 1 moderate, under the
gate threshold) · `perf:bundle` ✅ (`@cadeau/web` 150.2 KB / 200 KB gzip).

**CI-only gates:** `database` (migrations + RLS on real Postgres), `e2e`
(Playwright desktop+mobile + axe), `performance` (Lighthouse), `api-load` (k6),
`sast`, secret-scan — run on push/PR to `main`. This epic adds a migration (with a
new trigger function) and a UI screen, so `database`/`e2e`/`performance` produce
fresh evidence there; they cannot run on this workstation (no Docker/browser/k6).

> **Gate integrity note.** Every local gate was re-run **from a cold cache** for
> this gate — the practice adopted after the EPIC-8 gate found a cached type-check
> "pass" masking a real strict-mode error. This run was green on the first pass; no
> production or test code changed during the gate. One tooling observation:
> `pnpm test --force` fails when turbo runs packages in parallel because two
> packages `prisma generate` into the same output; `--concurrency=1` is green and CI
> runs the packages independently. Recorded as tooling debt in
> [epic-9-retrospective.md](epic-9-retrospective.md) §6.

---

## 1. Security review

- **Two-layer tenant isolation.** All five inventory tables have `FORCE` RLS with
  `USING/WITH CHECK (company_id = app.current_company_id())`, and the repository
  additionally binds `setTenantContext` and filters on `companyId` inside each
  transaction. Both layers must agree for a row to be visible or writable.
- **Tenant comes from the token, never the payload** (ADR-003). `requireTenant`
  rejects a principal without an active company (`403`).
- **Reference checks run under RLS**, so a `warehouseId`/`variantId` from another
  tenant is simply not found → `422`, never a cross-tenant leak.
- **Audit is the source of truth.** Each write appends an append-only `audit_log`
  row **before** the additive event emission; a failed/absent subscriber cannot lose
  the record. A replayed (idempotent) request writes neither.
- **Stock cannot be corrupted by a client.** `available` has no write path (trigger
  owns it); `on_hand`/`committed` are floored by DB CHECKs; the adjustment reason set
  is closed by a CHECK; overselling requires an explicit per-product opt-in and still
  cannot drive physical stock negative.
- `audit --audit-level high` clean (1 moderate, under threshold); `stable-only` clean.

**Result: PASS.**

## 2. Architecture review

- **Clean four-layer module** (`domain`/`application`/`infrastructure`/`presentation`)
  with dependencies pointing inward; Prisma and all row-locking SQL confined to
  `infrastructure`; ports (`InventoryRepositoryPort`, `InventoryAuditPort`) invert
  the boundary.
- No cross-feature imports; products / access / events are consumed through their
  shared surfaces. `arch:check` **green: 408 modules, 965 deps, 0 violations.**

**Result: PASS.**

## 3. Code review

- TypeScript strict, `readonly` views, no `any`, no `process.env` in the module.
- The hard invariants are **structural**: `available` is trigger-derived,
  non-negativity and the reason set are DB CHECKs, "one default warehouse" and
  "unique idempotency key" are partial unique indexes. Application code cannot
  weaken them.
- Concurrency discipline is uniform across all four write paths: lock (`SELECT …
FOR UPDATE`) **before** reading a balance; transfers lock both sides in a
  deterministic order.
- Domain errors map to the unified envelope with field-specific details —
  duplicate → `409`, missing reference → `422`, insufficient stock → `409`,
  tampered cursor → `400`.
- **No defects found** during the review (see
  [inventory-review.md](inventory-review.md) §Findings).

**Result: PASS.**

## 4. Testing

- **668 tests pass** — list-query parsing, service (tenant enforcement, audit +
  emit, edge-triggered `stock.low`, error mapping), repository (RLS transactions,
  row locking, oversell, insufficient-stock, **every idempotency replay-race
  branch**, keyset), audit adapter, both controllers (HTTP semantics), DTOs, and the
  Inventory page (100 web tests).
- api tests grew 402 → 435 in this epic (including the products `hasStock` /
  `allowOversell` additions); the tree grew 552 → 668 overall.
- The type-check gate is green from a cold cache (8/8).

**Result: PASS.**

## 5. Performance

- **Keyset pagination only**, backed by covering indexes —
  `warehouses_keyset_idx (company_id, name, id)`,
  `warehouses_created_keyset_idx`,
  `inventory_stock_available_keyset_idx (company_id, available, id)`,
  `inventory_stock_updated_keyset_idx`, plus `variant_idx` on the three logs. No
  OFFSET scans.
- Keeping `available` as a **real** trigger-maintained column is what makes the
  `belowReorder` filter and the `available` sort index-backed rather than a
  sequential scan.
- **Known limit, recorded as debt:** row locking serializes concurrent writes to the
  _same_ level by design. That is the correctness requirement, not a regression;
  contention is per-`(warehouse, variant)` and does not block unrelated levels.
- Web bundle **150.2 KB / 200 KB** gzip after adding the Inventory screen
  (146.8 → 150.2 KB, +3.4 KB).

**Result: PASS.**

## 6. API / contract review

- [api/inventory.md](api/inventory.md) documents all 11 routes (5 warehouse +
  6 inventory), permissions, list params, payloads, atomicity/oversell/idempotency
  semantics, errors, events and audit. It matches the delivered controllers exactly
  (routes, status codes, `operationId`s).
- No breaking change to any existing contract. The epic **closes** two EPIC-8
  deferrals additively: `GET /v1/products?hasStock=true` and the `allowOversell`
  product field.
- The `inventory` feature and `inventory.read`/`inventory.manage` were already in
  the EPIC-5 catalog — no access-catalog change.

**Result: PASS.**

## 7. Documentation review

- [api/inventory.md](api/inventory.md) (✅ Delivered), [events.md](events.md)
  (`stock.changed`/`stock.low` live), [execution-plan.md](execution-plan.md)
  (EPIC-9 delivered, 668 baseline), [project-metrics.md](project-metrics.md)
  (refreshed at this gate), plus the three closure docs added this gate:
  [inventory-review.md](inventory-review.md),
  [inventory-domain.md](inventory-domain.md),
  [epic-9-retrospective.md](epic-9-retrospective.md). Deferrals are explicit.

**Result: PASS.**

## 8. Extensibility review (ADR-0004)

- EPIC-9 is a second demonstration of the extensible-by-data model: a substantial
  feature attached through existing seams (feature/permission catalog, event bus,
  the EPIC-8 catalog) with **no core change**. Downstream hooks — reservations on
  orders (EPIC-11), receipts raising stock (EPIC-13), the inventory analytics axis
  (EPIC-14), `stock.low` notifications (EPIC-15) — are declared in the closed event
  catalog / schema, not stubbed in module code.
- The one forward reference in the schema (`stock_reservations.order_id`, no FK) is
  documented and deliberate.

**Result: PASS.**

## 9. AI-out guarantee (ADR-0004)

- No AI SDK / hosted-inference import anywhere in the inventory module; the
  `no-ai-imports` architecture rule remains green across the tree. The `ai` feature
  stays inactive.

**Result: PASS.**

---

## Owner approval

All dimensions **PASS**; all local gates green from a cold cache with no defects
found; CI-only gates wired for push/PR.

- [x] **All EPIC-9 quality-gate dimensions pass** — verified 2026-07-31.
- [x] **Owner approval to close EPIC-9 and begin EPIC-10 (Customers).**
      Signed off 2026-07-31.

> **EPIC-9 status: ✅ CLOSED.** All nine dimensions pass, all local gates green from
> a cold cache, owner sign-off recorded above. Adds a migration (with a new trigger
> function) and a UI screen — the CI-only `database`/`e2e`/`performance` jobs
> complete the evidence set on push.
>
> **EPIC-10 (Customers) is open**, with decisions D1–D4 answered by the owner at
> closure: `phone_encrypted` + `phone_hash` blind index; export gated by
> `customers.manage`; **merge deferred to EPIC-11**; the EPIC-9 idempotency pattern
> reused. See [epic-10-design.md](epic-10-design.md) and
> [privacy-model.md](privacy-model.md).
