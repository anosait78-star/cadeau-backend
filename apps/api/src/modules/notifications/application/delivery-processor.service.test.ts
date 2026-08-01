import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { Clock } from "../../../shared/time/clock";
import type { DeliveryQueuePort, PendingDelivery } from "../domain/delivery-queue.port";
import { PushSubscriptionGoneError, type PushSenderPort } from "../domain/push-sender.port";
import type { NotificationsRepositoryPort } from "../domain/notifications-repository.port";
import { DeliveryProcessorService } from "./delivery-processor.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";

function delivery(extra: Partial<PendingDelivery> = {}): PendingDelivery {
  return {
    id: "d1",
    companyId: COMPANY,
    notificationId: "n1",
    pushSubscriptionId: "s1",
    attempts: 0,
    notification: { title: "Order status changed", body: "…", payload: { orderId: "o1" } },
    subscription: { endpoint: "https://push.example/ep", p256dh: "p", auth: "a" },
    ...extra,
  };
}

interface Harness {
  processor: DeliveryProcessorService;
  queue: { [K in keyof DeliveryQueuePort]: ReturnType<typeof vi.fn> };
  sender: { send: ReturnType<typeof vi.fn> };
  repo: { deleteSubscriptionById: ReturnType<typeof vi.fn> };
  events: { publish: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const queue = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    claimBatch: vi.fn().mockResolvedValue([delivery()]),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
  const sender = { send: vi.fn().mockResolvedValue(undefined) };
  const repo = { deleteSubscriptionById: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn().mockResolvedValue(undefined) };
  const clock: Clock = { now: () => 1_700_000_000_000 };
  const processor = new DeliveryProcessorService(
    queue as unknown as DeliveryQueuePort,
    sender as unknown as PushSenderPort,
    repo as unknown as NotificationsRepositoryPort,
    events as unknown as EventBusPort,
    clock,
  );
  return { processor, queue, sender, repo, events };
}

describe("DeliveryProcessorService.processBatch", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("returns zero counts when nothing is due", async () => {
    h.queue.claimBatch.mockResolvedValueOnce([]);
    const result = await h.processor.processBatch(20);
    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(h.sender.send).not.toHaveBeenCalled();
  });

  it("sends, marks processed, and emits notification.delivered on success", async () => {
    const result = await h.processor.processBatch(20);
    expect(h.sender.send).toHaveBeenCalledWith(delivery().subscription, {
      title: "Order status changed",
      body: "…",
      payload: { orderId: "o1" },
    });
    expect(h.queue.markProcessed).toHaveBeenCalledWith(COMPANY, "d1");
    expect(h.events.publish).toHaveBeenCalledWith({
      type: "notification.delivered",
      companyId: COMPANY,
      actorId: null,
      occurredAt: 1_700_000_000_000,
      payload: { notificationId: "n1", pushSubscriptionId: "s1" },
    });
    expect(result).toEqual({ processed: 1, failed: 0 });
  });

  it("deletes the subscription and counts as processed on PushSubscriptionGoneError", async () => {
    h.sender.send.mockRejectedValueOnce(new PushSubscriptionGoneError());
    const result = await h.processor.processBatch(20);
    expect(h.repo.deleteSubscriptionById).toHaveBeenCalledWith(COMPANY, "s1");
    expect(h.queue.markProcessed).toHaveBeenCalledWith(COMPANY, "d1");
    expect(h.queue.markFailed).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 1, failed: 0 });
  });

  it("marks failed with backoff on any other send error, carrying the incremented attempt count", async () => {
    h.sender.send.mockRejectedValueOnce(new Error("push service unreachable"));
    h.queue.claimBatch.mockResolvedValueOnce([delivery({ attempts: 3 })]);
    const result = await h.processor.processBatch(20);
    expect(h.queue.markFailed).toHaveBeenCalledWith(COMPANY, "d1", 4, "push service unreachable");
    expect(result).toEqual({ processed: 0, failed: 1 });
  });

  it("processes multiple due deliveries independently", async () => {
    h.queue.claimBatch.mockResolvedValueOnce([delivery({ id: "a" }), delivery({ id: "b" })]);
    h.sender.send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("nope"));
    const result = await h.processor.processBatch(20);
    expect(result).toEqual({ processed: 1, failed: 1 });
  });
});
