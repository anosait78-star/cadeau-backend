# Orders Domain Model (EPIC-11)

**Status:** ✅ Delivered — 2026-07-31 · Module:
[`apps/api/src/modules/orders`](../apps/api/src/modules/orders/) · Contract:
[api/orders.md](api/orders.md) · Design: [epic-11-design.md](epic-11-design.md) ·
Where it fits: [domain-map.md](domain-map.md).

The order is where every other module pays off: a customer (EPIC-10), variant
lines (EPIC-8), a warehouse commitment (EPIC-9), a label/reason (EPIC-7), an
assignee (EPIC-4/5), and a COD `collectedAmount` that feeds finance and analytics.

---

## 1. Aggregate

**Order** is the aggregate root; its items and activity live inside the boundary.

```
Order  (aggregate root)
  ├── OrderItem      (1..n; variant + qty + price + frozen costSnapshot)
  └── OrderActivity  (0..n; append-only log — created/status/assign/payment/…)
```

An `OrderSequence` row per company issues the human-facing `orderNumber`.

## 2. Entities & fields (highlights)

| Field                                       | Notes                                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orderNumber`                               | Sequential **per company**, unique, race-safe (`order_sequences`).                                                                                                                                |
| `customerId`                                | Pinned (`RESTRICT`) — an order always resolves its customer.                                                                                                                                      |
| `status` / `followUpState`                  | Two independent axes; 12 states + a separate follow-up.                                                                                                                                           |
| `subtotal`/`shippingFee`/`discount`/`total` | Integer minor units; `total = subtotal + shippingFee − discount` (CHECK).                                                                                                                         |
| `collectedAmount` / `paymentStatus`         | Pivotal COD money; settable at create (cross-validated against `total`) or via `PATCH`; payment status derived (`unpaid`/`partial`/`paid`) either way.                                            |
| `warehouseId`                               | Optional, set at create only. Nullable — `SET NULL` on warehouse delete. When present, takes precedence over the company's default warehouse when reserving stock at the `processing` transition. |
| `OrderItem.costSnapshot`                    | The variant `averageCost` frozen at add time — stable COGS.                                                                                                                                       |

## 3. Invariants

| #   | Invariant                                           | Enforced by                                                 |
| --- | --------------------------------------------------- | ----------------------------------------------------------- |
| I1  | Money identity `total = subtotal + shipping − disc` | CHECK constraint + service computation                      |
| I2  | Legal status transitions only                       | State machine (§4); illegal → `422`                         |
| I3  | Cancel needs a `cancel`-kind reason                 | Transition guard → `422` without one                        |
| I4  | Order number unique per company, no races           | `order_sequences` `INSERT … ON CONFLICT … RETURNING`        |
| I5  | Stock never oversells (unless product allows)       | `SELECT … FOR UPDATE` + oversell policy, in the same txn    |
| I6  | An idempotent replay changes nothing                | No second row, no audit, no event                           |
| I7  | Customer KPIs equal the order rows                  | Recomputed from source in the write txn (never incremental) |
| I8  | Merge covers every customer-owned table             | `CUSTOMER_OWNED_TABLES` + a DMMF completeness guard test    |

## 4. State machine

The 12 states and the default transition graph are in
[epic-11-design.md](epic-11-design.md) §6. Stock side effects on entry (all
feature-gated on `inventory`, decision D2): `processing` **reserves**, `shipped`
**decrements on-hand + releases**, a pre-ship `cancelled`/`returned` **releases**.
Cancel requires a reason; the follow-up axis never gates the main machine. A
per-company configurable machine is P1 behind the same engine.

## 5. Lifecycle & events

| Trigger                  | Audit action           | Event                                        |
| ------------------------ | ---------------------- | -------------------------------------------- |
| Create                   | `order.created`        | `order.created`                              |
| Create replay (same key) | — none                 | — none                                       |
| Edit                     | `order.updated`        | `payment.collected` (only if collected rose) |
| Status transition        | `order.status_changed` | `order.status_changed`                       |
| Assign / unassign        | `order.assigned`       | `order.assigned`                             |
| Merge (customers)        | `customer.merged`      | `customer.merged`                            |

Every payload carries **ids and field names only** — never customer PII.

## 6. Boundaries

- **Consumes** customers (pinned FK), product variants (pinned FK + `averageCost`
  snapshot), inventory (feature-gated reserve/ship/release, reusing the EPIC-9
  lock path), EPIC-7 labels/reasons/governorates, the EPIC-5 access catalog
  (`orders` feature, `read`/`manage`), the EPIC-6 event bus, and `audit_log`.
- **Owns** `orders`, `order_items`, `order_activities`, `order_sequences`.
- **Is consumed by** EPIC-12 (shipping reads the order + address), EPIC-13
  (finance reads `payment.collected` + COGS), EPIC-14 (analytics), EPIC-15
  (notifications subscribe to `order.*`).

## 7. Layering

`domain` (entities, state machine, list-query, smart-paste + CSV parsers, errors,
ports) ← `application` (`OrdersService`: tenant enforcement, feature-gate
resolution, audit-then-emit, per-row import) ← `infrastructure` (Prisma repo — RLS
binding, number issuance, the stock side effects, the in-transaction KPI
recompute) · `presentation` (controllers + DTOs). Dependencies point inward; the
module imports no other feature module.
