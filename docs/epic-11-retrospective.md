# EPIC-11 Retrospective — Orders

**Epic:** EPIC-11 Orders · **Branch:** `feat/epic-11-orders` · **Closed:** 2026-07-31
· Gate: [epic-11-quality-gate.md](epic-11-quality-gate.md).

---

## 1. What shipped

The core of the system: a 12-state order lifecycle with a separate follow-up axis,
feature-gated stock coupling, in-transaction customer KPIs, race-safe order
numbers, `Idempotency-Key` replay, bulk status/assign, a full activity log,
deterministic smart-paste + CSV import, and the Orders screen in the Dual Shell.
It also discharged every EPIC-10 order-dependent deferral (merge, order history,
`hasOrders` + KPI sorts).

## 2. Milestones

- **M11.0** — design doc + branch; decisions D1–D6 recorded.
- **M11.1** — `20260806000000_orders`: orders/items/activities/sequences, RLS,
  triggers, keyset indexes, the money/status CHECKs; `stock_reservations.order_id`
  promoted to a real FK.
- **M11.2** — `modules/orders` domain + application + infrastructure.
- **M11.3** — `/v1/orders` presentation **plus** the inherited customer pieces
  (merge + order-history + `hasOrders`/KPI sorts).
- **M11.4** — the Orders screen (tabs + counts, detail panel, inline/bulk, create).
- **M11.5** — deterministic smart-paste + CSV import (backend + a paste box).
- **M11.6** — docs + the §2.5 gate.

## 3. What went well

- **Owner decisions up front (D1–D6)** kept the build unambiguous — especially the
  stock-coupling and KPI-timing choices, which touch two other modules each.
- **Reusing EPIC-9's `FOR UPDATE` lock path** for the order stock effects meant the
  concurrency model was already proven; no new oversell logic.
- **The merge completeness guard** (a DMMF test over `customerId` FKs) turns "did
  we remember every owned table?" from a review worry into a failing test.
- **Recomputing KPIs from source every write** (not incrementally) made drift
  structurally impossible — the same discipline `average_cost` follows.
- Coverage thresholds forced real repository/parser tests, not just happy paths.

## 4. What was hard / friction

- **The coverage gate is strict** (90% lines/functions/statements, 85% branches),
  and a ~700-line repository dragged the global numbers down until the raw-SQL
  paths (locking, cursors, error mapping) were each exercised through a mocked
  Prisma `$transaction`. Budget several extra tests per large infrastructure file.
- **`setTenantContext` consumes a `$queryRaw`** in the mocked tx, which quietly
  ate a `mockResolvedValueOnce` meant for the order-lock query — the fix was a
  config flag on the mock, not a `once`. Worth remembering for stock-heavy tests.
- **Cross-feature boundary vs. phone search:** searching orders by customer phone
  wanted the customers module's blind-index normalization, which the
  `no-cross-feature-imports` rule forbids. Scoped `q` to number+name and routed
  phone→orders through the `customerId` filter instead of duplicating PII logic.

## 5. Deviations (all documented)

- Permissions `read`/`manage` (D1); `q` phone search via `customerId`; `.xlsx`
  binary import deferred pending a vetted dependency (CSV delivered); configurable
  state machine + assignee-picker UI are P1.

## 6. Debt carried into later epics

| Item                                                                   | Lands in                |
| ---------------------------------------------------------------------- | ----------------------- |
| Per-company **configurable** state machine (UI + storage)              | P1 / later              |
| Assignee-picker UI (the assign API is delivered)                       | P1 / later              |
| Binary `.xlsx` import (needs a vetted stable dependency)               | when the dep lands      |
| Return-to-stock on a **post-shipment** return                          | EPIC-12/13              |
| Shipping carrier, waybills, fee reconciliation                         | EPIC-12                 |
| Official invoices, VAT, refunds, COGS reports                          | EPIC-13                 |
| Order analytics axes                                                   | EPIC-14                 |
| Customer/end-user WhatsApp/SMS on status change                        | EPIC-15                 |
| Shared cross-module idempotency store (still module-local)             | when the store is built |
| `prisma generate` races under parallel turbo (`--concurrency=1` works) | tooling, low priority   |

## 7. Metrics snapshot (at close)

- Tests: **925** (config 40 · web 122 · crypto 35 · database 71 · api 657) — up
  from 795.
- Web bundle: 162.5 KB gzip / 200 KB budget.
- New API routes: 12 orders + 2 inherited customer routes.
- `arch:check`: 463 modules, 1137 deps, 0 violations; `no-ai-imports` green.
