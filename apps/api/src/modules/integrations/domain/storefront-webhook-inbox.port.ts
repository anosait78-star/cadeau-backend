import type { KeysetPage } from "@cadeau/database";
import type {
  StorefrontEventStatus,
  StorefrontEventType,
  StorefrontWebhookEventView,
} from "./storefront-connection.entity";

/** A newly-appended (or replayed) inbox row. */
export interface EnqueueResult {
  readonly event: StorefrontWebhookEventView;
  /** `false` when `(connectionId, eventType, externalId)` already existed (D7 idempotency). */
  readonly enqueued: boolean;
}

/**
 * Port for the append-first storefront webhook inbox (`storefront_webhook_events`,
 * D7). `enqueue` always runs tenant-bound — {@link StorefrontApiKeyGuard} has
 * already resolved the company before the route handler is reached. There is
 * no cross-tenant claim step in v1 (no auto-retry worker): every other
 * operation is an ordinary tenant-bound read/write from the resolved company.
 */
export interface StorefrontWebhookInboxPort {
  /** Idempotent: a duplicate `(connectionId, eventType, externalId)` replays the existing row. */
  enqueue(
    companyId: string,
    connectionId: string,
    eventType: StorefrontEventType,
    externalId: string,
    payload: unknown,
  ): Promise<EnqueueResult>;

  markProcessed(companyId: string, id: string, internalEntityId: string): Promise<void>;

  markFailed(companyId: string, id: string, error: string): Promise<void>;

  findById(companyId: string, id: string): Promise<StorefrontWebhookEventView | null>;

  /** The raw payload of one event, for reprocessing. `null` if absent in this tenant. */
  getPayload(companyId: string, id: string): Promise<unknown | null>;

  /** Increment `attemptCount` ahead of a manual reprocess attempt. */
  incrementAttempt(companyId: string, id: string): Promise<void>;

  list(
    companyId: string,
    connectionId: string,
    limit: number,
    cursor?: string,
    status?: StorefrontEventStatus,
    eventType?: StorefrontEventType,
  ): Promise<KeysetPage<StorefrontWebhookEventView>>;
}

/** DI token for {@link StorefrontWebhookInboxPort}. */
export const STOREFRONT_WEBHOOK_INBOX = Symbol("STOREFRONT_WEBHOOK_INBOX");
