# Orders API Contract

**Status:** ✅ **Delivered — EPIC-11** (`feat/epic-11-orders`) · **Base path:**
`/v1/orders` · **Feature key:** `orders` · **Access:** authenticated + three-layer
gated (`orders.read` / `orders.manage`).

The core of the system: a 12-state order lifecycle plus a separate follow-up
state, deterministic smart-paste (Regex/Heuristics — **no AI**, ADR-0004), keyset
lists with deep-linking, and a pivotal `collectedAmount`. Follows
[../api-conventions.md](../api-conventions.md). Design: [../epic-11-design.md](../epic-11-design.md).

## Resources

- `Order` — header + items + status + `collectedAmount` + `warehouseId`
  (create-time only) + label/reason.
- `OrderItem` — a variant line (qty, price, **cost snapshot** frozen at add time).
- `OrderActivity` — the append-only activity/audit log for an order.
- `OrderVendorGroup` (Vendor Accounts, Phase 2/3) — a vendor's slice of one
  order: the items routed to one warehouse via `order_items.warehouse_id`,
  plus that warehouse's own `new → processing → ready → delivered` status.
  Materialized idempotently (never duplicated) both when the company-side
  `GET .../vendor-groups` is read and when the Parent Order enters
  `processing`. Never affects `Order.status` itself.

## Endpoints (delivered)

| Method | Path                                 | Purpose                                                                                               | Permission      |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------- |
| GET    | `/v1/orders`                         | List (keyset + filters + deep-linking).                                                               | `orders.read`   |
| GET    | `/v1/orders/status-counts`           | Per-status counts for the status tabs.                                                                | `orders.read`   |
| POST   | `/v1/orders`                         | Create an order (now accepts `warehouseId`, `paymentStatus`, `collectedAmount`). `Idempotency-Key`.   | `orders.manage` |
| GET    | `/v1/orders/{orderId}`               | Detail (items + money).                                                                               | `orders.read`   |
| PATCH  | `/v1/orders/{orderId}`               | Edit order fields (incl. `collectedAmount`).                                                          | `orders.manage` |
| POST   | `/v1/orders/{orderId}/status`        | Transition status (state machine).                                                                    | `orders.manage` |
| POST   | `/v1/orders/{orderId}/assign`        | Assign to a member (`null` unassigns).                                                                | `orders.manage` |
| POST   | `/v1/orders/bulk/status`             | Bulk status change (per-item results).                                                                | `orders.manage` |
| POST   | `/v1/orders/bulk/assign`             | Bulk assignment (per-item results).                                                                   | `orders.manage` |
| POST   | `/v1/orders/parse`                   | Deterministic smart-paste → draft fields.                                                             | `orders.manage` |
| POST   | `/v1/orders/import`                  | Import CSV with column mapping.                                                                       | `orders.manage` |
| GET    | `/v1/orders/{orderId}/activity`      | Activity log (keyset).                                                                                | `orders.read`   |
| GET    | `/v1/orders/{orderId}/vendor-groups` | The order's items grouped by warehouse (Vendor Accounts, Phase 2/3) — the company-side tracking view. | `orders.read`   |

**Plus** on the customers module (the inherited EPIC-10 debt, decision D5):
`GET /v1/customers/{id}/orders`, `POST /v1/customers/merge`, the `hasOrders`
filter and the `-ordersCount` / `-totalSpent` sorts.

**Plus a separate vendor self-service surface** (Vendor Accounts, Phase 3),
`/v1/vendor/order-groups` — guarded by an authenticated session only, **not**
`orders.read`/`orders.manage` (a vendor holds neither; see
[tenancy.md](./tenancy.md)). Authorization is ownership-based, resolved fresh
per call from the caller's own `role = "vendor"` membership:

| Method | Path                                       | Purpose                                                                                                                                                                                              |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/vendor/order-groups`                  | My vendor groups, across every order, newest first.                                                                                                                                                  |
| POST   | `/v1/vendor/order-groups/{groupId}/status` | Advance one of my groups by one step (`new → processing → ready → delivered`). Illegal jump/skip → `422`; someone else's group, or no vendor membership → `404`; a concurrent double-submit → `409`. |

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

`order_vendor_group.status_changed` (Vendor Accounts, Phase 3) — emitted when
a vendor advances their own group's status. Ids only. No subscriber yet; a
future notification dispatcher can react without any change to the emitter.

## Notes & deviations

- **Permissions** use the standing `read` / `manage` convention (decision D1); the
  draft's `.write`/`.status`/`.assign`/`.import` fold into `manage`. No catalog
  change.
- **Status transitions** are validated by a fixed default **state machine**
  (docs/epic-11-design.md §6); an illegal transition → `422`, naming the
  attempted `from`→`to`. A per-company configurable machine is P1.
- **Cancel requires a reason** of kind `cancel`/`cancellation` → else `422`.
- **Vendor group activation (Vendor Accounts, Phase 3):** entering `processing`
  guarantees this order's `OrderVendorGroup` rows exist (grouped by the
  items' own `order_items.warehouse_id`), unconditionally — not gated by
  `applyStock`/the `inventory` feature flag, since grouping is organizational,
  not inventory-dependent. This does **not** change any vendor group's own
  status (every group is created at `"new"`) and does **not** change any
  Parent Order rule — `canTransition`/`stockEffectOf` are untouched. An order
  with no `warehouseId`-routed items (every order before this feature, and
  every non-multi-vendor order since) still resolves to zero groups. A vendor
  group's own status machine (`new → processing → ready → delivered`, one
  step at a time, no skip, no reverse) is separate from the Parent Order's —
  see the vendor self-service table above. Parent Order cancel/return does
  **not** cascade onto open vendor groups (deferred to a later phase), and no
  Parent Order transition is gated on vendor-group completion.
- **Stock coupling (decision D2):** entering `processing` reserves stock via the
  EPIC-9 path; `shipped` decrements on-hand; a pre-ship cancel/return releases the
  reservation. **Feature-gated** — only when the company's `inventory` feature is
  on. `stock_reservations.order_id` is now a real FK. `Order.warehouseId`, when set
  at create, takes precedence over the company's default-warehouse resolution when
  reserving stock at `processing` (falls back to the prior default-resolution logic
  when null — fully backward compatible with orders created before this field
  existed).
- **Payment at create:** `paymentStatus`/`collectedAmount` may now be supplied on
  `POST /v1/orders` (previously `PATCH`-only, always `unpaid` on create). Both are
  optional and default to `unpaid`/`0` when omitted. Cross-validated: `paid`
  requires `collectedAmount === total`; `partial` requires
  `0 < collectedAmount < total`; `unpaid` requires `collectedAmount === 0`. A
  mismatch → `422` on `field: "paymentStatus"`.
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
