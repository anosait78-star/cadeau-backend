import { Inject, Injectable } from "@nestjs/common";
import {
  DELIVERY_QUEUE,
  type DeliveryQueuePort,
  type PendingDelivery,
} from "../domain/delivery-queue.port";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import {
  PUSH_SENDER,
  PushSubscriptionGoneError,
  type PushSenderPort,
} from "../domain/push-sender.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import {
  NOTIFICATIONS_REPOSITORY,
  type NotificationsRepositoryPort,
} from "../domain/notifications-repository.port";

/** The outcome of one retry-worker poll tick. */
export interface ProcessBatchResult {
  readonly processed: number;
  readonly failed: number;
}

/**
 * Claims due rows from the outbound delivery queue and sends each via the
 * bound {@link PushSenderPort} (EPIC-15 M15.2, decision D2 — the
 * `WebhookProcessorService` shape from EPIC-12 M12.4, applied to sending
 * instead of ingesting).
 *
 * A `PushSubscriptionGoneError` (the browser's push service reports the
 * subscription no longer exists) deletes the subscription outright — every
 * other pending delivery for it cascades away with it (`ON DELETE CASCADE`)
 * — and counts as processed, not failed: there is nothing left to retry.
 * Any other failure marks the row `failed` with backoff.
 */
@Injectable()
export class DeliveryProcessorService {
  constructor(
    @Inject(DELIVERY_QUEUE) private readonly queue: DeliveryQueuePort,
    @Inject(PUSH_SENDER) private readonly sender: PushSenderPort,
    @Inject(NOTIFICATIONS_REPOSITORY) private readonly repo: NotificationsRepositoryPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async processBatch(limit: number): Promise<ProcessBatchResult> {
    const deliveries = await this.queue.claimBatch(limit);
    let processed = 0;
    let failed = 0;
    for (const delivery of deliveries) {
      // Sequential, not parallel: keeps the worker's DB/push-service load
      // predictable, matching the shipping webhook worker's discipline.
      if (await this.processOne(delivery)) processed += 1;
      else failed += 1;
    }
    return { processed, failed };
  }

  private async processOne(delivery: PendingDelivery): Promise<boolean> {
    try {
      await this.sender.send(delivery.subscription, {
        title: delivery.notification.title,
        body: delivery.notification.body,
        payload: delivery.notification.payload,
      });
      await this.queue.markProcessed(delivery.companyId, delivery.id);
      await this.events.publish({
        type: "notification.delivered",
        companyId: delivery.companyId,
        actorId: null,
        occurredAt: this.clock.now(),
        payload: {
          notificationId: delivery.notificationId,
          pushSubscriptionId: delivery.pushSubscriptionId,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof PushSubscriptionGoneError) {
        await this.repo.deleteSubscriptionById(delivery.companyId, delivery.pushSubscriptionId);
        await this.queue.markProcessed(delivery.companyId, delivery.id);
        return true;
      }
      const message = error instanceof Error ? error.message : "Unknown push send failure.";
      await this.queue.markFailed(delivery.companyId, delivery.id, delivery.attempts + 1, message);
      return false;
    }
  }
}
