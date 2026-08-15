import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainEvent, DomainEventType } from "../../../shared/events/event-catalog";
import type { EventBusPort, EventHandler } from "../../../shared/events/event-bus.port";
import type { Clock } from "../../../shared/time/clock";
import type { CustomerMessagingPort } from "../domain/customer-messaging.port";
import type { DeliveryQueuePort } from "../domain/delivery-queue.port";
import type { NotificationsAuditPort } from "../domain/notifications-audit.port";
import type { NotificationsRepositoryPort } from "../domain/notifications-repository.port";
import type { OrderFactsPort } from "../domain/order-facts.port";
import { NotificationDispatchService } from "./notification-dispatch.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ASSIGNEE = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";

function statusChangedEvent(): DomainEvent<"order.status_changed"> {
  return {
    type: "order.status_changed",
    companyId: COMPANY,
    actorId: "actor1",
    occurredAt: 1_700_000_000_000,
    payload: { orderId: ORDER, fromStatus: "processing", toStatus: "shipped" },
  };
}

function paymentCollectedEvent(): DomainEvent<"payment.collected"> {
  return {
    type: "payment.collected",
    companyId: COMPANY,
    actorId: "actor1",
    occurredAt: 1_700_000_000_000,
    payload: { orderId: ORDER, amountMinor: 1500 },
  };
}

function enteredProcessingEvent(): DomainEvent<"order.status_changed"> {
  return {
    type: "order.status_changed",
    companyId: COMPANY,
    actorId: "actor1",
    occurredAt: 1_700_000_000_000,
    payload: { orderId: ORDER, fromStatus: "new", toStatus: "processing" },
  };
}

interface Harness {
  service: NotificationDispatchService;
  handlers: Map<DomainEventType, EventHandler<DomainEventType>>;
  repo: { [K in keyof NotificationsRepositoryPort]: ReturnType<typeof vi.fn> };
  audit: { record: ReturnType<typeof vi.fn> };
  deliveryQueue: { [K in keyof DeliveryQueuePort]: ReturnType<typeof vi.fn> };
  customerMessaging: { send: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn> };
  orderFacts: {
    findById: ReturnType<typeof vi.fn>;
    listVendorGroupRecipients: ReturnType<typeof vi.fn>;
  };
}

function makeHarness(assigneeId: string | null = ASSIGNEE): Harness {
  const handlers = new Map<DomainEventType, EventHandler<DomainEventType>>();
  const events = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((type: DomainEventType, handler: EventHandler<DomainEventType>) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    }),
  };
  const repo = {
    list: vi.fn(),
    markRead: vi.fn(),
    create: vi.fn().mockResolvedValue({
      id: "n1",
      type: "order.status_changed",
      title: "t",
      body: "b",
      payload: {},
      readAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    getPreferences: vi.fn(),
    isChannelEnabled: vi.fn().mockResolvedValue(true),
    upsertPreferences: vi.fn(),
    listActiveSubscriptions: vi.fn().mockResolvedValue([{ id: "sub1" }]),
    registerSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    deleteSubscriptionById: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const deliveryQueue = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    claimBatch: vi.fn(),
    markProcessed: vi.fn(),
    markFailed: vi.fn(),
  };
  const customerMessaging = { send: vi.fn().mockResolvedValue({ sent: false }) };
  const orderFacts = {
    findById: vi.fn().mockResolvedValue({ assigneeId, orderNumber: 42n }),
    listVendorGroupRecipients: vi.fn().mockResolvedValue([]),
  };
  const clock: Clock = { now: () => 1_700_000_000_000 };

  const service = new NotificationDispatchService(
    events as unknown as EventBusPort,
    repo as unknown as NotificationsRepositoryPort,
    audit as unknown as NotificationsAuditPort,
    deliveryQueue as unknown as DeliveryQueuePort,
    customerMessaging as unknown as CustomerMessagingPort,
    orderFacts as unknown as OrderFactsPort,
    clock,
  );
  return { service, handlers, repo, audit, deliveryQueue, customerMessaging, events, orderFacts };
}

describe("NotificationDispatchService", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
    h.service.onModuleInit();
  });

  it("subscribes to order.status_changed and payment.collected on init", () => {
    expect(h.handlers.has("order.status_changed")).toBe(true);
    expect(h.handlers.has("payment.collected")).toBe(true);
  });

  it("unsubscribes on destroy", () => {
    h.service.onModuleDestroy();
    expect(h.handlers.size).toBe(0);
  });

  describe("order.status_changed", () => {
    it("creates a notification, audits, emits, queues deliveries, and messages the customer", async () => {
      await h.handlers.get("order.status_changed")?.(statusChangedEvent());
      expect(h.repo.create).toHaveBeenCalledWith(
        COMPANY,
        ASSIGNEE,
        expect.objectContaining({ type: "order.status_changed" }),
      );
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "notification.created", entityId: "n1" }),
      );
      expect(h.events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "notification.created" }),
      );
      expect(h.deliveryQueue.enqueue).toHaveBeenCalledWith(COMPANY, "n1", "sub1");
      expect(h.customerMessaging.send).toHaveBeenCalledWith({
        companyId: COMPANY,
        orderId: ORDER,
        template: "order_status_changed",
        params: { toStatus: "shipped" },
      });
    });

    it("is a silent no-op when the order has no assignee (D9)", async () => {
      h = makeHarness(null);
      h.service.onModuleInit();
      await h.handlers.get("order.status_changed")?.(statusChangedEvent());
      expect(h.repo.create).not.toHaveBeenCalled();
      expect(h.audit.record).not.toHaveBeenCalled();
      expect(h.customerMessaging.send).not.toHaveBeenCalled();
    });

    it("is a silent no-op when the order cannot be found", async () => {
      h.orderFacts.findById.mockResolvedValueOnce(null);
      await h.handlers.get("order.status_changed")?.(statusChangedEvent());
      expect(h.repo.create).not.toHaveBeenCalled();
    });

    it("does not create a row when both channels are disabled for the recipient", async () => {
      h.repo.isChannelEnabled.mockResolvedValue(false);
      await h.handlers.get("order.status_changed")?.(statusChangedEvent());
      expect(h.repo.create).not.toHaveBeenCalled();
    });

    it("skips queuing deliveries when webPush is disabled but inApp is enabled", async () => {
      h.repo.isChannelEnabled.mockImplementation((_c, _p, _t, channel: string) =>
        Promise.resolve(channel === "inApp"),
      );
      await h.handlers.get("order.status_changed")?.(statusChangedEvent());
      expect(h.repo.create).toHaveBeenCalled();
      expect(h.deliveryQueue.enqueue).not.toHaveBeenCalled();
    });

    it("swallows a dispatch failure instead of throwing (subscriber isolation)", async () => {
      h.repo.create.mockRejectedValueOnce(new Error("db down"));
      await expect(
        h.handlers.get("order.status_changed")?.(statusChangedEvent()),
      ).resolves.toBeUndefined();
    });
  });

  describe("order.status_changed → processing (Vendor Accounts, Phase 5)", () => {
    it("notifies each vendor who has a group on this order, with only their own ids", async () => {
      h.orderFacts.listVendorGroupRecipients.mockResolvedValueOnce([
        { orderVendorGroupId: "g1", warehouseId: "w1", vendorUserId: "vendorA" },
        { orderVendorGroupId: "g2", warehouseId: "w2", vendorUserId: "vendorB" },
      ]);
      await h.handlers.get("order.status_changed")?.(enteredProcessingEvent());

      expect(h.repo.create).toHaveBeenCalledWith(
        COMPANY,
        "vendorA",
        expect.objectContaining({
          type: "order_vendor_group.assigned",
          payload: { orderId: ORDER, orderVendorGroupId: "g1", warehouseId: "w1" },
        }),
      );
      expect(h.repo.create).toHaveBeenCalledWith(
        COMPANY,
        "vendorB",
        expect.objectContaining({
          type: "order_vendor_group.assigned",
          payload: { orderId: ORDER, orderVendorGroupId: "g2", warehouseId: "w2" },
        }),
      );
      // Never both vendors' ids in the same call — one notification per vendor.
      const calls = h.repo.create.mock.calls.filter(
        (c) => (c[2] as { type: string }).type === "order_vendor_group.assigned",
      );
      expect(calls).toHaveLength(2);
    });

    it("skips a group with no vendor joined yet (valid state, not an error)", async () => {
      h.orderFacts.listVendorGroupRecipients.mockResolvedValueOnce([]);
      await h.handlers.get("order.status_changed")?.(enteredProcessingEvent());
      expect(h.repo.create).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ type: "order_vendor_group.assigned" }),
      );
    });

    it("still notifies vendors even when the order has no assignee", async () => {
      h = makeHarness(null);
      h.service.onModuleInit();
      h.orderFacts.listVendorGroupRecipients.mockResolvedValueOnce([
        { orderVendorGroupId: "g1", warehouseId: "w1", vendorUserId: "vendorA" },
      ]);
      await h.handlers.get("order.status_changed")?.(enteredProcessingEvent());
      expect(h.repo.create).toHaveBeenCalledWith(
        COMPANY,
        "vendorA",
        expect.objectContaining({ type: "order_vendor_group.assigned" }),
      );
    });

    it("does not run the vendor fan-out for a transition that isn't into processing", async () => {
      await h.handlers.get("order.status_changed")?.(statusChangedEvent()); // -> "shipped"
      expect(h.orderFacts.listVendorGroupRecipients).not.toHaveBeenCalled();
    });
  });

  describe("payment.collected", () => {
    it("creates a notification for the order's assignee", async () => {
      await h.handlers.get("payment.collected")?.(paymentCollectedEvent());
      expect(h.repo.create).toHaveBeenCalledWith(
        COMPANY,
        ASSIGNEE,
        expect.objectContaining({ type: "payment.collected" }),
      );
      expect(h.customerMessaging.send).not.toHaveBeenCalled();
    });

    it("is a silent no-op when the order has no assignee (D9)", async () => {
      h = makeHarness(null);
      h.service.onModuleInit();
      await h.handlers.get("payment.collected")?.(paymentCollectedEvent());
      expect(h.repo.create).not.toHaveBeenCalled();
    });
  });
});
