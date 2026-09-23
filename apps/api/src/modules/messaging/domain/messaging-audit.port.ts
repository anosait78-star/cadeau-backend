/**
 * A durable, tenant-scoped audit record for a messaging write (EPIC-17).
 *
 * `changes` must be **PII-free** (docs/privacy-model.md §6): a message body is
 * user-authored free text and may name customers, addresses or phone numbers,
 * so it never belongs in an audit row. Ids, counts and lengths only.
 */
export interface MessagingAuditRecord {
  readonly companyId: string;
  readonly actorId: string | null;
  readonly action: "message_thread.created" | "message.sent";
  readonly entityType: "message_thread" | "message";
  readonly entityId: string;
  readonly changes?: unknown;
}

/** Port for recording messaging writes to the append-only `audit_log` (EPIC-3). */
export interface MessagingAuditPort {
  record(record: MessagingAuditRecord): Promise<void>;
}

/** DI token for {@link MessagingAuditPort}. */
export const MESSAGING_AUDIT = Symbol("MESSAGING_AUDIT");
