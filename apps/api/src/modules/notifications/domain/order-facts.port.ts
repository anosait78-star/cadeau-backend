/** Minimal order facts the dispatcher needs to resolve a notification recipient (D6). */
export interface OrderFacts {
  readonly assigneeId: string | null;
  readonly orderNumber: bigint;
}

/**
 * Port for reading back the order facts a bus event's payload doesn't carry
 * (EPIC-15, decision D6) — `order.status_changed`/`payment.collected` carry
 * only `orderId`; the dispatcher needs `assigneeId`/`orderNumber` too. The
 * order row is already committed by the time this runs (every publisher
 * writes its durable audit row and commits before calling
 * `eventBus.publish`), so a straight read is safe.
 */
export interface OrderFactsPort {
  findById(companyId: string, orderId: string): Promise<OrderFacts | null>;
}

/** DI token for {@link OrderFactsPort}. */
export const ORDER_FACTS = Symbol("ORDER_FACTS");
