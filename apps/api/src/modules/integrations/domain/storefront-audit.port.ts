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
    | "storefront_vendor_warehouse_mapping.deleted"
    /** Exactly what the storefront sent for a vendor, kept as evidence (2026-10-19). */
    | "storefront_vendor.received"
    /** A re-send carried a new name and the warehouse had not been renamed by hand. */
    | "storefront_vendor.renamed"
    /** A re-send carried a new name but a person had renamed the warehouse; theirs stands. */
    | "storefront_vendor.rename_skipped"
    | "storefront_order.resync_failed"
    | "storefront_order.vendor_fallback_warehouse"
    /** The CRM refused a storefront-reported cancellation (2026-09-12). */
    | "storefront_order.cancel_skipped"
    /** The order's phone was unusable; a placeholder stood in (2026-09-12). */
    | "storefront_order.placeholder_phone"
    /** An order line's sku matched nothing; a placeholder variant stood in (2026-10-14). */
    | "storefront_order.placeholder_product"
    /** The real product arrived and completed a placeholder variant (2026-10-14). */
    | "storefront_product.placeholder_completed"
    | "storefront_customer.address_sync_failed"
    /** Renaming a customer from their latest storefront order failed (2026-09-13). */
    | "storefront_customer.name_sync_failed";
  readonly entityType:
    | "storefront_connection"
    | "warehouse"
    | "storefront_webhook_event"
    | "storefront_vendor_warehouse_mapping"
    | "order"
    | "product"
    | "customer";
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
