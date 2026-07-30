/** A durable, tenant-scoped audit record for a master-data change. */
export interface MasterDataAuditRecord {
  readonly companyId: string;
  readonly actorId: string;
  readonly action: "master_data.created" | "master_data.updated" | "master_data.deactivated";
  /** The resource collection (e.g. `order-labels`). */
  readonly entityType: string;
  /** The affected row's id (or code). */
  readonly entityId: string;
  /** A secret-free snapshot of what changed. */
  readonly changes?: unknown;
}

/**
 * Port for recording master-data changes to the durable, append-only
 * `audit_log` (EPIC-3). This durable write is the source of truth; the additive
 * `master_data.changed` event-bus emission rides alongside it (never replaces
 * it). Implementations MUST NOT record secrets.
 */
export interface MasterDataAuditPort {
  record(record: MasterDataAuditRecord): Promise<void>;
}

/** DI token for {@link MasterDataAuditPort}. */
export const MASTER_DATA_AUDIT = Symbol("MASTER_DATA_AUDIT");
