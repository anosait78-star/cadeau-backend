/** A durable, tenant-scoped audit record for an analytics export. */
export interface AnalyticsAuditRecord {
  readonly companyId: string;
  readonly actorId: string;
  readonly action: "analytics.exported";
  readonly entityType: "analytics_export";
  /** The exported axis, used as the audited row's identifier (no dedicated table). */
  readonly entityId: string;
  /** A secret-free snapshot of what was exported (axis, window, row count). */
  readonly changes?: unknown;
}

/**
 * Port for recording analytics exports to the durable, append-only
 * `audit_log` (EPIC-3). Analytics is read-only and emits no domain event
 * (the contract specifies none), so audit-then-emit degrades to
 * "audit-then-nothing" here (docs/epic-14-design.md, D7): this durable write
 * is still the source of truth for who exported what and when.
 * Implementations MUST NOT record secrets.
 */
export interface AnalyticsAuditPort {
  record(record: AnalyticsAuditRecord): Promise<void>;
}

/** DI token for {@link AnalyticsAuditPort}. */
export const ANALYTICS_AUDIT = Symbol("ANALYTICS_AUDIT");
