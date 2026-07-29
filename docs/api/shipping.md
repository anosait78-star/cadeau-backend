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

| Method | Path                                          | Purpose                                          | Permission        |
| ------ | --------------------------------------------- | ------------------------------------------------ | ----------------- |
| GET    | `/v1/shipping/carriers`                       | Available carriers.                              | `shipping.read`   |
| POST   | `/v1/shipping/shipments`                      | Create a shipment for an order. Idempotency-Key. | `shipping.write`  |
| POST   | `/v1/shipping/shipments/bulk`                 | Bulk-create shipments. Idempotency-Key.          | `shipping.write`  |
| GET    | `/v1/shipping/shipments/{shipmentId}`         | Shipment + tracking.                             | `shipping.read`   |
| POST   | `/v1/shipping/shipments/{shipmentId}/waybill` | Generate a waybill (PDF).                        | `shipping.write`  |
| POST   | `/v1/shipping/webhooks/{carrier}`             | Inbound carrier callback (queued, verified).     | webhook signature |

## List parameters

- `shipments` — filter: `carrier`, `status`, `orderId`, `createdAtFrom/To`; sort (whitelist): `-createdAt,id`.

## Events emitted (ADR-004)

- `shipment.created`, `shipment.status_changed`, `shipment.delivered`.

## Notes

- Webhooks are **signature-verified**, **enqueued**, and **retried**; processing is
  idempotent on the carrier's event id.
- Shipping fees are deducted from the collected amount at reconciliation.
- The carrier abstraction keeps provider specifics out of the core (ADR-004).
