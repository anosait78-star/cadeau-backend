/** Access audit events (ADR-004 vocabulary). */
export type AccessAuditAction =
  | "access.permissions_changed"
  | "access.feature_toggled"
  | "subscription.changed";

/** A durable, tenant-scoped audit record for an access change. */
export interface AccessAuditRecord {
  readonly companyId: string;
  readonly actorId: string;
  readonly action: AccessAuditAction;
  readonly entityType: string;
  readonly entityId?: string;
  /** A secret-free before/after (or payload) snapshot. */
  readonly changes?: unknown;
}

/**
 * Port for recording access changes to the durable, append-only `audit_log`
 * (who, what, before/after). Implementations MUST NOT record secrets. Every
 * access mutation (permission assignment, feature toggle, plan change) writes
 * one record. This durable write is the source of truth; the additive event-bus
 * emission of the same vocabulary (EPIC-6, `EVENT_BUS`) rides alongside it and
 * must never replace it.
 */
export interface AccessAuditPort {
  record(record: AccessAuditRecord): Promise<void>;
}

/** DI token for {@link AccessAuditPort}. */
export const ACCESS_AUDIT = Symbol("ACCESS_AUDIT");
