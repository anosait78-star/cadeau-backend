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
 *   - **Forward-declared** for the domain epics that will emit them
 *     (`order.*` → EPIC-11, `stock.changed` → EPIC-9, `payment.collected` →
 *     EPIC-13). Their payloads are intentionally minimal; the owning epic
 *     finalizes each shape when it wires the emission. They are listed now so the
 *     catalog is the one place the vocabulary is declared and so notification
 *     subscribers (EPIC-15) can be typed against it.
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

  // ---- Forward-declared (owning epic finalizes the payload) --------------
  /** An order was created. Shape finalized in EPIC-11. */
  "order.created": {
    readonly orderId: string;
  };
  /** An order moved between lifecycle states. Shape finalized in EPIC-11. */
  "order.status_changed": {
    readonly orderId: string;
    readonly fromStatus: string;
    readonly toStatus: string;
  };
  /** On-hand/committed stock for a variant changed. Shape finalized in EPIC-9. */
  "stock.changed": {
    readonly inventoryId: string;
    readonly variantId: string;
    /** Signed change in on-hand units. */
    readonly onHandDelta: number;
  };
  /** Money was collected against an order. Shape finalized in EPIC-13. */
  "payment.collected": {
    readonly orderId: string;
    /** Amount in integer minor units (api-conventions §money). */
    readonly amountMinor: number;
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
