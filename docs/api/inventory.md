# Inventory & Warehouses API Contract

**Status:** ✅ Delivered in **EPIC-9** · **Base paths:** `/v1/warehouses`, `/v1/inventory` ·
**Feature key:** `inventory` · **Access:** authenticated + three-layer gated

Warehouses and per-variant stock with **atomic** reserve/release, **atomic**
transfers, reason-coded adjustments, and numbered low-stock alerts. Stock is
`onHand` / `committed` / `available`. Follows
[../api-conventions.md](../api-conventions.md).

## Resources

- `Warehouse` — a stock location. Tenant-editable, archived via `active`. `code`
  is optional but unique per company; at most one warehouse per company carries
  `isDefault`.
- `InventoryStock` — `{ id, warehouseId, variantId, onHand, committed, available,
reorderPoint, updatedAt }`. One row per (warehouse, variant); created on
  first use. **`available` is derived** (`onHand - committed`) and maintained by
  the `app.sync_stock_available()` trigger, so it can be filtered, sorted, and
  indexed — it is never client-writable.
- `StockReservation` — an outstanding commitment (`active` → `released`).
- `StockTransfer` — an atomic move between warehouses (a durable log).
- `StockAdjustment` — a counted correction (reason-coded, a durable log).

Quantities are whole units (`bigint` in the database, JSON numbers on the wire) —
never money.

## Endpoints

| Method | Path                                         | Purpose                                            | Permission         |
| ------ | -------------------------------------------- | -------------------------------------------------- | ------------------ |
| GET    | `/v1/warehouses`                             | List warehouses (keyset).                          | `inventory.read`   |
| GET    | `/v1/warehouses/{warehouseId}`               | Warehouse detail.                                  | `inventory.read`   |
| POST   | `/v1/warehouses`                             | Create a warehouse. `201` + `Location`.            | `inventory.manage` |
| PATCH  | `/v1/warehouses/{warehouseId}`               | Update a warehouse.                                | `inventory.manage` |
| DELETE | `/v1/warehouses/{warehouseId}`               | Archive a warehouse (soft-delete). `204`.          | `inventory.manage` |
| GET    | `/v1/inventory/stock`                        | Stock levels (keyset, filterable).                 | `inventory.read`   |
| PUT    | `/v1/inventory/reorder-points`               | Set a level's low-stock threshold.                 | `inventory.manage` |
| POST   | `/v1/inventory/reservations`                 | Reserve stock (atomic). `Idempotency-Key`.         | `inventory.manage` |
| DELETE | `/v1/inventory/reservations/{reservationId}` | Release a reservation (atomic). `204`.             | `inventory.manage` |
| POST   | `/v1/inventory/transfers`                    | Transfer between warehouses (atomic). `Idem.-Key`. | `inventory.manage` |
| POST   | `/v1/inventory/adjustments`                  | Adjust with a reason (atomic). `Idempotency-Key`.  | `inventory.manage` |

Every route is behind `JwtAuthGuard` + `AccessGuard`; any layer failing
(subscription ∧ feature ∧ permission) is a `403`. The tenant comes from the
token, never the payload (ADR-003).

## List parameters

- **`/v1/warehouses`** — filters: `q` (name/code, case-insensitive), `active`
  (`true` | `false` | `all`, default `true`); sort (whitelist): `name`,
  `createdAt` (default `-createdAt`); `limit`, `cursor`.
- **`/v1/inventory/stock`** — filters: `warehouseId`, `variantId`,
  `belowReorder` (`true` ⇒ only levels with a threshold set and
  `available <= reorderPoint`); sort (whitelist): `available`, `updatedAt`
  (default `-updatedAt`); `limit`, `cursor`.

Keyset pagination only; every collection returns
`{ data, page: { limit, nextCursor, hasMore } }`.

## Payloads

- **Reserve** — `{ warehouseId, variantId, quantity ≥ 1, orderId?, reference? }`.
- **Transfer** — `{ fromWarehouseId, toWarehouseId, variantId, quantity ≥ 1, note? }`;
  the two warehouses must differ (`400`).
- **Adjust** — `{ warehouseId, variantId, quantityDelta ≠ 0, reason, note? }`;
  `reason` ∈ `count` | `damage` | `loss` | `return` | `other`.
- **Reorder point** — `{ warehouseId, variantId, reorderPoint ≥ 0 }`.

## Atomicity, oversell, and idempotency

- **Atomic.** Each stock write runs in one transaction that locks the affected
  `inventory_stock` rows (`SELECT … FOR UPDATE`) before reading a balance, then
  moves it and appends its log row. Two concurrent reservations of the last unit
  serialize: the second sees the first's committed units and gets `409`. A
  transfer locks both sides in a deterministic (warehouse-id) order, so opposing
  transfers of the same pair queue instead of deadlocking.
- **Oversell policy.** Per product, via `products.allow_oversell` (added by this
  epic). When `false` (default), a reservation exceeding `available` is `409
CONFLICT`; when `true` it is allowed and `available` may go negative.
  Transfers and downward adjustments are always bounded by `onHand`.
- **Idempotency.** `Idempotency-Key` on the three stock-moving `POST`s is stored
  on the log row under a per-company unique index. A retry returns the original
  record and moves no stock; two racing retries resolve to the same record.
  Releasing an already-released reservation is likewise a no-op.

## Errors

| Case                                           | Status | Code                   |
| ---------------------------------------------- | ------ | ---------------------- |
| Bad list query / same-warehouse transfer       | `400`  | `VALIDATION_FAILED`    |
| Bad cursor                                     | `400`  | `BAD_REQUEST`          |
| No active company, or a gate failed            | `403`  | `FORBIDDEN`            |
| Unknown warehouse / reservation                | `404`  | `NOT_FOUND`            |
| Duplicate warehouse `name` / `code`            | `409`  | `CONFLICT`             |
| Insufficient stock                             | `409`  | `CONFLICT`             |
| Unknown/inactive referenced warehouse, variant | `422`  | `UNPROCESSABLE_ENTITY` |

## Events emitted (ADR-0004)

- **`stock.changed`** — once per affected level on every write that actually
  moved stock (a transfer emits two, one per side). Payload:
  `{ warehouseId, variantId, onHandDelta, committedDelta, onHand, committed,
available, reason }` with `reason` ∈ `reserved` | `released` | `transferred` |
  `adjusted`.
- **`stock.low`** — **edge-triggered**: emitted only on the write that pushed
  `available` down to or below a non-zero `reorderPoint`, not repeatedly while
  the level stays low. Payload: `{ warehouseId, variantId, available, reorderPoint }`.

An idempotent replay moves no stock, so it emits nothing and writes no audit row.
See [../events.md](../events.md).

## Audit

Every write appends a durable `audit_log` row (the source of truth; events are
additive): `inventory.warehouse_created` / `_updated` / `_archived`,
`inventory.reserved`, `inventory.released`, `inventory.transferred`,
`inventory.adjusted`, `inventory.reorder_point_set`.

## Deviations from the draft

- Permissions use the project's `read`/`manage` convention (as in EPIC-8), so the
  draft's `inventory.write` for reservations is `inventory.manage`. The EPIC-5
  catalog seeds exactly `inventory.read` / `inventory.manage`.
- `PUT /v1/inventory/reorder-points` was added — the low-stock threshold the
  draft's alerting depends on has to be settable somewhere.
- Reservations have no list endpoint yet; they are created and released by the
  order lifecycle (EPIC-11), which will surface them in the order detail.
