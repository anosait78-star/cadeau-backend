# Product Domain Model (EPIC-8)

**Status:** ✅ Delivered · **Branch:** `feat/epic-8-products` · **Migration:**
`20260803000000_products`.

The catalog domain: what a **product** and a **variant** are, the invariants that
hold regardless of transport, and how the model connects to the rest of the
system. Implementation lives in
[`apps/api/src/modules/products/`](../apps/api/src/modules/products/); the HTTP
surface is [api/products.md](api/products.md).

---

## 1. Aggregate

The **Product** is the aggregate root; **ProductVariant** is a child entity that
exists only under a product.

```
Product (products)
  ├─ id, companyId
  ├─ name (unique per company), description?
  ├─ categoryId?  → product_categories   (EPIC-7 master data)
  ├─ unitId?      → units                 (EPIC-7 master data)
  ├─ active (soft-delete flag)
  └─ variants: ProductVariant[]
        ProductVariant (product_variants)
          ├─ id, companyId, productId
          ├─ name (unique per product)
          ├─ sku?      (unique per company when present)
          ├─ barcode?  (unique per company when present)
          ├─ averageCost  (derived, read-only, minor units)
          └─ active
```

A variant is never addressed except through its parent (`/v1/products/{id}/variants/…`);
deleting a product cascades to its variants at the DB level.

## 2. Entities & fields

### Product

| Field         | Type     | Notes                                             |
| ------------- | -------- | ------------------------------------------------- |
| `id`          | uuid     | Server-generated.                                 |
| `name`        | text     | Required, 1–200. **Unique per company.**          |
| `description` | text?    | ≤2000, nullable.                                  |
| `categoryId`  | uuid?    | → `product_categories` (same tenant). `SET NULL`. |
| `unitId`      | uuid?    | → `units` (same tenant). `SET NULL`.              |
| `active`      | boolean  | `is_active`; `false` = archived.                  |
| timestamps    | ISO-8601 | `createdAt` / `updatedAt` (trigger-touched).      |

### ProductVariant

| Field         | Type     | Notes                                               |
| ------------- | -------- | --------------------------------------------------- |
| `id`          | uuid     | Server-generated.                                   |
| `productId`   | uuid     | Parent product (same tenant).                       |
| `name`        | text     | Required, 1–200. **Unique per product.**            |
| `sku`         | text?    | ≤120. **Unique per company when present.**          |
| `barcode`     | text?    | ≤120. **Unique per company when present.**          |
| `averageCost` | int      | Minor units. **Derived (EPIC-13), read-only, ≥ 0.** |
| `active`      | boolean  | `is_active`.                                        |
| timestamps    | ISO-8601 | Trigger-touched.                                    |

## 3. Invariants

1. **Tenant containment.** Every product, variant, and referenced category/unit
   belongs to exactly one company. Enforced twice: the repository binds
   `setTenantContext` and filters on `companyId`, **and** Postgres `FORCE` RLS
   with `USING/WITH CHECK (company_id = app.current_company_id())`.
2. **Name uniqueness.** Product name unique per company; variant name unique per
   product. DB unique constraints; violation → `409`.
3. **Code uniqueness.** `sku` and `barcode` unique per company **only when
   present** (partial unique indexes) — multiple NULLs coexist. Violation → `409`.
4. **Reference integrity.** `categoryId`/`unitId` must resolve to a row in the
   same tenant; checked inside the write transaction → missing → `422`.
5. **`averageCost` is read-only and non-negative.** Never accepted from a client;
   defaults to `0`; a `>= 0` CHECK backs it. It becomes a moving average once
   receipts (EPIC-13) post against the variant.
6. **Deletes are soft.** Archiving sets `active = false`; the row and its variants
   remain so historical orders / COGS keep resolving. Reads default to active-only.

## 4. Money

`averageCost` is an **integer count of minor units** (api-conventions §money) —
never a float. Stored as `bigint`, surfaced as `number` in the view. It is the
only monetary field in this domain and it is entirely derived; the products module
never computes or writes it (that is EPIC-13's moving-average logic on receipt).

## 5. Lifecycle & events

| Transition      | Effect                      | Event                             |
| --------------- | --------------------------- | --------------------------------- |
| Create product  | Row inserted, audited       | `product.created`                 |
| Update product  | Attributes patched, audited | `product.updated`                 |
| Archive product | `active = false`, audited   | `product.archived`                |
| Add variant     | Variant inserted, audited   | `product.updated` (parent-scoped) |
| Update variant  | Variant patched, audited    | `product.updated` (parent-scoped) |

Each write records a durable `audit_log` row **first** (source of truth), then
publishes on the EPIC-6 bus (additive). Variant changes surface as
`product.updated` because the product is the aggregate downstream consumers track.

## 6. Boundaries & relationships

- **Upstream (depends on):** EPIC-7 master data (`product_categories`, `units`) for
  optional classification; EPIC-5 access (`products` feature, `products.read` /
  `products.manage`); EPIC-6 event bus.
- **Downstream (will depend on this):** EPIC-9 Inventory (stock per variant,
  `stock.changed`), EPIC-11 Orders (order lines reference a variant), EPIC-13
  Receipts (writes `averageCost`). The `hasStock` list filter is intentionally
  deferred to EPIC-9.

## 7. Layering

`domain` (entities, ports, list-query, errors) ← `application` (`ProductsService`:
tenant enforcement, orchestration, audit + emit) ← `infrastructure` (Prisma
repository, RLS transactions, audit adapter) · `presentation` (controller, DTOs).
Dependencies point inward; data access only in `infrastructure`; enforced by
`pnpm arch:check`.

See [products-review.md](products-review.md) for the dimension-by-dimension
review and [epic-8-quality-gate.md](epic-8-quality-gate.md) for the §2.5 gate.
