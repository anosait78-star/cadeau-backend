import { Injectable } from "@nestjs/common";
import { AppLogger } from "../logging/app-logger";
import type { DomainEvent, DomainEventType } from "./event-catalog";
import type { EventBusPort, EventHandler, Unsubscribe } from "./event-bus.port";

const CONTEXT = "EventBus";

/**
 * In-process, synchronous-dispatch implementation of {@link EventBusPort}.
 *
 * Handlers are held per event type in a `Set` (so the same handler subscribes
 * once and unsubscribes cleanly). `publish` snapshots the current subscribers
 * and awaits each in registration order; a handler that throws or rejects is
 * caught and logged, never surfaced to the publisher or allowed to skip the
 * remaining handlers. No external transport, no persistence — a single Node
 * process is the boundary (matches the no-Redis stack; durable async delivery
 * arrives in EPIC-15 behind this same port).
 */
@Injectable()
export class InProcessEventBus implements EventBusPort {
  // Untyped at the map level (heterogeneous handler types); the public methods
  // re-establish the type relation between an event type and its handler.
  private readonly handlers = new Map<DomainEventType, Set<EventHandler<DomainEventType>>>();

  constructor(private readonly logger: AppLogger) {}

  async publish<T extends DomainEventType>(event: DomainEvent<T>): Promise<void> {
    const subscribers = this.handlers.get(event.type);
    if (subscribers === undefined || subscribers.size === 0) return;

    // Snapshot so a handler that (un)subscribes during dispatch can't mutate the
    // set we're iterating.
    for (const handler of [...subscribers]) {
      try {
        await handler(event as DomainEvent<DomainEventType>);
      } catch (error) {
        // Isolate: one bad subscriber must not break the publisher or its peers.
        this.logger.error(
          `Event handler failed for "${event.type}": ${this.describe(error)}`,
          CONTEXT,
        );
      }
    }
  }

  subscribe<T extends DomainEventType>(type: T, handler: EventHandler<T>): Unsubscribe {
    let set = this.handlers.get(type);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(type, set);
    }
    // Safe: the handler is only ever invoked with an event of exactly `type`.
    const erased = handler as EventHandler<DomainEventType>;
    set.add(erased);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.handlers.get(type);
      current?.delete(erased);
      if (current !== undefined && current.size === 0) this.handlers.delete(type);
    };
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
