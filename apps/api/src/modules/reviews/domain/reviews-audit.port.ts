/**
 * A durable, tenant-scoped audit record for a review write (Order Reviews
 * feature). `changes` must be **PII-free** (docs/privacy-model.md §6): the
 * gift recipient's name/relation/occasion never belongs in an audit row.
 */
export interface ReviewsAuditRecord {
  readonly companyId: string;
  readonly actorId: string | null;
  readonly action: "review.created";
  readonly entityType: "order_review";
  readonly entityId: string;
  readonly changes?: unknown;
}

/** Port for recording review writes to the durable, append-only `audit_log` (EPIC-3). */
export interface ReviewsAuditPort {
  record(record: ReviewsAuditRecord): Promise<void>;
}

/** DI token for {@link ReviewsAuditPort}. */
export const REVIEWS_AUDIT = Symbol("REVIEWS_AUDIT");
