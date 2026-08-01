/** A due delivery claimed by the retry worker for processing. */
export interface PendingDelivery {
  readonly id: string;
  readonly companyId: string;
  readonly notificationId: string;
  readonly pushSubscriptionId: string;
  readonly attempts: number;
  readonly notification: {
    readonly title: string;
    readonly body: string;
    readonly payload: unknown;
  };
  readonly subscription: {
    readonly endpoint: string;
    readonly p256dh: string;
    readonly auth: string;
  };
}

/**
 * Port for the durable outbound delivery queue, `notification_deliveries`
 * (EPIC-15, decision D2) — the `shipping_webhook_events`/`WebhookInboxPort`
 * shape (EPIC-12 M12.4) reused for an outbound queue.
 *
 * `enqueue` is called from the dispatch handler, always tenant-bound (the
 * event's company is already known). `claimBatch` is called from the retry
 * worker, a platform-level job with **no** tenant bound — it claims due rows
 * across every company in one statement (the M15.1 migration's split
 * INSERT/SELECT/UPDATE policies permit this from the start). `markProcessed`/
 * `markFailed` are handed the claimed row's own `companyId` and run
 * tenant-bound like any other write.
 */
export interface DeliveryQueuePort {
  enqueue(companyId: string, notificationId: string, pushSubscriptionId: string): Promise<void>;

  /**
   * Atomically claim up to `limit` due rows (`pending`/`failed`,
   * `next_attempt_at <= now()`) across every tenant, marking them
   * `processing` so a concurrent worker tick never double-claims them.
   */
  claimBatch(limit: number): Promise<readonly PendingDelivery[]>;

  markProcessed(companyId: string, id: string): Promise<void>;

  /** `attempts` is the new (incremented) attempt count; schedules the next retry. */
  markFailed(companyId: string, id: string, attempts: number, lastError: string): Promise<void>;
}

/** DI token for {@link DeliveryQueuePort}. */
export const DELIVERY_QUEUE = Symbol("DELIVERY_QUEUE");
