# Orders API Contract

**Status:** ✅ **Delivered — EPIC-11** (`feat/epic-11-orders`) · **Base path:**
`/v1/orders` · **Feature key:** `orders` · **Access:** authenticated + three-layer
gated (`orders.read` / `orders.manage`).

The core of the system: a 12-state order lifecycle plus a separate follow-up
state, deterministic smart-paste (Regex/Heuristics — **no AI**, ADR-0004), keyset
lists with deep-linking, and a pivotal `collectedAmount`. Follows
[../api-conventions.md](../api-conventions.md). Design: [../epic-11-design.md](../epic-11-design.md).

## Resources

- `Order` — header + items + status + `collectedAmount` + label/reason.
- `OrderItem` — a variant line (qty, price, **cost snapshot** frozen at add time).
- `OrderActivity` — the append-only activity/audit log for an order.

## Endpoints (delivered)

| Method | Path                            | Purpose                                      | Permission      |
| ------ | ------------------------------- | -------------------------------------------- | --------------- |
| GET    | `/v1/orders`                    | List (keyset + filters + deep-linking).      | `orders.read`   |
| GET    | `/v1/orders/status-counts`      | Per-status counts for the status tabs.       | `orders.read`   |
| POST   | `/v1/orders`                    | Create an order. `Idempotency-Key`.          | `orders.manage` |
| GET    | `/v1/orders/{orderId}`          | Detail (items + money).                      | `orders.read`   |
| PATCH  | `/v1/orders/{orderId}`          | Edit order fields (incl. `collectedAmount`). | `orders.manage` |
| POST   | `/v1/orders/{orderId}/status`   | Transition status (state machine).           | `orders.manage` |
| POST   | `/v1/orders/{orderId}/assign`   | Assign to a member (`null` unassigns).       | `orders.manage` |
| POST   | `/v1/orders/bulk/status`        | Bulk status change (per-item results).       | `orders.manage` |
| POST   | `/v1/orders/bulk/assign`        | Bulk assignment (per-item results).          | `orders.manage` |
| POST   | `/v1/orders/parse`              | Deterministic smart-paste → draft fields.    | `orders.manage` |
| POST   | `/v1/orders/import`             | Import CSV with column mapping.              | `orders.manage` |
| GET    | `/v1/orders/{orderId}/activity` | Activity log (keyset).                       | `orders.read`   |

**Plus** on the customers module (the inherited EPIC-10 debt, decision D5):
`GET /v1/customers/{id}/orders`, `POST /v1/customers/merge`, the `hasOrders`
filter and the `-ordersCount` / `-totalSpent` sorts.

## List parameters

- Filter: `status`, `followUpState`, `assigneeId`, `label` (`labelId`),
  `reason` (`reasonId`), `createdAtFrom/To`, `governorateId`, `customerId`.
- Sort (whitelist): `-createdAt` (default), `-updatedAt`.
- Search `q`: over **order number** (all-digits → exact) or **customer name**
  (contains). _Deviation:_ searching orders by customer **phone** is done via the
  `customerId` filter — the caller resolves the customer (whose phone is a blind
  index owned by the customers module) first, keeping the sensitive-field logic in
  one module and honouring `no-cross-feature-imports`.

## Events emitted (ADR-0004)

`order.created`, `order.status_changed`, `order.assigned`, `payment.collected`
(on a COD collection), and `customer.merged` (on merge). All payloads carry
**ids and field names only** — never customer PII.

## Notes & deviations

- **Permissions** use the standing `read` / `manage` convention (decision D1); the
  draft's `.write`/`.status`/`.assign`/`.import` fold into `manage`. No catalog
  change.
- **Status transitions** are validated by a fixed default **state machine**
  (docs/epic-11-design.md §6); an illegal transition → `422`, naming the
  attempted `from`→`to`. A per-company configurable machine is P1.
- **Cancel requires a reason** of kind `cancel`/`cancellation` → else `422`.
- **Stock coupling (decision D2):** entering `processing` reserves stock via the
  EPIC-9 path; `shipped` decrements on-hand; a pre-ship cancel/return releases the
  reservation. **Feature-gated** — only when the company's `inventory` feature is
  on. `stock_reservations.order_id` is now a real FK.
- **Customer KPIs (decision D3)** are recomputed **in the order write
  transaction** — no drift.
- **Money** is integer minor units; `total = subtotal + shippingFee − discount`;
  `costSnapshot` freezes the variant `averageCost` at add time (COGS).
- **Order number** is sequential per company, unique, issued race-safely.
- Bulk actions are atomic **per item** and report per-item results.
- **`orders/parse` and `orders/import` are 100 % deterministic** (Regex/Heuristics
  - an in-house CSV reader); they never import or call an AI SDK (the
    `no-ai-imports` CI guard stays green). _Deviation:_ binary `.xlsx` import is
    deferred pending a vetted stable dependency (ADR-0001); CSV covers the mapping.
