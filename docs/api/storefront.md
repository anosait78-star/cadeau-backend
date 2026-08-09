# Storefront Integration API Contract

**Status:** ✅ Implemented on `feat/epic-15-notifications` (backend). Web
Settings UI (design plan §6.1/§M-2/M-6) is **not yet built** — deferred as
lower priority per the implementation brief; the endpoints below are fully
usable via any HTTP client / Postman today.
**Base path:** `/v1/integrations/storefront` · **Feature key:**
`storefront_integration` · **Access:** management routes are authenticated +
three-layer gated (`integrations.manage`); the two ingestion routes are
API-key-authenticated instead — see below.

Inbound-only (v1): a company's own storefront(s) push orders and products into
Cadeau CRM. See [docs/storefront-integration-plan.md](../storefront-integration-plan.md)
for the full design (decisions D1–D9). Follows [../api-conventions.md](../api-conventions.md).

## Resources

- `StorefrontConnection` — one connected store; owns its own API key (D1/D2).
- `StorefrontWebhookEvent` — one row in the append-first ingestion inbox (D7).

## Endpoints

### Management (JWT + `integrations.manage`)

| Method | Path                                                                                | Purpose                                                               |
| ------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET    | `/v1/integrations/storefront/connections`                                           | List the company's connections (keyset).                              |
| POST   | `/v1/integrations/storefront/connections`                                           | Create a connection. **Response includes the plaintext key once.**    |
| GET    | `/v1/integrations/storefront/connections/{connectionId}`                            | Connection detail (masked `apiKeyPrefix`).                            |
| PATCH  | `/v1/integrations/storefront/connections/{connectionId}`                            | Update `label` / `defaultWarehouseId` / `status` (`active`⇄`paused`). |
| POST   | `/v1/integrations/storefront/connections/{connectionId}/rotate-key`                 | Issue a new key for this connection only. Returns it once.            |
| POST   | `/v1/integrations/storefront/connections/{connectionId}/revoke`                     | Terminal; a new connection must be created to reconnect that store.   |
| GET    | `/v1/integrations/storefront/connections/{connectionId}/events`                     | Recent webhook events (keyset; filter `status`, `eventType`).         |
| POST   | `/v1/integrations/storefront/connections/{connectionId}/events/{eventId}/reprocess` | Manually re-run one `failed` event.                                   |

### Ingestion (`Authorization: Bearer <storefront-api-key>`, no JWT)

| Method | Path                                   | Purpose                                    |
| ------ | -------------------------------------- | ------------------------------------------ |
| POST   | `/v1/integrations/storefront/orders`   | Create an order from the generic contract. |
| POST   | `/v1/integrations/storefront/products` | Create/update a product + variant + stock. |

## Request/response shapes

### `POST /v1/integrations/storefront/orders`

```jsonc
{
  "externalId": "store-order-1234",
  "placedAt": "2026-08-08T10:00:00Z",
  "customer": { "name": "أحمد محمد", "phone": "01001234567", "email": "a@b.com" },
  "items": [{ "sku": "SKU-001", "quantity": 2, "unitPriceMinor": 15000 }],
  "currency": "EGP",
  "notes": "optional",
}
```

Response: `201` `{ "entityId": "<orderId>", "status": "created" }`, `200`
`{ "entityId": "<orderId>", "status": "duplicate" }` for a re-sent
`externalId` already processed, or `200` `{ "status": "updated" }` when a
previously `failed` row for that `externalId` is retried in place. An unknown
`sku` fails the event (`422`, `UnknownSkuError`) — it is retried automatically
the next time the same `externalId` is sent, or manually via the reprocess
route once the product has synced.

### `POST /v1/integrations/storefront/products`

```jsonc
{
  "externalId": "store-product-987",
  "name": "قميص قطن",
  "sku": "SKU-001",
  "priceMinor": 15000,
  "stockQuantity": 42,
  "active": true,
}
```

Response: `201` (new product) or `200` (existing) `{ "entityId": "<productId>", "status": "created" | "updated" | "duplicate" }`.

**Deviation from the design draft (§7):** the draft describes an upsert keyed
on "`externalId` and `sku` together." No `external_id` column exists on
`products`/`product_variants` (only the pricing decision's `sellingPriceMinor`
column was added to that model) and adding one was out of scope for this
pass. Upsert is keyed on **`sku` alone**, which is already unique per company
(`product_variants_company_sku_key`) — functionally equivalent for the stable,
storefront-issued SKUs the contract expects, and avoids inventing a second,
overlapping uniqueness concept. Revisit if a platform needs true
`externalId`-only matching (e.g. a store that recycles SKUs).

## List parameters

- `connections` — keyset, sorted `createdAt desc, id desc`.
- `connections/{id}/events` — keyset, sorted `receivedAt desc, id desc`;
  filter `status` (`pending`/`processed`/`failed`), `eventType`
  (`order`/`product`).

## Events emitted (ADR-004)

None new. This module is an **additional publisher through the reused
services**, not a direct publisher on the bus (D9): an ingested order
publishes `order.created` (via `OrdersService.create`), an ingested product
publishes `product.created`/`product.updated` (via `ProductsService`), and a
stock sync publishes `stock.changed` (via `InventoryService.adjust`) —
identical to what a JWT-authenticated caller triggers.

## Platform adapters (D8) — WooCommerce

The CRM side is ready for WooCommerce; nothing on the WooCommerce/WordPress
side has been touched.

- `connection.platform` now actually routes: `StorefrontAdapterResolver`
  (application layer, reached via `STOREFRONT_ADAPTER_RESOLVER` — never a
  direct dependency on either concrete adapter class) picks
  `GenericJsonAdapter` for `platform: "generic"` or `WooCommerceAdapter` for
  `platform: "woocommerce"`; any other `platform` value throws a clear
  `UnsupportedPlatformError` (`salla`/`zid`/`shopify` are reserved enum values
  with no adapter registered yet).
- **The two ingestion routes are unchanged URLs for every platform** — `POST
.../orders` and `POST .../products` accept whichever native shape the
  resolved connection's platform expects. The request body is intentionally
  typed `unknown` at the controller (not `IngestOrderDto`/`IngestProductDto`)
  so a WooCommerce Order/Product payload isn't rejected by the global
  `ValidationPipe` before reaching a per-platform adapter; each adapter now
  owns its own shape validation instead (`GenericJsonAdapter` still enforces
  the exact shape those DTOs used to, so the generic platform's validation
  strength is unchanged).
- `WooCommerceAdapter` maps a raw WooCommerce Order/Product REST payload
  (`order.created`/`.updated`, `product.created`/`.updated` webhook events)
  onto the same `NormalizedOrder`/`NormalizedProduct` contract above — no new
  contract, no new business logic. A line's unit price is derived from
  WooCommerce's post-discount `line_items[].total` ÷ quantity (WooCommerce's
  own order-level `discount_total`/`shipping_total`/`total`/`payment_method`
  have no home in the contract and are not mapped — the reused
  `OrdersService.create` computes the CRM order's total from item price ×
  quantity itself, same as any other caller, D4). Two WooCommerce shapes are
  explicitly unsupported in v1 and fail the event with a clear, reprocessable
  reason: **variable products** (`type: "variable"` — the webhook payload
  only lists variation ids, not their price/stock/sku) and **unmanaged stock**
  (`manage_stock: false` — there is no absolute on-hand figure to sync
  without guessing).
- **WooCommerce webhook signature (optional, supplementary):** a storefront
  connection may store an encrypted webhook secret
  (`storefront_connections.webhook_secret_encrypted`, AES-256-GCM, set via
  `webhookSecret` on create/update — write-only, never returned by any read
  endpoint). When set on a `platform: "woocommerce"` connection,
  `StorefrontApiKeyGuard` additionally verifies WooCommerce's
  `X-WC-Webhook-Signature` header (`base64(hmac_sha256(secret, rawBody))`,
  `@cadeau/crypto` `verifyWooCommerceWebhookSignature`) against the exact raw
  request bytes. This is **never a substitute** for the storefront API key —
  a connection with no secret configured behaves exactly as before.

## Notes

- **Tenant resolution (D3):** the ingestion guard (`StorefrontApiKeyGuard`)
  resolves `companyId`/`connectionId` from the API key alone. Any
  `companyId`-shaped field in a request body is ignored — never trusted.
- **API keys (D1/D2):** minted with 256 bits of entropy (`sfk_<base64url>`),
  hashed with `@cadeau/crypto` `hashPassword` (scrypt) — the same primitive as
  user passwords. Only a non-secret 8-character prefix is stored in the clear
  for display/lookup narrowing; the guard verifies each same-prefix candidate
  with `verifyPassword`. The plaintext is returned exactly once, at
  create/rotate time. A key belongs to one connection; rotating or revoking it
  never affects a sibling connection of the same company.
- **Webhook inbox (D7):** `storefront_webhook_events` is append-first —
  written before any processing — and idempotent on
  `(connectionId, eventType, externalId)`. A re-sent, already-`processed`
  event is a no-op (`duplicate`); a `pending`/`failed` row is retried in
  place. No automatic retry worker ships in v1 (contrast
  `shipping_webhook_events`) — a `failed` row is re-run manually via the
  reprocess route.
- **No duplicated business logic (D4):** the module's own code is limited to
  connection/key management, inbox bookkeeping, and payload→command mapping
  (`StorefrontAdapterPort`/`GenericJsonAdapter`, D8). Every actual write goes
  through the existing `OrdersService.create`, `ProductsService.create` /
  `createVariant` / `updateVariant` / `findVariantBySku`,
  `InventoryService.listStock` / `listWarehouses` / `adjust`, and
  `CustomersService.list` / `create` — reached through four small
  `shared/contracts` ports (`ORDERS_INGESTION`, `PRODUCTS_CATALOG`,
  `INVENTORY_ADJUSTMENT`, `CUSTOMERS_DIRECTORY`) so the architecture's
  `no-cross-feature-imports` rule holds; each owning module binds
  `useExisting` to its own service, the same pattern `AuthModule` already
  uses for `SESSION_REISSUE`.
- **Stock sync (D5):** the ingested `stockQuantity` is an **absolute**
  on-hand figure; the module computes the signed delta against the current
  level and applies it through `InventoryService.adjust` with reason
  `storefront_sync` (a new value in the existing closed reason set — no new
  calculation/trigger logic). Target warehouse: the connection's
  `defaultWarehouseId`, falling back to the company's default warehouse.
- **Customer matching (D6):** phone is normalized to E.164 and looked up via
  `CustomersService.list({ q: phone })` (the existing blind-index exact-match
  path), creating via `CustomersService.create` on a miss — no new matching
  logic, no raw phone stored in this module.
- **System attribution:** a write made from an ingestion request has no human
  JWT principal. It is attributed to the connection's own `createdBy` (the
  admin who created the connection) so `created_by`/`actor_id` FK constraints
  (e.g. `order_activities`) are satisfied exactly as a normal authenticated
  write would be. If that admin's account has since been removed, ingestion
  for that connection fails closed (`422`) until the connection is rotated or
  recreated by another admin — a known limitation of this attribution choice.
- **Pricing (final decision, supersedes the design draft's open §8):**
  `ProductVariant.sellingPriceMinor` (`bigint`, integer minor units, default
  `0`) is what the ingested `priceMinor` maps to. `averageCost` remains
  purchase-cost-only, derived exclusively from PO receipts (EPIC-13) — never
  read or written anywhere in this module.
