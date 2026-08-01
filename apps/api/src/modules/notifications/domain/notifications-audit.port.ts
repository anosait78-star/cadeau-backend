/**
 * A durable, tenant-scoped audit record for a notification creation
 * (EPIC-15). System-originated (`actorId` is always `null` — notifications
 * are never user-authored in v1). `changes` must be PII-free
 * (docs/privacy-model.md §6).
 */
export interface NotificationsAuditRecord {
  readonly companyId: string;
  readonly action: "notification.created";
  readonly entityType: "notification";
  readonly entityId: string;
  readonly changes?: unknown;
}

/**
 * Port for recording notification creations to the durable, append-only
 * `audit_log` (EPIC-3). The durable write is the source of truth; the
 * additive `notification.created` event-bus emission rides alongside it.
 */
export interface NotificationsAuditPort {
  record(record: NotificationsAuditRecord): Promise<void>;
}

/** DI token for {@link NotificationsAuditPort}. */
export const NOTIFICATIONS_AUDIT = Symbol("NOTIFICATIONS_AUDIT");
