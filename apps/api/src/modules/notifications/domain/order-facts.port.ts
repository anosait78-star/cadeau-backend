/** Minimal order facts the dispatcher needs to resolve a notification recipient (D6). */
export interface OrderFacts {
  readonly assigneeId: string | null;
  readonly orderNumber: bigint;
  /**
   * The name of the customer who placed the order — the single fact that makes
   * a notification recognizable at a glance ("New order from <name>") instead of a bare
   * number. Personal data, so it is deliberately the *only* customer field
   * here: no phone, no address, no email (docs/privacy-model.md §6). Every
   * recipient is a company member who can already open the order and read it.
   */
  readonly customerName: string;
  /** The order total in integer minor units (api-conventions §money). */
  readonly totalMinor: number;
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
   * The standing audience for a **new order** in this company, de-duplicated:
   *
   *   1. every active member whose role is `owner` — unconditionally, the
   *      account that answers for the company always hears that an order came
   *      in, regardless of how its permissions were later edited;
   *   2. every active member who effectively holds `orders.manage`.
   *      `orders.manage` (not `orders.read`) is the key that means "may act on
   *      an order" — read is a viewing grant that analysts and finance roles
   *      also carry, and a notification is a call to act. Resolved through the
   *      same three-layer resolver the API guards use, so a member whose
   *      `orders` feature is off or whose permission an override revoked is
   *      not a recipient.
   *
   * The order's assignee is added by the caller (it is an order fact, not a
   * company one). `excludeProfileId` drops the actor: nobody is told about
   * their own action.
   */
  listNewOrderRecipients(
    companyId: string,
    excludeProfileId: string | null,
  ): Promise<readonly string[]>;

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
