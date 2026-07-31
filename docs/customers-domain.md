# Customers Domain Model (EPIC-10)

**Status:** ✅ Delivered — 2026-07-31 · Module:
[`apps/api/src/modules/customers`](../apps/api/src/modules/customers/) · Contract:
[api/customers.md](api/customers.md) · Storage rules:
[privacy-model.md](privacy-model.md) · Where it fits:
[domain-map.md](domain-map.md) §2.

The customer base for COD social commerce: a person, a phone number that identifies
them, zero or more delivery addresses, and a set of KPIs that stay empty until
orders exist.

---

## 1. Aggregates

There is exactly one aggregate: **Customer**, with its addresses inside the
boundary.

```
Customer  (aggregate root)
   └── CustomerAddress  (0..n, one flagged default)
```

An address has no independent life: it is created, updated and read through its
customer, its routes are nested under the customer, and the "at most one default"
rule is enforced across the set — which is precisely what makes the customer, not
the address, the consistency boundary.

## 2. Entities & fields

### Customer

| Field                                       | Notes                                                               |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `id`, `companyId`                           | Tenant-scoped; `company_id` carries `FORCE` RLS.                    |
| `name`                                      | Plaintext — must be partially searchable.                           |
| `phoneEncrypted`                            | AES-256-GCM. **The source of truth** for the number.                |
| `phoneHash`                                 | HMAC-SHA256 blind index. **UNIQUE per company**; exact lookup.      |
| `email?`                                    | `citext`, optional, **not** unique.                                 |
| `notes?`                                    | Free text.                                                          |
| `ordersCount`, `totalSpent`, `lastOrderAt?` | **Derived, read-only.** `0`/`0`/`null` until EPIC-11 computes them. |
| `idempotencyKey?`                           | Partial unique index per company; drives create replay.             |
| `active`                                    | Soft delete. Archived customers stay readable.                      |

### CustomerAddress

| Field                           | Notes                                                       |
| ------------------------------- | ----------------------------------------------------------- |
| `id`, `companyId`, `customerId` | Tenant-scoped and parent-scoped.                            |
| `lineEncrypted`                 | AES-256-GCM — a delivery address is high-sensitivity.       |
| `landmark?`, `notes?`           | Plaintext helper text.                                      |
| `governorateId?`                | → `governorates` (EPIC-7 system reference data).            |
| `isDefault`                     | **At most one `true` per customer** (partial unique index). |
| `active`                        | Soft delete.                                                |

## 3. Invariants

| #   | Invariant                                       | Enforced by                                                     |
| --- | ----------------------------------------------- | --------------------------------------------------------------- |
| I1  | One customer per phone, per company             | `UNIQUE (company_id, phone_hash)` — a database index            |
| I2  | The phone is never stored readable              | There is no plaintext phone column to write to                  |
| I3  | The stored pair always agrees                   | Both columns are re-derived together on every write             |
| I4  | Normalization happens exactly once              | `normalizeE164` in the domain, called by writes _and_ lookups   |
| I5  | At most one default address per customer        | Partial unique index + in-transaction demotion of the incumbent |
| I6  | KPI columns have no write path                  | Absent from every DTO, command and repository input type        |
| I7  | An idempotent replay changes nothing            | No audit row, no event, no second row                           |
| I8  | Bulk PII egress is always gated **and** audited | Export writes the audit row + event before returning rows       |

**I1 and I4 are the same invariant seen from two ends.** A unique index over a
hash only holds if everything that hashes agrees on the input; `+20 100 123 4567`
and `+201001234567` must reach the hash identically or the index silently permits
the duplicate it exists to prevent. That is why normalization is a single function
and why it sits _above_ the repository, in front of every path that hashes.

## 4. The phone, end to end

```
"+20 100 123 4567"          request body / search term
        │ normalizeE164()   ← the one gate (domain layer)
        ▼
   "+201001234567"          E.164
        │
        ├── encrypt(key)      → phone_encrypted   (reversible; source of truth)
        └── blindIndex(hmac)  → phone_hash        (UNIQUE per company; lookups)

  read: detail  → decrypt → "+201001234567"
        list    → decrypt → mask → "+2010•••4567"
```

The hash is **derivable from the ciphertext**, never the other way round. If the
blind-index key is ever lost or rotated, every hash can be rebuilt by decrypting
and re-hashing; losing the encryption key would be the unrecoverable event
([privacy-model.md](privacy-model.md) §3).

## 5. Search

`q` is one parameter with two behaviours, decided in the domain before the query is
built:

- The term **normalizes to E.164** → an exact match on `phone_hash`.
- Otherwise → a case-insensitive `contains` over `name` and `email`.

There is no third option. A _partial_ phone cannot be matched against a blind index
at all — hashes do not preserve prefixes — and that limitation is a property of the
storage decision (D1), not of the query code.

## 6. Lifecycle & events

```
create ──► active ──► (update)* ──► archived
   │                                   ▲
   └── replay of the same key ─────────┘ (nothing happens)
```

| Trigger                   | Audit action         | Event                                        |
| ------------------------- | -------------------- | -------------------------------------------- |
| Create                    | `customer.created`   | `customer.created`                           |
| Create replay (same key)  | — none               | — none                                       |
| Update                    | `customer.updated`   | `customer.updated`                           |
| Archive                   | `customer.archived`  | `customer.updated` (`fields: ["active"]`)    |
| Address created / updated | `customer.address_*` | `customer.updated` (`fields: ["addresses"]`) |
| Export                    | `customer.exported`  | `customer.exported` (`count`)                |

Every payload carries **ids and field names only** — never a phone, an email, a
name or an address line. A subscriber that needs the person reads the customer back
under RLS with its own permissions.

## 7. Boundaries & relationships

- **Consumes** `governorates` (EPIC-7 reference data — an existence check, not a
  tenant check, because governorates are system data), the EPIC-5 access catalog
  (`customers` feature, `read`/`manage`), the EPIC-6 event bus, and the shared
  `audit_log`.
- **Owns** `customers` and `customer_addresses` and nothing else.
- **Is consumed by** EPIC-11 (orders reference a customer and will compute the
  KPIs), EPIC-12 (shipping reads the delivery address), EPIC-14 (analytics).

## 8. What EPIC-11 inherits

| Item                                                     | Why it waits                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ordersCount` / `totalSpent` / `lastOrderAt` computation | Nothing to count until orders exist.                                          |
| `hasOrders` filter, `-ordersCount` / `-totalSpent` sorts | They sort and filter on the above.                                            |
| `GET /v1/customers/{id}/orders`                          | Needs orders.                                                                 |
| `POST /v1/customers/merge`                               | Decision D3 — written once against the complete set of customer-owned tables. |

Until then the columns exist, default correctly, and **no code writes them** — the
same discipline `product_variants.average_cost` follows for EPIC-13.

## 9. Layering

`domain` (entities, errors, `normalizeE164`/`maskPhone`, list-query parsing) ←
`application` (`CustomersService`: tenant enforcement, normalization,
audit-then-emit) ← `infrastructure` (Prisma repository — RLS binding and the whole
PII round-trip) · `presentation` (controller + DTOs). Dependencies point inward;
**nothing above the repository ever sees a hash or a ciphertext.**
