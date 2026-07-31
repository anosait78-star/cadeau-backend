# Domain Events — the in-process event bus

**Status:** Built (EPIC-6, M6.1–M6.2) · **ADR:** [0004 AI-out / Extensible](adr/README.md)
· **Code:** [`apps/api/src/shared/events/`](../apps/api/src/shared/events/)

The event bus is the seam that lets modules react to one another's domain facts
**without calling across feature boundaries**. A publisher announces that
something happened; any number of subscribers respond. Neither knows about the
other — the only shared surface is the typed event catalog. This is what makes
the "modular / event-driven" language in the ADRs real rather than aspirational,
and it is the plumbing that EPIC-15 (notifications) and later analytics/automation
build on.

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
  window. A durable **async** queue with retry (for notification fan-out) is
  deferred to EPIC-15 and will slot in **behind this same port** — publishers
  won't change.
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

| Event                        | Emitted by (today)              | Payload                                                                                                   | Status              |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------- |
| `access.permissions_changed` | `AccessService` (member assign) | `memberId`, `memberUserId`, `templateKey?`                                                                | **Live** (EPIC-5/6) |
| `access.feature_toggled`     | `AdminService` (Super-Admin)    | `featureKey`, `enabled`                                                                                   | **Live**            |
| `subscription.changed`       | `AdminService` (Super-Admin)    | `planCode`                                                                                                | **Live**            |
| `master_data.changed`        | `MasterDataService` (EPIC-7)    | `resource`, `id`, `change`                                                                                | **Live** (EPIC-7)   |
| `product.created`            | `ProductsService` (EPIC-8)      | `productId`                                                                                               | **Live** (EPIC-8)   |
| `product.updated`            | `ProductsService` (EPIC-8)      | `productId`                                                                                               | **Live** (EPIC-8)   |
| `product.archived`           | `ProductsService` (EPIC-8)      | `productId`                                                                                               | **Live** (EPIC-8)   |
| `stock.changed`              | `InventoryService` (EPIC-9)     | `warehouseId`, `variantId`, `onHandDelta`, `committedDelta`, `onHand`, `committed`, `available`, `reason` | **Live** (EPIC-9)   |
| `stock.low`                  | `InventoryService` (EPIC-9)     | `warehouseId`, `variantId`, `available`, `reorderPoint`                                                   | **Live** (EPIC-9)   |
| `customer.created`           | `CustomersService` (EPIC-10)    | `customerId`                                                                                              | **Live** (EPIC-10)  |
| `customer.updated`           | `CustomersService` (EPIC-10)    | `customerId`, `fields`                                                                                    | **Live** (EPIC-10)  |
| `customer.exported`          | `CustomersService` (EPIC-10)    | `count`                                                                                                   | **Live** (EPIC-10)  |
| `customer.merged`            | Customers merge (EPIC-11)       | `survivingCustomerId`, `mergedCustomerId`                                                                 | Forward-declared    |
| `order.created`              | Orders (EPIC-11)                | `orderId`                                                                                                 | Forward-declared    |
| `order.status_changed`       | Orders (EPIC-11)                | `orderId`, `fromStatus`, `toStatus`                                                                       | Forward-declared    |
| `payment.collected`          | Finance (EPIC-13)               | `orderId`, `amountMinor`                                                                                  | Forward-declared    |

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
replay of a create emits **nothing** — it wrote nothing. `customer.merged` is
forward-declared for EPIC-11 (owner decision D3).

**Forward-declared** events are listed so the vocabulary lives in one place and
notification subscribers can be typed against it now. Their payloads are minimal
and the **owning epic finalizes the shape** when it wires the emission.

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

- **Durability / retry / dead-letter** — EPIC-15, behind the same port.
- **Cross-process / cross-instance delivery** — needs a broker; out of scope for
  the single-process stack.
- **Event sourcing / replay** — the `audit_log` is the durable record; the bus is
  a live notification channel, not a log.
