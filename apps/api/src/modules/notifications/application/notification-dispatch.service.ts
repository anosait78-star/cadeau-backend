import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { DomainEvent } from "../../../shared/events/event-catalog";
import {
  EVENT_BUS,
  type EventBusPort,
  type Unsubscribe,
} from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import { CUSTOMER_MESSAGING, type CustomerMessagingPort } from "../domain/customer-messaging.port";
import { DELIVERY_QUEUE, type DeliveryQueuePort } from "../domain/delivery-queue.port";
import {
  NOTIFICATIONS_AUDIT,
  type NotificationsAuditPort,
} from "../domain/notifications-audit.port";
import {
  NOTIFICATIONS_REPOSITORY,
  type NotificationsRepositoryPort,
} from "../domain/notifications-repository.port";
import { ORDER_FACTS, type OrderFactsPort } from "../domain/order-facts.port";

/**
 * The event-bus subscriber that turns `order.status_changed`/
 * `payment.collected` into an in-app notification (+ queued Web Push
 * deliveries + a best-effort end-customer message) for the order's assignee
 * (EPIC-15 M15.2, decision D6). The **first real subscriber** on the EPIC-6
 * event bus — every publisher before this epic had zero subscribers.
 *
 * Subscribes in `onModuleInit` (the bus has no "replay" — only events
 * published after this module boots are seen, exactly like every other
 * consumer of this bus would behave). An order with no `assigneeId` is a
 * silent no-op (D9): no row, no audit, nothing queued.
 */
@Injectable()
export class NotificationDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatchService.name);
  private unsubscribes: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(NOTIFICATIONS_REPOSITORY) private readonly repo: NotificationsRepositoryPort,
    @Inject(NOTIFICATIONS_AUDIT) private readonly audit: NotificationsAuditPort,
    @Inject(DELIVERY_QUEUE) private readonly deliveryQueue: DeliveryQueuePort,
    @Inject(CUSTOMER_MESSAGING) private readonly customerMessaging: CustomerMessagingPort,
    @Inject(ORDER_FACTS) private readonly orderFacts: OrderFactsPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.unsubscribes = [
      this.events.subscribe("order.status_changed", (event) => this.onOrderStatusChanged(event)),
      this.events.subscribe("payment.collected", (event) => this.onPaymentCollected(event)),
    ];
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }

  private async onOrderStatusChanged(event: DomainEvent<"order.status_changed">): Promise<void> {
    const order = await this.orderFacts.findById(event.companyId, event.payload.orderId);
    if (order !== null && order.assigneeId !== null) {
      await this.dispatch(event.companyId, order.assigneeId, {
        type: "order.status_changed",
        title: "Order status changed",
        body: `Order ${order.orderNumber} moved from ${event.payload.fromStatus} to ${event.payload.toStatus}.`,
        payload: {
          orderId: event.payload.orderId,
          fromStatus: event.payload.fromStatus,
          toStatus: event.payload.toStatus,
        },
      });

      await this.customerMessaging.send({
        companyId: event.companyId,
        orderId: event.payload.orderId,
        template: "order_status_changed",
        params: { toStatus: event.payload.toStatus },
      });
    }

    // Vendor Accounts, Phase 5: entering "processing" is the point Phase 3's
    // `materializeVendorGroups` guarantees this order's vendor groups exist —
    // notify each vendor who already has an active membership on their
    // group's warehouse. One notification per vendor, carrying only that
    // vendor's own ids — never the full order or other vendors' data. A
    // group with no vendor joined yet is silently skipped (valid state).
    if (event.payload.toStatus === "processing") {
      await this.onOrderEnteredProcessing(event, order?.orderNumber ?? null);
    }
  }

  private async onOrderEnteredProcessing(
    event: DomainEvent<"order.status_changed">,
    orderNumber: bigint | null,
  ): Promise<void> {
    const recipients = await this.orderFacts.listVendorGroupRecipients(
      event.companyId,
      event.payload.orderId,
    );
    for (const recipient of recipients) {
      await this.dispatch(event.companyId, recipient.vendorUserId, {
        type: "order_vendor_group.assigned",
        title: "New order assigned",
        body:
          orderNumber === null
            ? "You have a new order to prepare."
            : `You have a new order: #${orderNumber}.`,
        payload: {
          orderId: event.payload.orderId,
          orderVendorGroupId: recipient.orderVendorGroupId,
          warehouseId: recipient.warehouseId,
        },
      });
    }
  }

  private async onPaymentCollected(event: DomainEvent<"payment.collected">): Promise<void> {
    const order = await this.orderFacts.findById(event.companyId, event.payload.orderId);
    if (order === null || order.assigneeId === null) return;

    await this.dispatch(event.companyId, order.assigneeId, {
      type: "payment.collected",
      title: "Payment collected",
      body: `Order ${order.orderNumber} collected ${event.payload.amountMinor} (minor units).`,
      payload: { orderId: event.payload.orderId, amountMinor: event.payload.amountMinor },
    });
  }

  /** Creates the in-app row (if enabled) and queues Web Push deliveries (if enabled). */
  private async dispatch(
    companyId: string,
    profileId: string,
    input: {
      type: "order.status_changed" | "payment.collected" | "order_vendor_group.assigned";
      title: string;
      body: string;
      payload: unknown;
    },
  ): Promise<void> {
    try {
      const [inAppEnabled, webPushEnabled] = await Promise.all([
        this.repo.isChannelEnabled(companyId, profileId, input.type, "inApp"),
        this.repo.isChannelEnabled(companyId, profileId, input.type, "webPush"),
      ]);
      if (!inAppEnabled && !webPushEnabled) return;

      const notification = await this.repo.create(companyId, profileId, input);
      await this.audit.record({
        companyId,
        action: "notification.created",
        entityType: "notification",
        entityId: notification.id,
        changes: { type: input.type, recipientProfileId: profileId },
      });
      await this.events.publish({
        type: "notification.created",
        companyId,
        actorId: null,
        occurredAt: this.clock.now(),
        payload: {
          notificationId: notification.id,
          recipientProfileId: profileId,
          type: input.type,
        },
      });

      if (webPushEnabled) {
        const subscriptions = await this.repo.listActiveSubscriptions(companyId, profileId);
        for (const subscription of subscriptions) {
          await this.deliveryQueue.enqueue(companyId, notification.id, subscription.id);
        }
      }
    } catch (error) {
      // Subscriber isolation is already guaranteed by the bus, but a failure
      // here should never surface as an unhandled rejection in the handler.
      this.logger.error(
        "Notification dispatch failed.",
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
