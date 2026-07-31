# Customers API Contract

**Status:** ✅ **Delivered — EPIC-10** (2026-07-31) · **Base path:** `/v1/customers` ·
**Feature key:** `CUSTOMERS` · **Access:** authenticated + gated

Delivered surface: **9 routes** — the 6 customer routes below plus the 3 nested
address routes. Merge and the order-history read stay deferred to EPIC-11 (D3).

Customer base with profile, addresses, and derived KPIs. Phone numbers are E.164
and **unique per company** (no duplicates). Follows
[../api-conventions.md](../api-conventions.md); sensitive-field storage follows
[../privacy-model.md](../privacy-model.md).

## Resources

- `Customer` — profile + derived KPIs (orders, spend, last-order).
- `CustomerAddress` — one of a customer's addresses.

## Endpoints

| Method | Path                         | Purpose                             | Permission         |
| ------ | ---------------------------- | ----------------------------------- | ------------------ |
| GET    | `/v1/customers`              | List customers (keyset).            | `customers.read`   |
| POST   | `/v1/customers`              | Create a customer. Idempotency-Key. | `customers.manage` |
| GET    | `/v1/customers/{customerId}` | Detail + KPIs + addresses.          | `customers.read`   |
| PATCH  | `/v1/customers/{customerId}` | Update.                             | `customers.manage` |
| DELETE | `/v1/customers/{customerId}` | Archive (soft-delete).              | `customers.manage` |
| POST   | `/v1/customers/export`       | Export (audited).                   | `customers.manage` |

Address routes are nested under the customer and carry the same permissions as the
parent write:

| Method | Path                                               | Purpose            | Permission         |
| ------ | -------------------------------------------------- | ------------------ | ------------------ |
| GET    | `/v1/customers/{customerId}/addresses`             | List addresses.    | `customers.read`   |
| POST   | `/v1/customers/{customerId}/addresses`             | Add an address.    | `customers.manage` |
| PATCH  | `/v1/customers/{customerId}/addresses/{addressId}` | Update an address. | `customers.manage` |

Setting `isDefault: true` demotes the incumbent default inside the same
transaction — "one default per customer" is a partial unique index, so the two
writes cannot be split.

**Export request.** `POST /v1/customers/export` takes the list filters in the
**body** (`q`, `active`, `governorateId`, `createdAtFrom/To`, `limit`) rather than
a query string, so a phone used as a filter never lands in a URL or an access log.
It returns `{ data, count }` with **full** phone numbers, capped at 5000 rows per
call, and the audit row + `customer.exported` event are written before the rows are
returned.

**Permission naming (decision D2).** The draft's `customers.write` /
`customers.export` are **not** used. The catalog defines exactly `read` and
`manage` per feature, so writes and export both require `customers.manage`. Adding
a third action would be a core change to the ADR-0003 permission model and is out
of scope for this epic.

**Deferred to EPIC-11 (decision D3):**

- `POST /v1/customers/merge` — merge is written once, against the complete set of
  customer-owned tables, when orders exist.
- `GET /v1/customers/{customerId}/orders` — needs orders.

## List parameters

- Filter: `active`, `governorateId`, `createdAtFrom/To`.
  (`hasOrders` arrives with EPIC-11 — the KPI it filters on is `0` until then.)
- Sort (whitelist): `-createdAt,id` (default), `name,id`.
  (`-ordersCount` / `-totalSpent` arrive with EPIC-11.)
- Search `q`: **if the term normalizes to a valid E.164 number**, it is an exact
  blind-index lookup on the phone; **otherwise** it is a `contains` search over
  name and email. Partial-phone search is not supported — see
  [../privacy-model.md](../privacy-model.md) §5.

## Phone handling

- Accepted in any common form; **normalized to E.164** before anything else.
- Stored twice: `phone_encrypted` (AES-256-GCM, reversible) and `phone_hash`
  (HMAC-SHA256 blind index, unique per company).
- **List responses return a masked phone** (e.g. `+2010•••4567`); the full value is
  decrypted on the **detail** read only.
- A duplicate → `409 CONFLICT` with `field: "phone"`.

## Idempotency

`POST /v1/customers` honours `Idempotency-Key`, reusing the EPIC-9 implementation
(decision D4): the key is stored on the row under a partial unique index per
company, a retry **replays** the original record, and a replay writes no audit row
and emits no event. A first create answers `201` with a `Location` header; a
**replay answers `200`** — nothing was created.

## Errors

| Condition                          | Status                                  |
| ---------------------------------- | --------------------------------------- |
| Duplicate phone in this company    | `409` (`field: phone`)                  |
| Phone not parseable as E.164       | `422` (`field: phone`)                  |
| Unknown `governorateId`            | `422`                                   |
| Tampered or stale list cursor      | `400`                                   |
| No active company on the principal | `403`                                   |
| Customer not in this tenant        | `404` (never a cross-tenant disclosure) |

## Events emitted (ADR-004)

- `customer.created`, `customer.updated`, `customer.exported`.
- `customer.merged` stays **reserved** in the closed catalog for EPIC-11.

Payloads carry ids only — never phone, email, name or address
([../privacy-model.md](../privacy-model.md) §6).

## Notes

- **Duplicate phone (E.164) per company is rejected** with `409 CONFLICT` (unique
  index on `(company_id, phone_hash)`). Uniqueness is per company, not global.
- Exports are permission-gated **and** audited **and** emit an event; there is no
  unaudited path to bulk PII (ADR-001).
- `ordersCount` / `totalSpent` / `lastOrderAt` are **derived and read-only** — no
  DTO field, no write path — and stay `0`/`null` until EPIC-11 computes them.
- Money KPIs use integer minor units in a consistent tenant currency.
