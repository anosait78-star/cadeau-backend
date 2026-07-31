# Shipping Domain Model (EPIC-12)

**Status:** ✅ Delivered — 2026-07-31 · Module:
[`apps/api/src/modules/shipping`](../apps/api/src/modules/shipping/) · Contract:
[api/shipping.md](api/shipping.md) · Design: [epic-12-design.md](epic-12-design.md) ·
Where it fits: [domain-map.md](domain-map.md).

Shipping dispatches an order (EPIC-11) into the physical world: a carrier, a
tracking number, an in-order lifecycle, and a reliable way to learn — often
asynchronously, from the carrier — that it moved.

---

## 1. Aggregate

**Shipment** is the aggregate root: one shipment per order in this epic
(per-order-split shipments are P1).

```
Shipment  (aggregate root)
  └── (no owned child rows in M12 — waybill is metadata on the shipment itself)

ShippingWebhookEvent   (a separate aggregate: the durable inbox row for one
                        inbound carrier callback, keyed by (carrier, carrierEventId))
```

## 2. Entities & fields (highlights)

| Field            | Notes                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `orderId`        | Pinned (`RESTRICT`) — a shipment always resolves its order; one order, one active shipment.         |
| `carrier`        | Free-text column (`"manual"` today, D1) — a real carrier is an additive value, not a schema change. |
| `trackingNumber` | Unique per company + carrier; assigned by the `CarrierPort` adapter at creation.                    |
| `status`         | 6-state machine (§4), independent of the order's own 12-state machine.                              |
| `fee`            | Integer minor units, default `0`; deducted from the order's `collectedAmount` at delivery (D4).     |
| `waybillIssued`  | Boolean flag only (D3) — no PDF is stored or rendered in this epic.                                 |
| `deliveredAt`    | Set exactly once, on the transition into `delivered`.                                               |

`ShippingWebhookEvent`: `carrier`, `carrierEventId`, `payload` (raw verified
jsonb), `status` (`pending`/`processing`/`processed`/`failed`), `attempts`,
`nextAttemptAt` (exponential backoff), `processedAt?`. `companyId` is **NOT
NULL, resolved synchronously** from the signed webhook path — see §6.

## 3. Invariants

| #   | Invariant                                                            | Enforced by                                                                   |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| I1  | An order may only be shipped from `ready`/`shipped`                  | `isShippableOrderStatus` guard → `422 OrderNotShippableError`                 |
| I2  | Legal status transitions only; terminal states never re-open         | `shipment-status.ts` state machine → `422 IllegalTransitionError`             |
| I3  | One **active** shipment per order at a time                          | Repository uniqueness check → `409 DuplicateActiveShipmentError`              |
| I4  | An idempotent create replay changes nothing                          | `Idempotency-Key` — no second row, no audit, no event                         |
| I5  | `Shipment.fee` deducts from `collectedAmount` only once, at delivery | Deduction applied inside the same transaction as the `delivered` transition   |
| I6  | A webhook callback is processed exactly once                         | `UNIQUE(carrier, carrierEventId)` on the inbox + row lock during processing   |
| I7  | The application layer never depends on a carrier's identity          | `CarrierPort` interface; only `infrastructure` imports `ManualCarrierAdapter` |
| I8  | Money stays integer minor units end to end                           | Same discipline as orders — no float ever touches `fee`/`collectedAmount`     |

## 4. State machine

Six states, much simpler than the order's 12-state machine
([epic-11-design.md](epic-11-design.md) §6), expressed the same way — pure
data + functions, no I/O (`shipment-status.ts`):

```
created ──▶ picked_up ──▶ in_transit ──▶ delivered   (terminal)
   │              │              │
   └─▶ cancelled  └─▶ returned ◀─┘        (both terminal)
```

`delivered`, `returned`, `cancelled` are terminal — no further transition is
legal once reached. There is no per-company configurable machine (P1, same
deferral as orders').

## 5. Lifecycle & events

| Trigger                     | Audit action                                         | Event                      |
| --------------------------- | ---------------------------------------------------- | -------------------------- |
| Create (single or bulk)     | `shipment.created`                                   | `shipment.created`         |
| Create replay (same key)    | — none                                               | — none                     |
| Status transition           | `shipment.status_changed` (or `shipment.cancelled`)  | `shipment.status_changed`  |
| Transition into `delivered` | (as above) + `feeDeducted` on the order              | + `shipment.delivered`     |
| Waybill issued              | `shipment.waybill_issued`                            | — none (metadata-only, D3) |
| Webhook-driven transition   | same as an authenticated transition, `actorId: null` | same as above              |

Every payload carries **ids and field names only** — no PII (same discipline
as orders/customers). A webhook-driven transition runs through the exact same
`ShippingService.applySystemTransition` → `recordTransitionCore` path an
authenticated `/status` call uses; only the actor differs (`null` for
system-originated).

## 6. The webhook inbox (D2)

Inbound carrier callbacks never call domain code directly. The route is
`POST /v1/shipping/webhooks/{carrier}/{companyId}` — signature-verified
(`X-Webhook-Signature`, HMAC-SHA256 over the raw body,
`webhook-signature.guard.ts`), written to `shipping_webhook_events` first
(`pending`), then processed by `WebhookRetryWorker` (5s poll tick):

1. Claim due rows across **every** tenant (`SELECT … FOR UPDATE SKIP LOCKED`) —
   the one deliberate cross-tenant step in this codebase, because the worker
   is a platform-level job, not a per-request handler (see the M12.4 migration
   header, `20260808000000_shipping_webhook_worker_rls`).
2. Apply the shipment transition inside one transaction, with the event's own
   `company_id` bound as the active tenant for that unit of work.
3. Audit + emit, then mark the row `processed`; a thrown error marks it
   `failed` and reschedules `nextAttemptAt` with exponential backoff (30s,
   doubling, capped at 1h, parked after 10 attempts).

Reprocessing the same `(carrier, carrierEventId)` is a no-op — idempotency is
a unique constraint, not an application-level check.

## 7. Boundaries

- **Consumes** orders (pinned FK, reads/writes `collectedAmount` via the same
  order repository path), the EPIC-7 `shipping_zones` master data (seeded,
  no consumer logic yet — P1 rate cards), the EPIC-5 access catalog
  (`shipping` feature, `read`/`manage`), the EPIC-6 event bus, `audit_log`.
- **Owns** `shipments`, `shipping_webhook_events`.
- **Is consumed by** EPIC-13 (finance reads `shipment.delivered` +
  reconciles `fee` against carrier remittance), EPIC-14 (analytics),
  EPIC-15 (notifications may subscribe to `shipment.*`).

## 8. Layering

`domain` (`Shipment` entity views, `shipment-status.ts` state machine,
`CarrierPort`, `webhook-inbox.port`, `webhook-retry-policy.ts`, errors) ←
`application` (`ShippingService` — tenant enforcement, audit-then-emit,
fee deduction on delivery; `WebhookProcessorService` — one processing pass)
← `infrastructure` (Prisma repo, `ManualCarrierAdapter`, `WebhookInboxRepository`,
`WebhookRetryWorker` poll loop) · `presentation` (`ShippingController` +
`ShippingWebhooksController` + DTOs + `WebhookSignatureGuard`). Dependencies
point inward; the module imports no other feature module's source — it reads
orders only through the shared order repository contract, never
`modules/orders` internals.
