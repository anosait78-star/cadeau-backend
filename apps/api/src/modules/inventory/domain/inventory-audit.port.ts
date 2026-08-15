/** A durable, tenant-scoped audit record for an inventory change. */
export interface InventoryAuditRecord {
  readonly companyId: string;
  readonly actorId: string;
  readonly action:
    | "inventory.warehouse_created"
    | "inventory.warehouse_updated"
    | "inventory.warehouse_archived"
    | "inventory.reserved"
    | "inventory.released"
    | "inventory.transferred"
    | "inventory.adjusted"
    | "inventory.reorder_point_set"
    | "inventory.variant_warehouse_set"
    | "inventory.warehouse_join_code_rotated"
    | "inventory.warehouse_join_code_revoked";
  /** The kind of row the change landed on. */
  readonly entityType:
    | "warehouse"
    | "stock_reservation"
    | "stock_transfer"
    | "stock_adjustment"
    | "inventory_stock"
    | "warehouse_join_code";
  /** The affected row's id. */
  readonly entityId: string;
  /** A secret-free snapshot of what changed. */
  readonly changes?: unknown;
}

/**
 * Port for recording inventory changes to the durable, append-only `audit_log`
 * (EPIC-3). This durable write is the source of truth; the additive
 * `stock.changed`/`stock.low` event-bus emissions ride alongside it (never
 * replace it). Implementations MUST NOT record secrets.
 */
export interface InventoryAuditPort {
  record(record: InventoryAuditRecord): Promise<void>;
}

/** DI token for {@link InventoryAuditPort}. */
export const INVENTORY_AUDIT = Symbol("INVENTORY_AUDIT");
