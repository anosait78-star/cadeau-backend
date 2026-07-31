# EPIC-9 Retrospective — Inventory & Warehouses

**Branch:** `feat/epic-9-inventory` · **Commit:** `70fd2f4` (M9.1–M9.5) ·
**Closed:** 2026-07-31.

---

## 1. What we set out to build

Stock that can be trusted under concurrency: **warehouses** as locations,
per-`(warehouse, variant)` **levels** with on-hand / committed / available, and
four atomic write paths — reserve, release, transfer, adjust — each leaving a
durable log. Plus numbered low-stock alerting, a per-product oversell policy, and a
capability-gated Inventory screen in the Dual Shell.

## 2. What we delivered

| Milestone | Delivered                                                                                                                                                                                                                                                                                 | Status |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| M9.1      | 5 Prisma models + migration `20260804000000_inventory`; `FORCE` RLS + `touch_updated_at` on all five; `app.sync_stock_available()` trigger; quantity CHECKs; partial unique indexes (warehouse `code`, one default per company, `idempotency_key` per company); `products.allow_oversell` | ✅     |
| M9.2      | `modules/inventory` (domain/application/infrastructure/presentation); two controllers, 11 routes; every stock write atomic under `SELECT … FOR UPDATE`; `Idempotency-Key` replay; three-layer gating; audit-then-emit                                                                     | ✅     |
| M9.3      | Unit/integration tests across list-query / service / repository (locking, oversell, every replay-race branch) / controllers / audit adapter — api 402 → 435                                                                                                                               | ✅     |
| M9.4      | Inventory screen: Stock tab (warehouse filter, low-stock filter + badge, inline reorder-point editor, adjust/transfer forms) and Warehouses tab; both shells, ar/en — web 90 → 100                                                                                                        | ✅     |
| M9.5      | Docs (contract delivered, events, domain, review, this retro, gate) + the two EPIC-8 deferrals that needed stock: `?hasStock=true` and `allowOversell`                                                                                                                                    | ✅     |

**Test growth:** the tree stands at **668** unit/integration tests after EPIC-9
(config 37 · web 100 · crypto 25 · database 71 · api 435) — up 116 from EPIC-8's 552.

## 3. What went well

- **The concurrency story was designed, not patched.** "Lock the level, _then_ read
  the balance" was the shape of every write path from the first milestone, so no
  path had to be retrofitted. Transfers locking both sides in a deterministic order
  came from the same discipline rather than from a deadlock incident.
- **Invariants live in Postgres.** `on_hand >= 0`, one default warehouse per
  company, unique idempotency key per company, the closed adjustment-reason set, and
  the derived `available` are all database facts. Application bugs can produce a
  `409`; they cannot produce impossible stock.
- **`available` as a real trigger-maintained column paid for itself immediately.**
  It made `belowReorder` filtering and `available` keyset sorting index-backed —
  a computed expression or a view would have forced a sequential scan on the one
  list users hit most.
- **Edge-triggered `stock.low`.** Emitting only on the crossing (not on every write
  while below threshold) means EPIC-15 gets an alert, not a storm — and the logic
  sits in the one place that knows the before-state.
- **Still no core change.** Like EPIC-8, the epic attached itself to existing seams:
  the `inventory` feature and its `read`/`manage` permissions were already in the
  EPIC-5 catalog, the events were already reserved in the EPIC-6 catalog, and the
  screen reused the Dual Shell primitives. `arch:check` stayed green throughout
  (408 modules, 0 violations).
- **The EPIC-8 lesson held.** That gate found a defect only because it re-ran from a
  cold cache. This epic's gate did the same from the start — and was green first
  pass.

## 4. What was hard / what we learned

- **Idempotency has two failure modes, not one.** The obvious one (sequential
  retry) is a lookup. The real one is **two concurrent requests with the same key**:
  both pass the up-front check, one wins the unique index, and the loser must
  _replay the winner's row_ rather than fail. Every write path needed that branch,
  and the release path needed a third (someone else already released it). These
  branches are where the epic's test count grew most.
- **"Derived" needs a mechanism, not a convention.** EPIC-8 made `averageCost`
  derived by giving it no write path. That works for a column nobody computes yet.
  `available` is recomputed on every write, so it needed a trigger — the equivalent
  guarantee at a different cost.
- **Oversell is a product property.** The first instinct is a company setting or a
  request flag. Both are wrong: whether you can sell what you don't have is a fact
  about the item. Placing it on `products` also meant the flag had to be read
  _inside_ the write transaction, under the same lock.
- **Parallel `prisma generate` is not safe.** `pnpm test --force` failed once
  because two packages generated the Prisma client into the same output
  concurrently; `--concurrency=1` is green. Tooling debt, not product behaviour.

## 5. Deviations & deferrals (all accepted)

- **Permission naming:** the contract draft's `inventory.write` shipped as
  `inventory.manage`, matching the project-wide `read`/`manage` convention. Already
  in the EPIC-5 catalog — no catalog change.
- **`PUT /v1/inventory/reorder-points` added** — not in the draft, but low-stock
  alerting is meaningless without a way to set the threshold.
- **No reservation list endpoint** — reservations are read in the context of an
  order; EPIC-11 owns that surface.
- **Idempotency is module-local** — the keys and the replay logic live on the
  inventory log tables. A shared cross-module idempotency store is still deferred;
  this module is now the reference implementation to generalize from.
- **No stock valuation here.** Money stays on the EPIC-8 variant (`averageCost`) and
  is written by EPIC-13.
- **No cycle-count / stock-take workflow** — a counted correction is expressible as
  an adjustment with `reason: "count"`; a guided multi-line count session is a
  future, additive feature.

## 6. Debt carried into later epics

| Item                                                                         | Lands in                |
| ---------------------------------------------------------------------------- | ----------------------- |
| Reservations surfaced (list/detail) on the order                             | EPIC-11                 |
| `orderId` on reservations gets a real FK once `orders` exists                | EPIC-11                 |
| Atomic receipt raises `on_hand` and posts `averageCost`                      | EPIC-13                 |
| Inventory analytics axis (turnover, dead stock, coverage)                    | EPIC-14                 |
| `stock.low` → typed notification + Web Push                                  | EPIC-15                 |
| Shared cross-module idempotency store (generalize this module's approach)    | when the store is built |
| Guided stock-take / cycle-count workflow                                     | future, additive        |
| `prisma generate` races under parallel turbo tasks (`--concurrency=1` works) | tooling, low priority   |

## 7. Metrics snapshot (at close)

- **Gates (this run, cold):** format ✓ · lint ✓ · type-check ✓ (8/8) ·
  **668 tests ✓** (config 37 · web 100 · crypto 25 · database 71 · api 435) ·
  build ✓ (5/5) · arch ✓ (408 modules, 965 deps, 0 violations) · stable-only ✓ ·
  audit high-clean (1 moderate, under gate) · web bundle **150.2 KB / 200 KB** gzip.
- **CI-only (not run locally — no Docker/browser/k6):** `database` (migrations + RLS
  on real Postgres), `e2e` (Playwright desktop+mobile + axe), `performance`
  (Lighthouse), `api-load` (k6), `sast`, secret-scan.

See [epic-9-quality-gate.md](epic-9-quality-gate.md) for the formal §2.5 result and
[inventory-review.md](inventory-review.md) for the dimension review.
