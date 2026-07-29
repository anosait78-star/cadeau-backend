# Orders API Contract

**Status:** ⬜ Draft — planned in **EPIC-11** · **Base path:** `/v1/orders` ·
**Feature key:** `ORDERS` · **Access:** authenticated + gated

The core of the system: a 12-state order lifecycle plus a separate follow-up
state, deterministic smart-paste (Regex/Heuristics — **no AI**, ADR-004),
keyset lists with deep-linking, and a pivotal `collectedAmount`. Draft — follows
[../api-conventions.md](../api-conventions.md).

## Resources

- `Order` — header + items + status + `collectedAmount` + label/reason.
- `OrderItem` — a variant line (qty, price, cost snapshot).
- `OrderActivity` — the full activity/audit log for an order.

## Planned endpoints

| Method | Path                            | Purpose                                       | Permission      |
| ------ | ------------------------------- | --------------------------------------------- | --------------- |
| GET    | `/v1/orders`                    | List (keyset + saved filters + deep-linking). | `orders.read`   |
| POST   | `/v1/orders`                    | Create an order. Idempotency-Key.             | `orders.write`  |
| GET    | `/v1/orders/{orderId}`          | Detail (side-panel data).                     | `orders.read`   |
| PATCH  | `/v1/orders/{orderId}`          | Edit order fields.                            | `orders.write`  |
| POST   | `/v1/orders/{orderId}/status`   | Transition status (state machine).            | `orders.status` |
| POST   | `/v1/orders/{orderId}/assign`   | Assign to a member.                           | `orders.assign` |
| POST   | `/v1/orders/bulk/status`        | Bulk status change. Idempotency-Key.          | `orders.status` |
| POST   | `/v1/orders/bulk/assign`        | Bulk assignment. Idempotency-Key.             | `orders.assign` |
| POST   | `/v1/orders/parse`              | Deterministic smart-paste → draft fields.     | `orders.write`  |
| POST   | `/v1/orders/import`             | Import Excel/CSV with column mapping.         | `orders.import` |
| GET    | `/v1/orders/{orderId}/activity` | Activity log (keyset).                        | `orders.read`   |

## List parameters

- Filter: `status`, `followUpState`, `assigneeId`, `label`, `reason`, `createdAtFrom/To`, `governorateId`, `customerId`.
- Sort (whitelist): `-createdAt,id` (default), `-updatedAt,id`.
- Search `q`: over order number, customer name/phone.

## Events emitted (ADR-004)

- `order.created`, `order.status_changed`, `order.assigned`, `payment.collected`.

## Notes

- Status transitions are validated by a (configurable, P1) **state machine**;
  illegal transitions → `422 UNPROCESSABLE_ENTITY`.
- Bulk actions are atomic per item and report per-item results.
- `orders/parse` is **100% deterministic** (Regex/Heuristics); never calls AI.
