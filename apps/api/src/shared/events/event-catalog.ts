/**
 * The closed domain-event catalog (EPIC-6, ADR-0004).
 *
 * This is the single, typed vocabulary of everything the core can emit. It is a
 * *closed* set on purpose: a new event is a deliberate, reviewed addition here —
 * never an ad-hoc string at a call site — so publishers and subscribers stay in
 * lock-step and the compiler rejects a typo or a wrong payload shape.
 *
 * Two tiers live here:
 *
 *   - **Live now (EPIC-5 access surface):** `access.permissions_changed`,
 *     `access.feature_toggled`, `subscription.changed`. These are emitted by the
 *     `access`/`admin` services alongside their durable audit write (EPIC-6 M6.2).
 *   - **Live now (EPIC-7 master data):** `master_data.changed`, emitted by the
 *     master-data service on every reference-row create/update/deactivate.
 *   - **Live now (EPIC-8 products):** `product.created`/`product.updated`/
 *     `product.archived`, emitted by the products service.
 *   - **Live now (EPIC-9 inventory):** `stock.changed` and `stock.low`, emitted
 *     by each atomic inventory write (reserve/release/transfer/adjust).
 *   - **Live now (EPIC-10 customers):** `customer.created`/`customer.updated`/
 *     `customer.exported`. Their payloads carry ids and field *names* only —
 *     never personal data (docs/privacy-model.md §6).
 *   - **Live now (EPIC-11 orders):** `customer.merged` (decision D3),
 *     `order.created`/`order.status_changed`/`order.assigned`,
 *     `payment.collected` (read by finance, EPIC-13).
 *   - **Live now (EPIC-12 shipping):** `shipment.created`/
 *     `shipment.status_changed`/`shipment.delivered`.
 *   - **Live now (EPIC-13 finance):** `purchase_order.received`,
 *     `payment.recorded`, `invoice.issued`, `refund.issued`, `period.closed`.
 *   - **Live now (EPIC-15 notifications):** `notification.created`/
 *     `notification.delivered`. This is also the catalog's first real
 *     *subscriber* — `order.status_changed`/`payment.collected` above are
 *     consumed by the notification dispatcher, not just published.
 *
 * **Forward-declared** entries (none currently pending).
 *
 * See {@link ../../../docs/events.md} for the emit/subscribe contract.
 */

/**
 * Maps each event type to its payload shape. The payload carries only the
 * event-specific facts; the common envelope fields (tenant, actor, timestamp)
 * live on {@link DomainEvent}. Payloads MUST be secret-free (same rule as the
 * audit log) — they may be logged and, later, queued for delivery.
 */
export interface EventPayloads {
  /** A member's permission template and/or per-permission overrides changed. */
  "access.permissions_changed": {
    readonly memberId: string;
    /** The affected member's user id, for cache/notification targeting. */
    readonly memberUserId: string;
    /** The template applied, if the change set one. */
    readonly templateKey?: string;
  };
  /** A feature was toggled on/off for the company (Super-Admin action). */
  "access.feature_toggled": {
    readonly featureKey: string;
    readonly enabled: boolean;
  };
  /** The company's subscription plan changed (Super-Admin action). */
  "subscription.changed": {
    readonly planCode: string;
  };
  /**
   * A master-data reference row changed (create/update/deactivate). Consumers
   * (later modules that cache reference data) invalidate on this. Emitted by the
   * EPIC-7 master-data service alongside its durable audit write.
   */
  "master_data.changed": {
    /** The resource collection that changed (e.g. `order-labels`). */
    readonly resource: string;
    /** The affected row's id (uuid) or code (for code-keyed reference tables). */
    readonly id: string;
    /** What happened to the row. */
    readonly change: "created" | "updated" | "deactivated";
  };
  /**
   * A catalog product was created. Emitted by the EPIC-8 products service
   * alongside its durable audit write; consumers (inventory EPIC-9, analytics)
   * can react.
   */
  "product.created": {
    readonly productId: string;
  };
  /** A catalog product's attributes or one of its variants changed (EPIC-8). */
  "product.updated": {
    readonly productId: string;
  };
  /** A catalog product was archived (`is_active = false`) (EPIC-8). */
  "product.archived": {
    readonly productId: string;
  };

  /**
   * On-hand and/or committed stock for one (warehouse, variant) level changed
   * (EPIC-9). Emitted once per affected level by each atomic inventory write —
   * a transfer therefore emits two, one per side. Deltas are signed; the
   * absolute fields are the level **after** the write. An idempotent replay
   * moves no stock and emits nothing.
   */
  "stock.changed": {
    readonly warehouseId: string;
    readonly variantId: string;
    /** Signed change in on-hand units. */
    readonly onHandDelta: number;
    /** Signed change in committed units. */
    readonly committedDelta: number;
    readonly onHand: number;
    readonly committed: number;
    readonly available: number;
    /** Which write path moved the stock. */
    readonly reason: "reserved" | "released" | "transferred" | "adjusted";
  };
  /**
   * A level's `available` crossed down to or below its reorder point (EPIC-9).
   * Edge-triggered: emitted only on the write that crossed the threshold, not
   * repeatedly while the level stays low.
   */
  "stock.low": {
    readonly warehouseId: string;
    readonly variantId: string;
    readonly available: number;
    readonly reorderPoint: number;
  };

  /**
   * A customer was added to the base (EPIC-10). An idempotent replay of an
   * earlier create emits nothing — it wrote nothing.
   *
   * The payload carries the id and nothing else: name, phone, email and address
   * are personal data, and an event payload may be logged or queued
   * (docs/privacy-model.md §6). A subscriber that needs the person reads the
   * customer back under RLS with its own permissions.
   */
  "customer.created": {
    readonly customerId: string;
  };
  /** A customer's profile fields changed (EPIC-10). Ids and field names only. */
  "customer.updated": {
    readonly customerId: string;
    /** Which fields changed — never their values. */
    readonly fields: readonly string[];
  };
  /**
   * Customer records were exported (EPIC-10). Emitted alongside the durable
   * audit row so bulk PII egress is observable, never silent.
   */
  "customer.exported": {
    /** How many records left the system. */
    readonly count: number;
  };

  // ---- Forward-declared (owning epic finalizes the payload) --------------
  /**
   * Two customers were merged into one. Reserved for **EPIC-11** (owner decision
   * D3): merge is written once, against the complete set of customer-owned
   * tables, when orders exist.
   */
  "customer.merged": {
    readonly survivingCustomerId: string;
    readonly mergedCustomerId: string;
  };
  /** An order was created (EPIC-11). Ids only — no customer PII. */
  "order.created": {
    readonly orderId: string;
  };
  /** An order moved between lifecycle states (EPIC-11). */
  "order.status_changed": {
    readonly orderId: string;
    readonly fromStatus: string;
    readonly toStatus: string;
  };
  /** An order was assigned to (or unassigned from) a member (EPIC-11). */
  "order.assigned": {
    readonly orderId: string;
    /** The member's user id, or `null` when the order was unassigned. */
    readonly assigneeId: string | null;
  };
  /**
   * Money was collected against an order (EPIC-11 emits it on a COD collection;
   * finance EPIC-13 reads it). `amountMinor` is the positive delta collected.
   */
  "payment.collected": {
    readonly orderId: string;
    /** Amount in integer minor units (api-conventions §money). */
    readonly amountMinor: number;
  };

  /** A shipment was created for an order (EPIC-12). Ids only. */
  "shipment.created": {
    readonly shipmentId: string;
    readonly orderId: string;
    readonly carrier: string;
  };
  /** A shipment moved between lifecycle states (EPIC-12). */
  "shipment.status_changed": {
    readonly shipmentId: string;
    readonly orderId: string;
    readonly fromStatus: string;
    readonly toStatus: string;
  };
  /**
   * A shipment was delivered (EPIC-12). `feeMinor` is the shipping fee deducted
   * from the order's `collectedAmount` at delivery (decision D4 — a simple
   * deduction; reconciliation against carrier remittance is EPIC-13).
   */
  "shipment.delivered": {
    readonly shipmentId: string;
    readonly orderId: string;
    readonly feeMinor: number;
  };

  /**
   * A purchase order receipt raised stock and rolled `averageCost` (EPIC-13,
   * D7). Emitted once per receipt, alongside the durable `stock_adjustments`
   * row and audit write.
   */
  "purchase_order.received": {
    readonly purchaseOrderId: string;
    readonly receiptId: string;
  };
  /**
   * A payment was recorded against a purchase order (EPIC-13). Partial or
   * full; `amountMinor` is the positive delta paid.
   */
  "payment.recorded": {
    readonly purchaseOrderId: string;
    readonly amountMinor: number;
  };
  /** An official invoice was issued as a PDF (EPIC-13, D1). Ids only. */
  "invoice.issued": {
    readonly invoiceId: string;
    readonly orderId: string | null;
  };
  /**
   * A refund was issued (EPIC-13). `Idempotency-Key` is mandatory on this
   * write; `amountMinor` is the positive amount refunded.
   */
  "refund.issued": {
    readonly refundId: string;
    readonly amountMinor: number;
  };
  /**
   * An accounting period closed (EPIC-13, D4). Sequential — no earlier period
   * with activity is still open when this fires.
   */
  "period.closed": {
    readonly periodKey: string;
  };

  /**
   * An in-app notification was created for one recipient (EPIC-15). Emitted
   * alongside the durable audit write, after the `Notification` row commits.
   * Ids only — the title/body may echo domain facts but never raw PII.
   */
  "notification.created": {
    readonly notificationId: string;
    readonly recipientProfileId: string;
    readonly type: string;
  };
  /**
   * A queued Web Push delivery reached the browser's push service
   * successfully (EPIC-15, D2). Emitted by the delivery retry worker when a
   * `notification_deliveries` row transitions to `processed`.
   */
  "notification.delivered": {
    readonly notificationId: string;
    readonly pushSubscriptionId: string;
  };
}

/** The set of valid event type strings, derived from the catalog. */
export type DomainEventType = keyof EventPayloads;

/**
 * A published domain event: the typed payload plus a common envelope. Every
 * event is tenant-scoped (`companyId`); `actorId` is the user who caused it, or
 * `null` for a system-originated change. `occurredAt` is epoch milliseconds.
 */
export interface DomainEvent<T extends DomainEventType = DomainEventType> {
  readonly type: T;
  readonly companyId: string;
  readonly actorId: string | null;
  readonly occurredAt: number;
  readonly payload: EventPayloads[T];
}
