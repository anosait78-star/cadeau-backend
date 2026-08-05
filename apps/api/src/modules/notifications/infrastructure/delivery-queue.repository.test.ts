import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS } from "../domain/delivery-retry-policy";
import { DeliveryQueueRepository } from "./delivery-queue.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";

function makeRepo(claimedRows: readonly Record<string, unknown>[] = []) {
  const create = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const notificationDelivery = { create, updateMany };
  const notificationFindUnique = vi
    .fn()
    .mockResolvedValue({ title: "t", body: "b", payload: { orderId: "o1" } });
  const subscriptionFindUnique = vi
    .fn()
    .mockResolvedValue({ endpoint: "https://push.example/ep", p256dh: "p", auth: "a" });
  const notification = { findUnique: notificationFindUnique };
  const pushSubscription = { findUnique: subscriptionFindUnique };
  const queryRaw = vi.fn(() => Promise.resolve(claimedRows));
  const txHost = { $queryRaw: queryRaw, notificationDelivery, notification, pushSubscription };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  const repo = new DeliveryQueueRepository(prisma as unknown as PrismaClient);
  return { repo, create, updateMany, notificationFindUnique, subscriptionFindUnique };
}

describe("DeliveryQueueRepository — enqueue", () => {
  it("writes a pending row", async () => {
    const { repo, create } = makeRepo();
    await repo.enqueue(COMPANY, "n1", "s1");
    const data = create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data["companyId"]).toBe(COMPANY);
    expect(data["notificationId"]).toBe("n1");
    expect(data["pushSubscriptionId"]).toBe("s1");
    expect(data["status"]).toBe("pending");
    expect(data["attempts"]).toBe(0);
  });
});

describe("DeliveryQueueRepository — claimBatch", () => {
  it("returns an empty array when nothing is due", async () => {
    const { repo } = makeRepo([]);
    expect(await repo.claimBatch(20)).toEqual([]);
  });

  it("joins in the notification and subscription details for each claimed row", async () => {
    const { repo } = makeRepo([
      {
        id: "d1",
        company_id: COMPANY,
        notification_id: "n1",
        push_subscription_id: "s1",
        attempts: 0,
      },
    ]);
    const claimed = await repo.claimBatch(20);
    expect(claimed).toEqual([
      {
        id: "d1",
        companyId: COMPANY,
        notificationId: "n1",
        pushSubscriptionId: "s1",
        attempts: 0,
        notification: { title: "t", body: "b", payload: { orderId: "o1" } },
        subscription: { endpoint: "https://push.example/ep", p256dh: "p", auth: "a" },
      },
    ]);
  });

  it("skips a claimed row whose notification was since deleted", async () => {
    const { repo, notificationFindUnique } = makeRepo([
      {
        id: "d1",
        company_id: COMPANY,
        notification_id: "n1",
        push_subscription_id: "s1",
        attempts: 0,
      },
    ]);
    notificationFindUnique.mockResolvedValueOnce(null);
    expect(await repo.claimBatch(20)).toEqual([]);
  });

  it("skips a claimed row whose subscription was since deleted", async () => {
    const { repo, subscriptionFindUnique } = makeRepo([
      {
        id: "d1",
        company_id: COMPANY,
        notification_id: "n1",
        push_subscription_id: "s1",
        attempts: 0,
      },
    ]);
    subscriptionFindUnique.mockResolvedValueOnce(null);
    expect(await repo.claimBatch(20)).toEqual([]);
  });
});

describe("DeliveryQueueRepository — markProcessed / markFailed", () => {
  it("marks a row processed", async () => {
    const { repo, updateMany } = makeRepo();
    await repo.markProcessed(COMPANY, "d1");
    const call = updateMany.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: "d1", companyId: COMPANY });
    expect(call.data["status"]).toBe("processed");
    expect(call.data["processedAt"]).toBeInstanceOf(Date);
  });

  it("schedules a backoff retry and records lastError on failure", async () => {
    const { repo, updateMany } = makeRepo();
    await repo.markFailed(COMPANY, "d1", 2, "push service unreachable");
    const call = updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data["status"]).toBe("failed");
    expect(call.data["attempts"]).toBe(2);
    expect(call.data["nextAttemptAt"]).toBeInstanceOf(Date);
    expect(call.data["lastError"]).toBe("push service unreachable");
  });

  it("parks the row (nextAttemptAt: null) once the retry budget is exhausted", async () => {
    const { repo, updateMany } = makeRepo();
    await repo.markFailed(COMPANY, "d1", MAX_ATTEMPTS, "gone");
    const call = updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data["nextAttemptAt"]).toBeNull();
  });

  it("truncates an overly long error message", async () => {
    const { repo, updateMany } = makeRepo();
    await repo.markFailed(COMPANY, "d1", 1, "x".repeat(3000));
    const call = updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect((call.data["lastError"] as string).length).toBe(2000);
  });
});
