# API Contracts

Per-module REST contracts. Each file is the **authoritative reference the module's
endpoints are built to satisfy** — the shapes and routes agreed up front, so
implementation (in the module's epic) fills a known surface rather than inventing
one. Every contract follows [../api-conventions.md](../api-conventions.md).

**Status legend:** ✅ implemented · 🟡 partial · ⬜ draft (planned, not built).

| Module                              | Base path                         | Epic    | Status | Contract                             |
| ----------------------------------- | --------------------------------- | ------- | ------ | ------------------------------------ |
| Health                              | `/v1/health`                      | EPIC-1  | ✅     | [health.md](health.md)               |
| Auth                                | `/v1/auth`                        | EPIC-4  | ⬜     | [auth.md](auth.md)                   |
| Tenancy (companies/members/me)      | `/v1/companies`, `/v1/me`         | EPIC-4  | ⬜     | [tenancy.md](tenancy.md)             |
| Access (features/plans/permissions) | `/v1/access`, `/v1/admin`         | EPIC-5  | ⬜     | [access.md](access.md)               |
| Master Data                         | `/v1/master-data`                 | EPIC-7  | ⬜     | [master-data.md](master-data.md)     |
| Products                            | `/v1/products`                    | EPIC-8  | ⬜     | [products.md](products.md)           |
| Inventory & Warehouses              | `/v1/warehouses`, `/v1/inventory` | EPIC-9  | ⬜     | [inventory.md](inventory.md)         |
| Customers                           | `/v1/customers`                   | EPIC-10 | ⬜     | [customers.md](customers.md)         |
| Orders                              | `/v1/orders`                      | EPIC-11 | ⬜     | [orders.md](orders.md)               |
| Shipping                            | `/v1/shipping`                    | EPIC-12 | ⬜     | [shipping.md](shipping.md)           |
| Finance                             | `/v1/finance`                     | EPIC-13 | ⬜     | [finance.md](finance.md)             |
| Analytics                           | `/v1/analytics`                   | EPIC-14 | ⬜     | [analytics.md](analytics.md)         |
| Notifications                       | `/v1/notifications`               | EPIC-15 | ⬜     | [notifications.md](notifications.md) |

## How to use a contract

1. When an epic starts, its module contract is the input: it lists resources,
   planned endpoints, the access keys that gate them (ADR-003), and the events
   they emit (ADR-004).
2. Implementation must not contradict the contract silently — update the contract
   (and bump its status) in the same change, and keep it in sync with OpenAPI.
3. Anything not covered by a contract defaults to [../api-conventions.md](../api-conventions.md).

## Contract template

Every file uses the same sections: **Status/Base/Keys**, **Resources**,
**Planned endpoints** (Method · Path · Purpose · Permission), **List parameters**
(filter/sort/search whitelists), **Events emitted**, and **Notes** (invariants).
Draft shapes are indicative and finalized when the epic is built.
