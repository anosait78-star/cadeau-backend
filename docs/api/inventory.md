# Inventory & Warehouses API Contract

**Status:** ⬜ Draft — planned in **EPIC-9** · **Base paths:** `/v1/warehouses`, `/v1/inventory` ·
**Feature key:** `INVENTORY` · **Access:** authenticated + gated

Warehouses and per-variant stock with atomic reserve/release and atomic transfers.
Stock is `onHand` / `committed` / `available`. Draft — follows
[../api-conventions.md](../api-conventions.md).

## Resources

- `Warehouse` — a stock location.
- `InventoryStock` — `{ warehouseId, variantId, onHand, committed, available }`.
- `StockTransfer` — an atomic move between warehouses (logged).
- `StockAdjustment` — a counted correction (reason-coded, logged).

## Planned endpoints

| Method | Path                                         | Purpose                                                | Permission         |
| ------ | -------------------------------------------- | ------------------------------------------------------ | ------------------ |
| GET    | `/v1/warehouses`                             | List warehouses.                                       | `inventory.read`   |
| POST   | `/v1/warehouses`                             | Create a warehouse.                                    | `inventory.manage` |
| GET    | `/v1/inventory/stock`                        | Stock levels (filterable).                             | `inventory.read`   |
| POST   | `/v1/inventory/reservations`                 | Reserve stock (atomic). Idempotency-Key.               | `inventory.write`  |
| DELETE | `/v1/inventory/reservations/{reservationId}` | Release a reservation (atomic).                        | `inventory.write`  |
| POST   | `/v1/inventory/transfers`                    | Transfer between warehouses (atomic). Idempotency-Key. | `inventory.manage` |
| POST   | `/v1/inventory/adjustments`                  | Adjust with a reason. Idempotency-Key.                 | `inventory.manage` |

## List parameters

- `stock` — filter: `warehouseId`, `variantId`, `belowReorder`; sort (whitelist): `available`, `-updatedAt,id`.

## Events emitted (ADR-004)

- `stock.changed` (variant/warehouse deltas), `stock.low` (reorder threshold crossed).

## Notes

- Reserve/release/transfer/adjust are **atomic** and consistent with order state.
- Low-stock alerts are numbered/thresholded; overselling is a per-product policy.
