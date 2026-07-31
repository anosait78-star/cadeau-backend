# Shipping API Contract

**Status:** ⬜ Draft — planned in **EPIC-12** · **Base path:** `/v1/shipping` ·
**Feature key:** `SHIPPING` · **Access:** authenticated + gated

A **carrier-abstraction layer** over Egyptian carriers (Bosta and others), bulk
shipping + waybill printing, configurable zones, reliable inbound webhooks
(queued + retried), in-order tracking, and shipping-fee deduction from collected.
Draft — follows [../api-conventions.md](../api-conventions.md).

## Resources

- `Carrier` — an integrated shipping provider (behind the abstraction).
- `Shipment` — a dispatched order with tracking + status.
- `Waybill` — a printable label for a shipment.

## Planned endpoints

| Method | Path                                          | Purpose                                                                   | Permission        |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------- | ----------------- |
| GET    | `/v1/shipping/carriers`                       | Available carriers.                                                       | `shipping.read`   |
| POST   | `/v1/shipping/shipments`                      | Create a shipment for an order. Idempotency-Key.                          | `shipping.manage` |
| POST   | `/v1/shipping/shipments/bulk`                 | Bulk-create shipments. Idempotency-Key.                                   | `shipping.manage` |
| GET    | `/v1/shipping/shipments/{shipmentId}`         | Shipment + tracking.                                                      | `shipping.read`   |
| POST   | `/v1/shipping/shipments/{shipmentId}/waybill` | Waybill metadata (tracking/label fields; no PDF in this epic, see below). | `shipping.manage` |
| POST   | `/v1/shipping/webhooks/{carrier}/{companyId}` | Inbound carrier callback (queued, verified).                              | webhook signature |

## List parameters

- `shipments` — filter: `carrier`, `status`, `orderId`, `createdAtFrom/To`; sort (whitelist): `-createdAt,id`.

## Events emitted (ADR-004)

- `shipment.created`, `shipment.status_changed`, `shipment.delivered`.

## Notes

- Webhooks are **signature-verified**, **enqueued** (a durable DB-backed inbox,
  no new queue dependency), and **retried** with exponential backoff;
  processing is idempotent on `(carrier, carrierEventId)`.
- The company is resolved from the **signed webhook path**
  (`{carrier}/{companyId}`), never from the payload (ADR-0003) — the same
  principle as tenant resolution everywhere else in the API.
- Shipping fees are a **simple deduction** from the collected amount at
  delivery in this epic; matching that fee against carrier remittance/invoices
  ("working shipping reconciliation") is EPIC-13.
- Waybill generation returns **tracking/label metadata only** in this epic — no
  PDF body. PDF rendering reuses the vetted PDF library EPIC-13 needs for
  official invoices, so it ships once.
- The carrier abstraction (`CarrierPort`) keeps provider specifics out of the
  core (ADR-004). The only adapter shipped in EPIC-12 is a manual/mock carrier;
  a real Bosta adapter is a future, additive implementation of the same port.
