# Shipping API Contract

**Status:** 🟡 **M12.1–M12.4 delivered** on `feat/epic-12-shipping`: carriers/
shipments/bulk/detail/status/waybill routes
([shipping.controller.ts](../../apps/api/src/modules/shipping/presentation/shipping.controller.ts))
plus the signature-verified inbound webhook + retry worker
([shipping-webhooks.controller.ts](../../apps/api/src/modules/shipping/presentation/shipping-webhooks.controller.ts),
[webhook-retry-worker.ts](../../apps/api/src/modules/shipping/infrastructure/webhook-retry-worker.ts)).
**Base path:** `/v1/shipping` · **Feature key:** `shipping` · **Access:**
authenticated + three-layer gated (the webhook route is the one exception —
signature-verified instead, see below).

A **carrier-abstraction layer** over Egyptian carriers (Bosta and others), bulk
shipping + waybill printing, configurable zones, reliable inbound webhooks
(queued + retried), in-order tracking, and shipping-fee deduction from collected.
Follows [../api-conventions.md](../api-conventions.md).

## Resources

- `Carrier` — an integrated shipping provider (behind the abstraction).
- `Shipment` — a dispatched order with tracking + status.
- `Waybill` — a printable label for a shipment.

## Endpoints

| Method | Path                                          | Purpose                                                                                                                                                                              | Permission        |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| GET    | `/v1/shipping/carriers`                       | Available carriers (today: `manual` only, D1).                                                                                                                                       | `shipping.read`   |
| POST   | `/v1/shipping/shipments`                      | Create a shipment for an order. Idempotency-Key.                                                                                                                                     | `shipping.manage` |
| POST   | `/v1/shipping/shipments/bulk`                 | Bulk-create shipments from a list of order ids (per-item results).                                                                                                                   | `shipping.manage` |
| GET    | `/v1/shipping/shipments/{shipmentId}`         | Shipment + tracking.                                                                                                                                                                 | `shipping.read`   |
| GET    | `/v1/shipping/orders/{orderId}/shipment`      | The most recent shipment for an order (M12.5 — order-detail tracking without a general list endpoint).                                                                               | `shipping.read`   |
| POST   | `/v1/shipping/shipments/{shipmentId}/status`  | Transition status (also used to cancel: `toStatus: "cancelled"`) — the "authenticated internal endpoint for manual status entry" a real carrier's webhook will otherwise drive (D1). | `shipping.manage` |
| POST   | `/v1/shipping/shipments/{shipmentId}/waybill` | Waybill metadata (tracking/label fields; no PDF in this epic, see below).                                                                                                            | `shipping.manage` |
| POST   | `/v1/shipping/webhooks/{carrier}/{companyId}` | Inbound carrier callback (queued, verified).                                                                                                                                         | webhook signature |

## List parameters

- `shipments` — filter: `carrier`, `status`, `orderId`, `createdAtFrom/To`; sort
  (whitelist): `-createdAt,id`. **Not yet wired to a `GET /v1/shipping/shipments`
  list route** — M12.3 shipped detail-by-id only; a keyset list endpoint is a
  straightforward follow-up (same idiom as `GET /v1/orders`), tracked as debt
  rather than blocking this milestone.

## Events emitted (ADR-004)

- `shipment.created`, `shipment.status_changed`, `shipment.delivered`.

## Notes

- Webhooks are **signature-verified** — `X-Webhook-Signature` is an
  HMAC-SHA256 hex digest of the exact raw request body, keyed by
  `SHIPPING_WEBHOOK_SIGNING_SECRET` (docs/configuration.md). Verified against
  `req.rawBody` (Nest's `rawBody: true`, `main.ts`), never the re-serialized
  parsed body.
- **Enqueued** into a durable DB-backed inbox (`shipping_webhook_events`, no
  new queue dependency) and **retried** with exponential backoff (30s,
  doubling, capped at 1h; parked after 10 attempts) by an in-process poll
  worker (`WebhookRetryWorker`, 5s tick). Processing is idempotent on
  `(carrier, carrierEventId)` — a duplicate delivery is a no-op, `202`
  either way.
- A processed event applies its shipment transition through the same
  `ShippingService` path an authenticated `/status` call uses, just with
  `actorId: null` (system-originated) — audit + events are identical either way.
- The company is resolved from the **signed webhook path**
  (`{carrier}/{companyId}`), never from the payload (ADR-0003) — the same
  principle as tenant resolution everywhere else in the API. The retry
  worker's cross-tenant _claim_ step is the one deliberate exception to
  per-request tenant scoping (see the M12.4 migration's header for why).
- Shipping fees are a **simple deduction** from the collected amount at
  delivery in this epic; matching that fee against carrier remittance/invoices
  ("working shipping reconciliation") is EPIC-13.
- Waybill generation returns **tracking/label metadata only** in this epic — no
  PDF body. PDF rendering reuses the vetted PDF library EPIC-13 needs for
  official invoices, so it ships once.
- The carrier abstraction (`CarrierPort`) keeps provider specifics out of the
  core (ADR-004). The only adapter shipped in EPIC-12 is a manual/mock carrier;
  a real Bosta adapter is a future, additive implementation of the same port.
