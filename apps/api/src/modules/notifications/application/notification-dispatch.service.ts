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
import { MESSAGING_FACTS, type MessagingFactsPort } from "../domain/messaging-facts.port";
import {
  NOTIFICATIONS_AUDIT,
  type NotificationsAuditPort,
} from "../domain/notifications-audit.port";
import {
  NOTIFICATIONS_REPOSITORY,
  type NotificationsRepositoryPort,
} from "../domain/notifications-repository.port";
import type { NotificationType } from "../domain/notification-types";
import { ORDER_FACTS, type OrderFactsPort } from "../domain/order-facts.port";

/**
 * Formats an integer minor-unit amount for the stored fallback strings only
 * (api-conventions §money). No currency symbol: the company's currency is a
 * display concern the client owns, and the fallback text must not imply one.
 */
function formatMinor(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

/**
 * The event-bus subscriber that turns `order.created`/`order.status_changed`/
 * `payment.collected` into an in-app notification (+ queued Web Push
 * deliveries + a best-effort end-customer message) (EPIC-15 M15.2, decision
 * D6). The **first real subscriber** on the EPIC-6 event bus — every publisher
 * before this epic had zero subscribers.
 *
 * Subscribes in `onModuleInit` (the bus has no "replay" — only events
 * published after this module boots are seen, exactly like every other
 * consumer of this bus would behave).
 *
 * **Recipients.** For a *lifecycle* event (status change, payment) the audience
 * is the order's assignee when it has one. An unassigned order used to be a
 * silent no-op (D9), but orders are usually unassigned — every order in
 * production was when this was found — so those notifications never went out;
 * it now falls back to the new-order audience below. Applying the assignee rule
 * same rule to `order.created` produced silence, because a freshly created
 * order almost never has an assignee yet. A new order therefore goes to the
 * **union** of three groups, de-duplicated so nobody gets two copies:
 *
 *   1. the company's `owner` members, unconditionally;
 *   2. everyone effectively holding `orders.manage` — the permission that
 *      means "may act on an order", as opposed to the viewing-only
 *      `orders.read`;
 *   3. the order's assignee, when it has one.
 *
 * Groups 1 and 2 come from {@link OrderFactsPort.listNewOrderRecipients},
 * resolved by the same three-layer resolver the guards use, so tenant scoping
 * and feature gating are unchanged. The event's `actorId` is always excluded:
 * nobody is notified about their own action. A system action (the storefront
 * sync) carries `actorId: null`, so it excludes no one.
 *
 * **Content.** The stored `title`/`body` are a plain, single-language
 * *fallback* for Web Push (the OS renders a push payload long before a
 * locale-aware client sees it) — written in Arabic, the product's primary
 * language. The real in-app text is rendered from the stable `type` +
 * structured `payload` by the web client's i18n dictionaries, so one row reads
 * correctly in either language. A localized sentence must never be the only
 * copy: the reader's language is not known at write time.
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
    @Inject(MESSAGING_FACTS) private readonly messagingFacts: MessagingFactsPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.unsubscribes = [
      this.events.subscribe("order.created", (event) => this.onOrderCreated(event)),
      this.events.subscribe("order.status_changed", (event) => this.onOrderStatusChanged(event)),
      this.events.subscribe("payment.collected", (event) => this.onPaymentCollected(event)),
      this.events.subscribe("message.created", (event) => this.onMessageCreated(event)),
    ];
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
  }

  /**
   * A brand-new order: owners + `orders.manage` holders + the assignee, as a
   * de-duplicated set with the actor removed (see the class doc).
   */
  private async onOrderCreated(event: DomainEvent<"order.created">): Promise<void> {
    const order = await this.orderFacts.findById(event.companyId, event.payload.orderId);
    if (order === null) return;

    const recipients = new Set(
      await this.orderFacts.listNewOrderRecipients(event.companyId, event.actorId),
    );
    if (order.assigneeId !== null && order.assigneeId !== event.actorId) {
      recipients.add(order.assigneeId);
    }

    const payload = {
      orderId: event.payload.orderId,
      orderNumber: Number(order.orderNumber),
      customerName: order.customerName,
      totalMinor: order.totalMinor,
    };
    for (const recipient of recipients) {
      await this.dispatch(event.companyId, recipient, {
        type: "order.created",
        title: "طلب جديد",
        body: `طلب رقم ${order.orderNumber} من ${order.customerName} بقيمة ${formatMinor(order.totalMinor)}.`,
        payload,
      });
    }
  }

  private async onOrderStatusChanged(event: DomainEvent<"order.status_changed">): Promise<void> {
    const order = await this.orderFacts.findById(event.companyId, event.payload.orderId);
    if (order !== null) {
      const recipients = await this.lifecycleRecipients(
        event.companyId,
        event.actorId,
        order.assigneeId,
      );
      for (const recipient of recipients) {
        await this.dispatch(event.companyId, recipient, {
          type: "order.status_changed",
          title: "تحديث حالة طلب",
          body: `طلب رقم ${order.orderNumber} (${order.customerName}) انتقل إلى ${event.payload.toStatus}.`,
          payload: {
            orderId: event.payload.orderId,
            orderNumber: Number(order.orderNumber),
            customerName: order.customerName,
            fromStatus: event.payload.fromStatus,
            toStatus: event.payload.toStatus,
          },
        });
      }

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
        title: "طلب جديد للتجهيز",
        // Deliberately no customer name here: a vendor sees only their own
        // group's ids, never the buyer (Vendor Accounts, Phase 5).
        body:
          orderNumber === null
            ? "لديك طلب جديد لتجهيزه."
            : `لديك طلب جديد لتجهيزه: #${orderNumber}.`,
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
    if (order === null) return;

    const recipients = await this.lifecycleRecipients(
      event.companyId,
      event.actorId,
      order.assigneeId,
    );
    for (const recipient of recipients) {
      await this.dispatch(event.companyId, recipient, {
        type: "payment.collected",
        title: "تم تحصيل دفعة",
        body: `تحصيل ${formatMinor(event.payload.amountMinor)} على طلب رقم ${order.orderNumber} (${order.customerName}).`,
        payload: {
          orderId: event.payload.orderId,
          orderNumber: Number(order.orderNumber),
          customerName: order.customerName,
          amountMinor: event.payload.amountMinor,
        },
      });
    }
  }

  /**
   * A message landed in a vendor conversation (EPIC-17 M17.5). The audience is
   * the *other* side of that one thread: every `messaging.manage` holder when
   * a vendor wrote, or the thread's vendor when staff wrote — never both, and
   * never the sender. The title/body stay generic (no preview, no sender
   * name): they are what Web Push renders on the OS notification banner,
   * outside the app and outside any auth check, so the message's own text
   * never belongs there (see the `message.created` payload doc). The
   * structured `preview` is safe on the *dispatch* payload only because it is
   * carried inside the queued push message's data, not rendered on the
   * banner (`apps/web/public/sw.js`) — the in-app client that reads it is the
   * same recipient who could already read the thread's preview through
   * `GET /threads`.
   */
  private async onMessageCreated(event: DomainEvent<"message.created">): Promise<void> {
    const payload = { threadId: event.payload.threadId, preview: event.payload.preview };

    if (event.payload.senderKind === "vendor") {
      const recipients = await this.messagingFacts.listMessagingManageRecipients(
        event.companyId,
        event.actorId,
      );
      for (const recipient of recipients) {
        await this.dispatch(event.companyId, recipient, {
          type: "message.received",
          title: "رسالة جديدة",
          body: "وصلت رسالة جديدة من أحد الموردين.",
          payload,
        });
      }
      return;
    }

    const vendor = await this.messagingFacts.findThreadVendor(
      event.companyId,
      event.payload.threadId,
    );
    if (vendor === null || vendor.vendorUserId === event.actorId) return;
    await this.dispatch(event.companyId, vendor.vendorUserId, {
      type: "message.received",
      title: "رسالة جديدة",
      body: "وصلتك رسالة جديدة من الفريق.",
      payload,
    });
  }

  /**
   * Who hears about a lifecycle change (status, payment): the order's assignee
   * when it has one; otherwise the new-order audience — owners and
   * `orders.manage` holders — minus the actor (see the class doc).
   */
  private async lifecycleRecipients(
    companyId: string,
    actorId: string | null,
    assigneeId: string | null,
  ): Promise<readonly string[]> {
    if (assigneeId !== null) return [assigneeId];
    return this.orderFacts.listNewOrderRecipients(companyId, actorId);
  }

  /** Creates the in-app row (if enabled) and queues Web Push deliveries (if enabled). */
  private async dispatch(
    companyId: string,
    profileId: string,
    input: {
      type: NotificationType;
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
