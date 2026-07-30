import type { DomainEvent, DomainEventType } from "./event-catalog";

/**
 * A subscriber for one event type. May be sync or async; the bus awaits async
 * handlers so ordering and read-after-write hold within the publishing request.
 * A handler MUST NOT throw to the publisher — the bus isolates any error — but
 * it may reject/throw internally; the bus catches, logs, and moves on.
 */
export type EventHandler<T extends DomainEventType> = (
  event: DomainEvent<T>,
) => void | Promise<void>;

/** Cancels a subscription. Idempotent — calling it twice is a no-op. */
export type Unsubscribe = () => void;

/**
 * The in-process event bus (EPIC-6, ADR-0004). A typed, synchronous-dispatch
 * publish/subscribe seam so modules react to each other's domain events instead
 * of calling across feature boundaries.
 *
 * **Dispatch is synchronous-now:** `publish` invokes every subscriber for the
 * event's type in registration order and awaits each, so the caller can rely on
 * handlers having run when `publish` resolves. This keeps v1.0 simple and
 * transactionally-adjacent; a durable async queue with retry (for notification
 * fan-out) is deferred to EPIC-15 and will slot in behind this same port.
 *
 * **Subscriber isolation is guaranteed:** a throwing/rejecting handler never
 * breaks the publisher or the sibling handlers — the bus catches, logs, and
 * continues. Publishers therefore treat emission as fire-and-forget for
 * correctness, additive to their own durable write (e.g. the audit log).
 */
export interface EventBusPort {
  /** Deliver an event to every subscriber of its type; resolves when all have run. */
  publish<T extends DomainEventType>(event: DomainEvent<T>): Promise<void>;
  /** Register a handler for a type; returns an idempotent unsubscribe. */
  subscribe<T extends DomainEventType>(type: T, handler: EventHandler<T>): Unsubscribe;
}

/** DI token for {@link EventBusPort}. */
export const EVENT_BUS = Symbol("EVENT_BUS");
