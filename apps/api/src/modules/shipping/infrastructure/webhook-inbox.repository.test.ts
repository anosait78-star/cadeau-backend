import { Prisma, type PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS } from "../domain/webhook-retry-policy";
import { WebhookInboxRepository } from "./webhook-inbox.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";

function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6",
    meta: { target },
  });
}

function makeRepo(claimedRows: readonly Record<string, unknown>[] = []) {
  const create = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const models = { shippingWebhookEvent: { create, updateMany } };
  // One $queryRaw mock serves both call sites: `setTenantContext` (enqueue/
  // markProcessed/markFailed's tenant-bound tx) ignores its return value, and
  // `claimBatch`'s cross-tenant claim query (via `withTransaction`) reads it.
  const queryRaw = vi.fn(() => Promise.resolve(claimedRows));
  const txHost = { $queryRaw: queryRaw, ...models };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  const repo = new WebhookInboxRepository(prisma as unknown as PrismaClient);
  return { repo, create, updateMany, claimQueryRaw: queryRaw };
}

describe("WebhookInboxRepository — enqueue", () => {
  it("writes a pending row and reports enqueued: true", async () => {
    const { repo, create } = makeRepo();
    const result = await repo.enqueue(COMPANY, "manual", "evt_1", { trackingNumber: "MAN-1" });
    expect(result).toEqual({ enqueued: true });
    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data["companyId"]).toBe(COMPANY);
    expect(data["carrier"]).toBe("manual");
    expect(data["carrierEventId"]).toBe("evt_1");
    expect(data["status"]).toBe("pending");
    expect(data["attempts"]).toBe(0);
  });

  it("treats a duplicate (carrier, carrierEventId) as an idempotent no-op", async () => {
    const { repo, create } = makeRepo();
    create.mockRejectedValueOnce(uniqueViolation("shipping_webhook_events_carrier_event_key"));
    const result = await repo.enqueue(COMPANY, "manual", "evt_1", {});
    expect(result).toEqual({ enqueued: false });
  });

  it("rethrows an unrelated error", async () => {
    const { repo, create } = makeRepo();
    create.mockRejectedValueOnce(new Error("db down"));
    await expect(repo.enqueue(COMPANY, "manual", "evt_1", {})).rejects.toThrow("db down");
  });
});

describe("WebhookInboxRepository — claimBatch", () => {
  it("maps claimed rows to PendingWebhookEvent", async () => {
    const { repo } = makeRepo([
      {
        id: "e1",
        company_id: COMPANY,
        carrier: "manual",
        carrier_event_id: "evt_1",
        payload: { trackingNumber: "MAN-1", status: "picked_up" },
        attempts: 0,
      },
    ]);
    const claimed = await repo.claimBatch(20);
    expect(claimed).toEqual([
      {
        id: "e1",
        companyId: COMPANY,
        carrier: "manual",
        carrierEventId: "evt_1",
        payload: { trackingNumber: "MAN-1", status: "picked_up" },
        attempts: 0,
      },
    ]);
  });

  it("returns an empty array when nothing is due", async () => {
    const { repo } = makeRepo([]);
    expect(await repo.claimBatch(20)).toEqual([]);
  });
});

describe("WebhookInboxRepository — markProcessed / markFailed", () => {
  it("marks a row processed", async () => {
    const { repo, updateMany } = makeRepo();
    await repo.markProcessed(COMPANY, "e1");
    const call = updateMany.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: "e1", companyId: COMPANY });
    expect(call.data["status"]).toBe("processed");
    expect(call.data["processedAt"]).toBeInstanceOf(Date);
  });

  it("schedules a backoff retry on failure", async () => {
    const { repo, updateMany } = makeRepo();
    await repo.markFailed(COMPANY, "e1", 2);
    const call = updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data["status"]).toBe("failed");
    expect(call.data["attempts"]).toBe(2);
    expect(call.data["nextAttemptAt"]).toBeInstanceOf(Date);
  });

  it("parks the row (nextAttemptAt: null) once the retry budget is exhausted", async () => {
    const { repo, updateMany } = makeRepo();
    await repo.markFailed(COMPANY, "e1", MAX_ATTEMPTS);
    const call = updateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data["nextAttemptAt"]).toBeNull();
  });
});
