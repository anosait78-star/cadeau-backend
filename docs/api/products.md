# Products API Contract

**Status:** ✅ Delivered in **EPIC-8** (`feat/epic-8-products`) · **Base path:**
`/v1/products` · **Feature key:** `products` · **Access:** authenticated + gated

Product catalog with variants, SKU/barcode, and a derived average cost / COGS
per variant. Dual view (table/cards) is a frontend concern over this contract.
Follows [../api-conventions.md](../api-conventions.md).

## Resources

- `Product` — a catalog item (parent of one or more variants). Fields: `id`,
  `name`, `description?`, `categoryId?` (→ `product_categories`, EPIC-7),
  `unitId?` (→ `units`, EPIC-7), `active`, `createdAt`, `updatedAt`.
- `ProductVariant` — a concrete sellable unit under a product; carries `sku?`,
  `barcode?`, and `averageCost`. Fields: `id`, `productId`, `name`, `sku?`,
  `barcode?`, `averageCost`, `active`, `createdAt`, `updatedAt`. (A variant's
  parent product _is_ the `parentProductId` relationship — modeled as a separate
  `product_variants` table keyed by `productId`.)

## Endpoints

| Method | Path                                            | Purpose                    | Permission        |
| ------ | ----------------------------------------------- | -------------------------- | ----------------- |
| GET    | `/v1/products`                                  | List products (keyset).    | `products.read`   |
| POST   | `/v1/products`                                  | Create a product.          | `products.manage` |
| GET    | `/v1/products/{productId}`                      | Product detail + variants. | `products.read`   |
| PATCH  | `/v1/products/{productId}`                      | Update a product.          | `products.manage` |
| DELETE | `/v1/products/{productId}`                      | Archive a product (soft).  | `products.manage` |
| GET    | `/v1/products/{productId}/variants`             | List variants.             | `products.read`   |
| POST   | `/v1/products/{productId}/variants`             | Add a variant.             | `products.manage` |
| PATCH  | `/v1/products/{productId}/variants/{variantId}` | Update a variant.          | `products.manage` |

Every route is gated by **Subscription ∧ Feature-Flag (`products`) ∧ Permission**
(EPIC-5 `AccessGuard`); any-layer failure returns `403`. The tenant comes from
the token, never the payload (ADR-003). Path ids are validated as UUIDs.

> **Permission naming.** The contract draft used `products.write`; the delivered
> module follows the project-wide `read`/`manage` convention (as with
> `master-data.*`, `orders.*`, …). The `products` feature and its
> `products.read` / `products.manage` permissions are seeded by the EPIC-5 access
> catalog — no catalog change was needed for this epic.

## List parameters

- Filter: `categoryId` (uuid), `active` (`true` default | `false` | `all`).
- Sort (whitelist): `name`, `-createdAt` (default; `id` is the tie-breaker).
- Search `q`: over product `name` and its variants' `sku` / `barcode`
  (case-insensitive `contains`).
- Pagination: **keyset only** (`cursor` + `page.nextCursor`), api-conventions §5.

## Create / update payloads

- **Product** — `name` (required, ≤200), `description?` (≤2000), `categoryId?`,
  `unitId?`. On `PATCH`, an explicit `null` clears an optional field; an omitted
  field is left unchanged. `categoryId`/`unitId` must reference a row in the same
  tenant or the write is rejected `422 UNPROCESSABLE_ENTITY` (field error).
- **Variant** — `name` (required, ≤200), `sku?` (≤120), `barcode?` (≤120),
  and (on update) `active`. `sku` and `barcode` are unique per company when
  present; a collision returns `409 CONFLICT` with the offending field.
- `averageCost` is **never** accepted from clients (stripped by the validation
  pipe); see Notes.

## Events emitted (ADR-004)

Emitted through the EPIC-6 event bus alongside the durable `audit_log` write
(audit is the source of truth; the event is additive):

- `product.created` — payload `{ productId }`.
- `product.updated` — payload `{ productId }`. Also emitted when a variant is
  added or updated (the change is attributed to the parent product).
- `product.archived` — payload `{ productId }`.

## Notes

- `averageCost` is a moving average derived from receipts (EPIC-13), stored in
  integer minor units (api-conventions §money). It defaults to `0` and is
  read-only via this API.
- **Archive is soft** (`is_active = false`): archived products keep their
  variants for historical order / COGS integrity. Reads default to active-only;
  pass `active=all` (or `false`) to include archived rows.
- **`hasStock` filter — deferred.** The original draft listed a `hasStock`
  filter; it depends on the inventory tables (EPIC-9) and is intentionally not
  implemented yet. It will be added when EPIC-9 lands.
- **Idempotency-Key — deferred.** No idempotency store exists yet (no module
  implements it); `POST` follows the same behavior as the other modules. The
  header will be honored once the shared idempotency infrastructure is built.
