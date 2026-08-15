/** Minimal order facts the dispatcher needs to resolve a notification recipient (D6). */
export interface OrderFacts {
  readonly assigneeId: string | null;
  readonly orderNumber: bigint;
}

/**
 * One vendor's target for the "order entered processing" notification
 * (Vendor Accounts, Phase 5) — the vendor's own user id and the ids scoping
 * their notification to their own group only.
 */
export interface OrderVendorGroupRecipient {
  readonly orderVendorGroupId: string;
  readonly warehouseId: string;
  readonly vendorUserId: string;
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

  /**
   * The order's vendor groups that have an active `role = "vendor"` member
   * joined (Vendor Accounts, Phase 5) — a group with no vendor yet (Phase 1's
   * "not every warehouse has a vendor" case) is simply absent, not an error.
   * Reads `OrderVendorGroup` rows already committed by the `processing`
   * transition (Phase 3), same "committed before publish" guarantee as
   * `findById`.
   */
  listVendorGroupRecipients(
    companyId: string,
    orderId: string,
  ): Promise<readonly OrderVendorGroupRecipient[]>;
}

/** DI token for {@link OrderFactsPort}. */
export const ORDER_FACTS = Symbol("ORDER_FACTS");
