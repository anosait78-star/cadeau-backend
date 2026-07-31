# Inventory Domain Model (EPIC-9)

**Status:** ✅ Delivered · **Branch:** `feat/epic-9-inventory` · **Migration:**
`20260804000000_inventory`.

The stock domain: what a **warehouse**, a **stock level**, and the three durable
**write logs** are, the invariants that hold regardless of transport, and how the
model connects to the rest of the system. Implementation lives in
[`apps/api/src/modules/inventory/`](../apps/api/src/modules/inventory/); the HTTP
surface is [api/inventory.md](api/inventory.md).

---

## 1. Aggregates

Unlike EPIC-8, this domain has **two** roots. `Warehouse` is an independently
managed entity; the real aggregate for every stock write is the **stock level** —
the `(warehouse, variant)` pair — because that is the row a write must lock.

```
Warehouse (warehouses)
  ├─ id, companyId
  ├─ name (unique per company), code? (unique per company when present)
  ├─ address?
  ├─ isDefault  (at most ONE true per company — partial unique index)
  └─ active     (soft-delete flag)

StockLevel (inventory_stock)          ← the write aggregate
  ├─ id, companyId
  ├─ warehouseId → warehouses
  ├─ variantId   → product_variants   (EPIC-8 catalog)
  ├─ onHand       (physical, >= 0)
  ├─ committed    (reserved, >= 0)
  ├─ available    (DERIVED: onHand - committed; trigger-maintained column)
  └─ reorderPoint (>= 0)

Write logs (append-only history; each carries an optional idempotencyKey)
  ├─ StockReservation (stock_reservations)  active | released
  ├─ StockTransfer    (stock_transfers)     from ≠ to
  └─ StockAdjustment  (stock_adjustments)   signed delta ≠ 0, reason-coded
```

A stock level is never created by the client. It is **upserted on first touch** by
whichever write path first references the `(warehouse, variant)` pair.

## 2. Entities & fields

### Warehouse

| Field       | Type     | Notes                                                    |
| ----------- | -------- | -------------------------------------------------------- |
| `id`        | uuid     | Server-generated.                                        |
| `name`      | text     | Required. **Unique per company.**                        |
| `code`      | text?    | **Unique per company when present** (partial index).     |
| `address`   | text?    | Free-form.                                               |
| `isDefault` | boolean  | **At most one `true` per company** (partial unique idx). |
| `active`    | boolean  | `is_active`; `false` = archived.                         |
| timestamps  | ISO-8601 | `createdAt` / `updatedAt` (trigger-touched).             |

### StockLevel

| Field          | Type   | Notes                                                  |
| -------------- | ------ | ------------------------------------------------------ |
| `warehouseId`  | uuid   | → `warehouses` (same tenant).                          |
| `variantId`    | uuid   | → `product_variants` (same tenant).                    |
| `onHand`       | bigint | Whole units. `CHECK (on_hand >= 0)`.                   |
| `committed`    | bigint | Whole units. `CHECK (committed >= 0)`.                 |
| `available`    | bigint | **Derived**, trigger-maintained, never client-written. |
| `reorderPoint` | bigint | `CHECK (reorder_point >= 0)`. Drives `stock.low`.      |

`(warehouseId, variantId)` is unique — one level per pair.

### The three write logs

| Log           | Key fields                                                                                | Closed sets / checks                                                 |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Reservation` | `warehouseId`, `variantId`, `quantity`, `orderId?`, `reference?`, `status`, `releasedAt?` | `quantity > 0`; `status IN ('active','released')`                    |
| `Transfer`    | `fromWarehouseId`, `toWarehouseId`, `variantId`, `quantity`, `note?`                      | `quantity > 0`; `from <> to`                                         |
| `Adjustment`  | `warehouseId`, `variantId`, `quantityDelta`, `reason`, `note?`                            | `delta <> 0`; `reason IN ('count','damage','loss','return','other')` |

`orderId` has **no FK** — orders do not exist until EPIC-11; it is a forward
reference the order module will start populating.

## 3. Invariants

1. **Tenant containment.** Every warehouse, level, and log row belongs to exactly
   one company. Enforced twice: the repository binds `setTenantContext` and filters
   on `companyId`, **and** Postgres `FORCE` RLS with
   `USING/WITH CHECK (company_id = app.current_company_id())`.
2. **`available` is derived, never written.** `app.sync_stock_available()` sets
   `available = on_hand - committed` on every insert/update. It is kept as a real
   column (not a view or a computed expression) so it can be **filtered, sorted and
   indexed** — `inventory_stock_available_keyset_idx` backs the `available` keyset.
3. **Stock never goes negative.** `on_hand >= 0` and `committed >= 0` are DB
   CHECKs, and the service refuses the write first: a reservation exceeding
   `available` → `409`, a transfer or downward adjustment exceeding `onHand` →
   `409` (`InsufficientStockError`).
4. **Oversell is a per-product policy, not a global switch.** `products.allow_oversell`
   (EPIC-8 column, added by this migration) lets a reservation exceed `available`
   for that product only. It never bypasses the `on_hand >= 0` floor — overselling
   drives `committed` above `on_hand`, i.e. a negative `available`, which is the
   intended representation of a backorder.
5. **Every stock write is atomic and serialized.** One transaction locks the
   affected level(s) with `SELECT … FOR UPDATE` **before** reading any balance, so
   two concurrent reservations for the last unit serialize rather than both
   succeeding. A transfer locks **both** sides in a deterministic order, so two
   opposite transfers cannot deadlock.
6. **Retries replay, they do not re-apply.** `Idempotency-Key` is stored on the log
   row under a partial unique index `(company_id, idempotency_key)`. A repeat
   request returns the original record with `effects: []` and `replayed: true` — no
   stock moves twice, and the race (two concurrent identical keys) is resolved by
   catching the unique violation and replaying the winner's row.
7. **History is append-only.** Reservations release by transitioning
   `active → released` (with `releasedAt`); transfers and adjustments are never
   mutated. The log is the audit trail of how a level reached its current value.
8. **Deletes are soft.** Archiving a warehouse sets `active = false`; its levels
   and logs remain so history keeps resolving.

## 4. Quantities (not money)

Every quantity in this domain is a **whole count of units** — `bigint` in Postgres,
`number` in the view (stock counts stay far below `Number.MAX_SAFE_INTEGER`). There
is **no monetary field in the inventory domain**: valuation lives on the EPIC-8
variant (`averageCost`) and is computed by EPIC-13 receipts. Keeping money out of
this module is deliberate — a stock move and a cost posting are different facts
with different authorities.

## 5. Lifecycle & events

| Transition            | Effect on levels                                 | Events               |
| --------------------- | ------------------------------------------------ | -------------------- |
| Reserve               | `committed += q` on one level                    | `stock.changed` (×1) |
| Release               | `committed -= q`, reservation → `released`       | `stock.changed` (×1) |
| Transfer              | `onHand -= q` at source, `onHand += q` at target | `stock.changed` (×2) |
| Adjust                | `onHand += delta` on one level                   | `stock.changed` (×1) |
| Set reorder point     | `reorderPoint = n`                               | — (no stock moved)   |
| **Replay** (same key) | none                                             | **none**             |

`stock.low` is **edge-triggered**: it fires only when a write pushed `available`
down to or below `reorderPoint` **from above**, so a level that sits below its
threshold does not re-alert on every subsequent write.

Each write records a durable `audit_log` row **first** (source of truth), then
publishes on the EPIC-6 bus (additive). A replay writes neither.

## 6. Boundaries & relationships

- **Upstream (depends on):** EPIC-8 products (`product_variants` — the thing stock
  is counted in, and `allow_oversell`); EPIC-5 access (`inventory` feature,
  `inventory.read` / `inventory.manage` — already in the EPIC-5 catalog);
  EPIC-6 event bus; `@cadeau/database` (RLS context, keyset, audit).
- **Downstream (will depend on this):** EPIC-11 Orders (reserves on confirm,
  releases on ship/cancel, and will surface reservations on the order),
  EPIC-13 Finance (an atomic receipt raises `onHand` and posts `averageCost`),
  EPIC-14 Analytics (the inventory axis), EPIC-15 Notifications (`stock.low` is the
  natural first typed notification).
- **Closed in this epic:** the two EPIC-8 deferrals that needed stock —
  `GET /v1/products?hasStock=true` and the `allowOversell` field.

## 7. Layering

`domain` (views, ports, list-query, errors) ← `application` (`InventoryService`:
tenant enforcement, orchestration, audit + emit, error mapping) ←
`infrastructure` (Prisma repository, RLS transactions, row locking, audit adapter)
· `presentation` (two controllers, DTOs). Dependencies point inward; data access
only in `infrastructure`; enforced by `pnpm arch:check`.

See [inventory-review.md](inventory-review.md) for the dimension-by-dimension
review and [epic-9-quality-gate.md](epic-9-quality-gate.md) for the §2.5 gate.
