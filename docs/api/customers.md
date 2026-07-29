# Customers API Contract

**Status:** ⬜ Draft — planned in **EPIC-10** · **Base path:** `/v1/customers` ·
**Feature key:** `CUSTOMERS` · **Access:** authenticated + gated

Customer base with profile, KPIs, and order history. Phone numbers are E.164 and
**unique per company** (no duplicates). Draft — follows
[../api-conventions.md](../api-conventions.md).

## Resources

- `Customer` — profile + derived KPIs (orders, spend, last-order).
- `CustomerAddress` — one of a customer's addresses.

## Planned endpoints

| Method | Path                                | Purpose                                | Permission         |
| ------ | ----------------------------------- | -------------------------------------- | ------------------ |
| GET    | `/v1/customers`                     | List customers (keyset).               | `customers.read`   |
| POST   | `/v1/customers`                     | Create a customer. Idempotency-Key.    | `customers.write`  |
| GET    | `/v1/customers/{customerId}`        | Detail + KPIs.                         | `customers.read`   |
| PATCH  | `/v1/customers/{customerId}`        | Update.                                | `customers.write`  |
| GET    | `/v1/customers/{customerId}/orders` | Order history (keyset).                | `customers.read`   |
| POST   | `/v1/customers/merge`               | Merge two customers (manual, audited). | `customers.manage` |
| POST   | `/v1/customers/export`              | Export (restricted, audited).          | `customers.export` |

## List parameters

- Filter: `hasOrders`, `createdAtFrom/To`, `governorateId`.
- Sort (whitelist): `-createdAt,id` (default), `-ordersCount`, `-totalSpent`.
- Search `q`: over name, phone (E.164), email.

## Events emitted (ADR-004)

- `customer.created`, `customer.merged`, `customer.exported`.

## Notes

- **Duplicate phone (E.164) per company is rejected** with `409 CONFLICT` (unique index).
- Exports are permission-gated **and** audited; PII handling per ADR-001.
- Money KPIs use a consistent tenant currency.
