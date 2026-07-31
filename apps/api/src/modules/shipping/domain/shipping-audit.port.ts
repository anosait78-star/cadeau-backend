/**
 * A durable, tenant-scoped audit record for a shipment change (EPIC-12).
 *
 * `changes` must be **PII-free** (docs/privacy-model.md §6): a shipment audit
 * row records ids and field *names* — never customer PII (which lives only on
 * the customer/order, behind their own gates).
 */
export interface ShippingAuditRecord {
  readonly companyId: string;
  readonly actorId: string;
  readonly action: "shipment.created" | "shipment.status_changed" | "shipment.cancelled";
  readonly entityType: "shipment";
  /** The affected shipment's id. */
  readonly entityId: string;
  /** A PII-free description of the change (e.g. `{ from: "created", to: "picked_up" }`). */
  readonly changes?: unknown;
}

/**
 * Port for recording shipment changes to the durable, append-only `audit_log`
 * (EPIC-3). The durable write is the source of truth; the additive
 * `shipment.*` event-bus emission rides alongside it (never replaces it).
 */
export interface ShippingAuditPort {
  record(record: ShippingAuditRecord): Promise<void>;
}

/** DI token for {@link ShippingAuditPort}. */
export const SHIPPING_AUDIT = Symbol("SHIPPING_AUDIT");
