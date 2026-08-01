# Domain Events — the in-process event bus

**Status:** Built (EPIC-6, M6.1–M6.2) + first real subscriber (EPIC-15, M15.2)
· **ADR:** [0004 AI-out / Extensible](adr/README.md)
· **Code:** [`apps/api/src/shared/events/`](../apps/api/src/shared/events/)

The event bus is the seam that lets modules react to one another's domain facts
**without calling across feature boundaries**. A publisher announces that
something happened; any number of subscribers respond. Neither knows about the
other — the only shared surface is the typed event catalog. This is what makes
the "modular / event-driven" language in the ADRs real rather than aspirational.
Every publisher from EPIC-5 through EPIC-14 had zero subscribers; EPIC-15's
`NotificationDispatchService` is the bus's **first real subscriber** —
`order.status_changed`/`payment.collected` fan out into an in-app notification
and a queued Web Push delivery for the order's assignee.

---

## 1. Design in one screen

- **Typed, closed catalog.** Every event and its payload is declared once in
  [`event-catalog.ts`](../apps/api/src/shared/events/event-catalog.ts). A new
  event is a deliberate, reviewed edit there — never an ad-hoc string. The
  compiler rejects a wrong type name or a mis-shaped payload at both ends.
- **Synchronous dispatch (v1.0).** `publish` invokes every subscriber for the
  event's type, in registration order, and **awaits** each. When `publish`
  resolves, the handlers have run. This keeps emission adjacent to the request
  that caused it — simple to reason about, no broker, no eventual-consistency
  window. **The bus itself stayed synchronous in EPIC-15** (decision D3,
  [epic-15-design.md](epic-15-design.md)) — the durable, retried piece that
  landed is the _outbound Web Push send_ (`notification_deliveries`, the
  `shipping_webhook_events`/`WebhookRetryWorker` shape reused for an outbound
  queue), not bus dispatch. Publishers did not change.
- **Subscriber isolation is guaranteed.** A handler that throws or rejects is
  caught, logged, and skipped; the publisher and the sibling handlers are never
  affected. Emission is therefore **additive and best-effort** — it rides
  alongside the publisher's own durable write (e.g. the `audit_log`) and must
  never replace it.
- **One process is the boundary.** In-process `Map<type, Set<handler>>`, matching
  the no-Redis stack. Across multiple instances an event reaches only the
  handlers in the publishing process (the same single-process assumption as the
  capability cache — see [access-review.md](access-review.md) A1).
- **Global module.** [`EventBusModule`](../apps/api/src/shared/events/event-bus.module.ts)
  is `@Global`; inject the `EVENT_BUS` port anywhere without importing it.

## 2. The port

```ts
import { EVENT_BUS, type EventBusPort } from "src/shared/events/event-bus.port";

interface EventBusPort {
  publish<T extends DomainEventType>(event: DomainEvent<T>): Promise<void>;
  subscribe<T extends DomainEventType>(type: T, handler: EventHandler<T>): Unsubscribe;
}
```

Every event carries a common envelope plus its typed payload:

```ts
interface DomainEvent<T> {
  readonly type: T; // a key of the catalog
  readonly companyId: string; // events are always tenant-scoped
  readonly actorId: string | null; // the user who caused it, or null (system)
  readonly occurredAt: number; // epoch milliseconds (from the injected Clock)
  readonly payload: EventPayloads[T]; // event-specific, secret-free
}
```

## 3. The catalog

Payloads MUST be **secret-free** (same rule as the audit log) — they may be
logged and, later, queued for delivery.

| Event                        | Emitted by (today)                      | Payload                                                                                                   | Status              |
| ---------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------- |
| `access.permissions_changed` | `AccessService` (member assign)         | `memberId`, `memberUserId`, `templateKey?`                                                                | **Live** (EPIC-5/6) |
| `access.feature_toggled`     | `AdminService` (Super-Admin)            | `featureKey`, `enabled`                                                                                   | **Live**            |
| `subscription.changed`       | `AdminService` (Super-Admin)            | `planCode`                                                                                                | **Live**            |
| `master_data.changed`        | `MasterDataService` (EPIC-7)            | `resource`, `id`, `change`                                                                                | **Live** (EPIC-7)   |
| `product.created`            | `ProductsService` (EPIC-8)              | `productId`                                                                                               | **Live** (EPIC-8)   |
| `product.updated`            | `ProductsService` (EPIC-8)              | `productId`                                                                                               | **Live** (EPIC-8)   |
| `product.archived`           | `ProductsService` (EPIC-8)              | `productId`                                                                                               | **Live** (EPIC-8)   |
| `stock.changed`              | `InventoryService` (EPIC-9)             | `warehouseId`, `variantId`, `onHandDelta`, `committedDelta`, `onHand`, `committed`, `available`, `reason` | **Live** (EPIC-9)   |
| `stock.low`                  | `InventoryService` (EPIC-9)             | `warehouseId`, `variantId`, `available`, `reorderPoint`                                                   | **Live** (EPIC-9)   |
| `customer.created`           | `CustomersService` (EPIC-10)            | `customerId`                                                                                              | **Live** (EPIC-10)  |
| `customer.updated`           | `CustomersService` (EPIC-10)            | `customerId`, `fields`                                                                                    | **Live** (EPIC-10)  |
| `customer.exported`          | `CustomersService` (EPIC-10)            | `count`                                                                                                   | **Live** (EPIC-10)  |
| `customer.merged`            | `CustomersService` (EPIC-11)            | `survivingCustomerId`, `mergedCustomerId`                                                                 | **Live** (EPIC-11)  |
| `order.created`              | `OrdersService` (EPIC-11)               | `orderId`                                                                                                 | **Live** (EPIC-11)  |
| `order.status_changed`       | `OrdersService` (EPIC-11)               | `orderId`, `fromStatus`, `toStatus`                                                                       | **Live** (EPIC-11)  |
| `order.assigned`             | `OrdersService` (EPIC-11)               | `orderId`, `assigneeId`                                                                                   | **Live** (EPIC-11)  |
| `payment.collected`          | `OrdersService` (EPIC-11)               | `orderId`, `amountMinor`                                                                                  | **Live** (EPIC-11)  |
| `shipment.created`           | `ShippingService` (EPIC-12)             | `shipmentId`, `orderId`, `carrier`                                                                        | **Live** (EPIC-12)  |
| `shipment.status_changed`    | `ShippingService` (EPIC-12)             | `shipmentId`, `orderId`, `fromStatus`, `toStatus`                                                         | **Live** (EPIC-12)  |
| `shipment.delivered`         | `ShippingService` (EPIC-12)             | `shipmentId`, `orderId`, `feeMinor`                                                                       | **Live** (EPIC-12)  |
| `purchase_order.received`    | `FinanceService` (EPIC-13)              | `purchaseOrderId`, `receiptId`                                                                            | **Live** (EPIC-13)  |
| `payment.recorded`           | `FinanceService` (EPIC-13)              | `purchaseOrderId`, `amountMinor`                                                                          | **Live** (EPIC-13)  |
| `invoice.issued`             | `FinanceService` (EPIC-13)              | `invoiceId`, `orderId`                                                                                    | **Live** (EPIC-13)  |
| `refund.issued`              | `FinanceService` (EPIC-13)              | `refundId`, `amountMinor`                                                                                 | **Live** (EPIC-13)  |
| `period.closed`              | `FinanceService` (EPIC-13)              | `periodKey`                                                                                               | **Live** (EPIC-13)  |
| `notification.created`       | `NotificationDispatchService` (EPIC-15) | `notificationId`, `recipientProfileId`, `type`                                                            | **Live** (EPIC-15)  |
| `notification.delivered`     | `DeliveryProcessorService` (EPIC-15)    | `notificationId`, `pushSubscriptionId`                                                                    | **Live** (EPIC-15)  |

`stock.changed` is emitted **once per affected level** — a transfer emits two,
one per side — and only when stock actually moved: an idempotent replay
(`Idempotency-Key`) emits nothing. `stock.low` is **edge-triggered**: it fires on
the write that crossed a non-zero reorder point, not repeatedly while the level
stays low. See [api/inventory.md](api/inventory.md).

The `customer.*` payloads carry **ids and field names only** — never a phone,
email, name or address. An event payload may be logged and, later, queued, so
personal data must not ride on one; a subscriber that needs the person reads the
customer back under RLS with its own permissions
([privacy-model.md](privacy-model.md) §6). As with inventory, an idempotent
replay of a create emits **nothing** — it wrote nothing.

The `order.*` and `payment.collected` payloads follow the same rule — ids only.
`order.status_changed` carries the `from`/`to` state; `payment.collected` fires
on a COD collection with the positive `amountMinor` delta (EPIC-11 emits it, and
finance EPIC-13 reads it). `customer.merged` fires once per merge, alongside the
durable audit row (owner decision D5).

`notification.created` is emitted alongside its durable audit write, after the
`Notification` row commits (`actorId` is always `null` — system-originated).
`notification.delivered` is edge-triggered by the delivery retry worker when a
`notification_deliveries` row reaches `processed`. Only `order.status_changed`/
`payment.collected` are consumed today; `stock.low` fan-out is deferred
(no company-wide member-permission broadcast primitive exists yet — see
[epic-15-design.md](epic-15-design.md) §3/D7).

No entries are forward-declared any more — every event in the catalog is live.

## 4. Publishing

Publish **after** the durable write and any cache invalidation, so a synchronous
subscriber that re-reads sees the committed state. Emission is best-effort — a
failed handler is logged, not surfaced — so never move a correctness-critical
side effect into a subscriber.

```ts
await this.audit.record({ ... });        // durable source of truth (must succeed)
this.cache.invalidateCompany(companyId); // keep the read path fresh
await this.events.publish({              // additive announcement
  type: "access.feature_toggled",
  companyId,
  actorId: principal.userId,
  occurredAt: this.clock.now(),
  payload: { featureKey, enabled },
});
```

## 5. Subscribing

Register in a module's lifecycle (e.g. `onModuleInit`) and keep the returned
`Unsubscribe` if the subscriber can be torn down. A handler must not throw to the
caller for correctness — but it may; the bus isolates it.

```ts
const off = this.events.subscribe("access.feature_toggled", async (event) => {
  // event.payload is typed as { featureKey: string; enabled: boolean }
  await this.doSomething(event.companyId, event.payload.featureKey);
});
```

## 6. Adding an event

1. Add the key + payload to `EventPayloads` in `event-catalog.ts` (secret-free).
2. Publish it from the owning module **alongside** its durable write.
3. Document it in the table above (owning epic + payload).
4. Cover it: a publish-side assertion in the emitter's test; handler-side tests
   where a subscriber exists. The bus itself is exhaustively unit-tested
   ([`in-process-event-bus.test.ts`](../apps/api/src/shared/events/in-process-event-bus.test.ts)).

## 7. Non-goals for v1.0 (deferred, by ADR)

- **Durability / retry / dead-letter for bus dispatch itself** — the bus stays
  synchronous, in-process, best-effort (D3). EPIC-15's durability landed one
  layer down, in the outbound Web Push queue, not here.
- **Cross-process / cross-instance delivery** — needs a broker; out of scope for
  the single-process stack.
- **Event sourcing / replay** — the `audit_log` is the durable record; the bus is
  a live notification channel, not a log.
- **`stock.low` fan-out / a company-wide broadcast subscriber** — needs a
  primitive that resolves every member's effective capabilities, not just one
  FK; deferred (EPIC-15/D7).
