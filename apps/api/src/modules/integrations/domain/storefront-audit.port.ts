/**
 * A durable, tenant-scoped audit record for a storefront-integration change.
 * `changes` must be PII-free (docs/privacy-model.md §6) — ids and field
 * *names* only, never customer PII (which lives only on the customer/order
 * created via the reused services, behind their own audit gates).
 */
export interface StorefrontAuditRecord {
  readonly companyId: string;
  /** `null` for a system-originated change (ingestion processing). */
  readonly actorId: string | null;
  readonly action:
    | "storefront_connection.created"
    | "storefront_connection.updated"
    | "storefront_connection.key_rotated"
    | "storefront_connection.revoked"
    | "storefront_event.reprocessed"
    | "storefront_vendor_warehouse_mapping.created"
    | "storefront_vendor_warehouse_mapping.auto_created"
    | "storefront_vendor_warehouse_mapping.deleted";
  readonly entityType:
    | "storefront_connection"
    | "storefront_webhook_event"
    | "storefront_vendor_warehouse_mapping";
  readonly entityId: string;
  readonly changes?: unknown;
}

/**
 * Port for recording storefront-integration changes to the durable,
 * append-only `audit_log` (EPIC-3). Mirrors `ShippingAuditPort` exactly.
 */
export interface StorefrontAuditPort {
  record(record: StorefrontAuditRecord): Promise<void>;
}

/** DI token for {@link StorefrontAuditPort}. */
export const STOREFRONT_AUDIT = Symbol("STOREFRONT_AUDIT");
