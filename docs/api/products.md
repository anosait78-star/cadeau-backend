# Products API Contract

**Status:** ⬜ Draft — planned in **EPIC-8** · **Base path:** `/v1/products` ·
**Feature key:** `PRODUCTS` · **Access:** authenticated + gated

Product catalog with variants (`parentProductId`), SKU/barcode, and average
cost / COGS per variant. Dual view (table/cards) is a frontend concern over this
contract. Draft — follows [../api-conventions.md](../api-conventions.md).

## Resources

- `Product` — a catalog item (may be a parent of variants).
- `ProductVariant` — a concrete sellable unit; carries `sku`, `barcode`, `averageCost`.

## Planned endpoints

| Method | Path                                            | Purpose                            | Permission       |
| ------ | ----------------------------------------------- | ---------------------------------- | ---------------- |
| GET    | `/v1/products`                                  | List products (keyset).            | `products.read`  |
| POST   | `/v1/products`                                  | Create a product. Idempotency-Key. | `products.write` |
| GET    | `/v1/products/{productId}`                      | Product detail + variants.         | `products.read`  |
| PATCH  | `/v1/products/{productId}`                      | Update a product.                  | `products.write` |
| DELETE | `/v1/products/{productId}`                      | Archive a product.                 | `products.write` |
| GET    | `/v1/products/{productId}/variants`             | List variants.                     | `products.read`  |
| POST   | `/v1/products/{productId}/variants`             | Add a variant.                     | `products.write` |
| PATCH  | `/v1/products/{productId}/variants/{variantId}` | Update a variant.                  | `products.write` |

## List parameters

- Filter: `categoryId`, `active`, `hasStock`.
- Sort (whitelist): `name`, `-createdAt,id` (default).
- Search `q`: over `name`, `sku`, `barcode`.

## Events emitted (ADR-004)

- `product.created`, `product.updated`, `product.archived`.

## Notes

- `averageCost` is derived (moving average from receipts) — never set directly by clients.
- Archived products keep their variants for historical order/COGS integrity.
