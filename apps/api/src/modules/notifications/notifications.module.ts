import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { DeliveryProcessorService } from "./application/delivery-processor.service";
import { NotificationDispatchService } from "./application/notification-dispatch.service";
import { NotificationsService } from "./application/notifications.service";
import { CUSTOMER_MESSAGING } from "./domain/customer-messaging.port";
import { DELIVERY_QUEUE } from "./domain/delivery-queue.port";
import { NOTIFICATIONS_AUDIT } from "./domain/notifications-audit.port";
import { NOTIFICATIONS_REPOSITORY } from "./domain/notifications-repository.port";
import { ORDER_FACTS } from "./domain/order-facts.port";
import { PUSH_SENDER } from "./domain/push-sender.port";
import { NotificationsAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { DeliveryQueueRepository } from "./infrastructure/delivery-queue.repository";
import { DeliveryRetryWorker } from "./infrastructure/delivery-retry-worker";
import { LoggingCustomerMessagingAdapter } from "./infrastructure/logging-customer-messaging.adapter";
import { NotificationsRepository } from "./infrastructure/notifications.repository";
import { OrderFactsAdapter } from "./infrastructure/order-facts.adapter";
import { notificationsPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { WebPushAdapter } from "./infrastructure/web-push.adapter";
import { NotificationsController } from "./presentation/notifications.controller";

/**
 * Notifications feature module (composition root, EPIC-15). Wires the
 * personal `/v1/notifications` controller, the event-bus subscriber
 * (`NotificationDispatchService` — the bus's first real subscriber, EPIC-6
 * M6.1), the durable outbound delivery queue (`DeliveryQueueRepository` →
 * `DeliveryRetryWorker` → `DeliveryProcessorService` → `WebPushAdapter`,
 * copying the EPIC-12 M12.4 webhook pipeline shape for outbound sends), and
 * the deferred end-customer messaging seam (`CustomerMessagingPort` →
 * `LoggingCustomerMessagingAdapter`, decision D5). The three-layer resolver +
 * guards come from the global `AccessCoreModule`; the event bus from the
 * global `EventBusModule`; the validated config from the global
 * `ConfigModule`.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDispatchService,
    DeliveryProcessorService,
    DeliveryRetryWorker,
    systemClockProvider,
    notificationsPrismaClientProvider,
    { provide: NOTIFICATIONS_REPOSITORY, useClass: NotificationsRepository },
    { provide: NOTIFICATIONS_AUDIT, useClass: NotificationsAuditLogAdapter },
    { provide: DELIVERY_QUEUE, useClass: DeliveryQueueRepository },
    { provide: PUSH_SENDER, useClass: WebPushAdapter },
    { provide: CUSTOMER_MESSAGING, useClass: LoggingCustomerMessagingAdapter },
    { provide: ORDER_FACTS, useClass: OrderFactsAdapter },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
