/** A due row claimed by the retry worker for processing. */
export interface PendingWebhookEvent {
  readonly id: string;
  readonly companyId: string;
  readonly carrier: string;
  readonly carrierEventId: string;
  readonly payload: unknown;
  readonly attempts: number;
}

/**
 * Port for the durable webhook inbox (EPIC-12 M12.4, decision D2):
 * `shipping_webhook_events`, idempotent on `(carrier, carrierEventId)`.
 *
 * `enqueue` is called from the signature-verified ingestion route, always
 * tenant-bound (the company is resolved from the signed webhook path).
 * `claimBatch` is called from the retry worker, which is a platform-level job
 * with **no** tenant bound — it legitimately claims due events across every
 * company in one statement (see the M12.4 migration widening this table's
 * SELECT/UPDATE policies). `markProcessed`/`markFailed` are given the claimed
 * row's own `companyId` and run tenant-bound like any other write.
 */
export interface WebhookInboxPort {
  /** Idempotent: a duplicate `(carrier, carrierEventId)` is a no-op. */
  enqueue(
    companyId: string,
    carrier: string,
    carrierEventId: string,
    payload: unknown,
  ): Promise<{ enqueued: boolean }>;

  /**
   * Atomically claim up to `limit` due rows (`pending`/`failed`,
   * `next_attempt_at <= now()`) across every tenant, marking them
   * `processing` so a concurrent worker tick never double-claims them.
   */
  claimBatch(limit: number): Promise<readonly PendingWebhookEvent[]>;

  markProcessed(companyId: string, id: string): Promise<void>;

  /** `attempts` is the new (incremented) attempt count; schedules the next retry. */
  markFailed(companyId: string, id: string, attempts: number): Promise<void>;
}

/** DI token for {@link WebhookInboxPort}. */
export const WEBHOOK_INBOX = Symbol("WEBHOOK_INBOX");
