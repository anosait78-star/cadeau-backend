import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@cadeau/database";
import { StorefrontWebhookInboxRepository } from "./storefront-webhook-inbox.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const CONNECTION = "22222222-2222-2222-2222-222222222222";

function eventRow(extra: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    connectionId: CONNECTION,
    eventType: "product",
    externalId: "ext-1",
    status: "pending",
    error: null,
    internalEntityId: null,
    attemptCount: 1,
    receivedAt: new Date("2026-01-01T00:00:00.000Z"),
    processedAt: null,
    ...extra,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

/**
 * Each `$transaction` call gets its OWN mock `tx` (mirroring real Prisma: a
 * failed transaction is rolled back, so a later `$transaction` call runs
 * against a fresh connection/transaction, never the poisoned one). Tests
 * assert on `queryRaw` (proof of `setTenantContext`) and per-call `create`/
 * `findFirst` mocks to prove which transaction each query ran in.
 */
function makeRepo() {
  const queryRaw = vi.fn().mockResolvedValue([]);
  const create = vi.fn();
  const findFirst = vi.fn();
  const update = vi.fn();
  const transactionCalls: unknown[] = [];
  const prisma = {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => {
      const tx = { $queryRaw: queryRaw, storefrontWebhookEvent: { create, findFirst, update } };
      transactionCalls.push(tx);
      return fn(tx);
    }),
  };
  const repo = new StorefrontWebhookInboxRepository(prisma as unknown as PrismaClient);
  return { repo, prisma, create, findFirst, update, transactionCalls };
}

describe("StorefrontWebhookInboxRepository.enqueue", () => {
  /**
   * Order #31638 (2026-09-12): the first delivery failed while the order was
   * still awaiting payment, the customer then paid, and WooCommerce
   * redelivered — but the row kept the original pre-payment snapshot, so
   * reprocessing it recreated the order unpaid. A replayable row must hold
   * the freshest payload.
   */
  it.each([["pending"], ["failed"]])(
    "refreshes the stored payload when a %s event is redelivered",
    async (status) => {
      const { repo, create, findFirst, update } = makeRepo();
      create.mockRejectedValue(p2002());
      findFirst.mockResolvedValue(eventRow({ status }));
      update.mockResolvedValue(eventRow({ status }));

      const result = await repo.enqueue(COMPANY, CONNECTION, "order", "ext-1", { paid: true });

      expect(result.enqueued).toBe(false);
      expect(update).toHaveBeenCalledWith({
        where: { id: "evt-1" },
        data: { payload: { paid: true } },
      });
    },
  );

  it("leaves a processed event's payload alone — it is history, and reprocess refuses it anyway", async () => {
    const { repo, create, findFirst, update } = makeRepo();
    create.mockRejectedValue(p2002());
    findFirst.mockResolvedValue(eventRow({ status: "processed", internalEntityId: "order-9" }));

    const result = await repo.enqueue(COMPANY, CONNECTION, "order", "ext-1", { paid: true });

    expect(result.enqueued).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("creates the event and reports enqueued=true on the happy path", async () => {
    const { repo, create } = makeRepo();
    create.mockResolvedValue(eventRow());

    const result = await repo.enqueue(COMPANY, CONNECTION, "product", "ext-1", { a: 1 });

    expect(result).toEqual({ event: expect.objectContaining({ id: "evt-1" }), enqueued: true });
  });

  it("on a duplicate (P2002), looks up the existing event in a SEPARATE transaction — not the one create() poisoned", async () => {
    const { repo, prisma, create, findFirst } = makeRepo();
    create.mockRejectedValue(p2002());
    findFirst.mockResolvedValue(eventRow({ status: "processed", internalEntityId: "product-9" }));

    const result = await repo.enqueue(COMPANY, CONNECTION, "product", "ext-1", { a: 1 });

    expect(result).toEqual({
      event: expect.objectContaining({ status: "processed", internalEntityId: "product-9" }),
      enqueued: false,
    });
    // Two independent $transaction calls: one for the failed create, one for
    // the recovery lookup. Reusing the first (aborted) tx would 25P02.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectionId: CONNECTION, eventType: "product", externalId: "ext-1" },
      }),
    );
  });

  it("re-throws the P2002 when no existing row is found (a real constraint issue, not a duplicate delivery)", async () => {
    const { repo, create, findFirst } = makeRepo();
    create.mockRejectedValue(p2002());
    findFirst.mockResolvedValue(null);

    await expect(repo.enqueue(COMPANY, CONNECTION, "product", "ext-1", {})).rejects.toThrow(
      "Unique constraint failed",
    );
  });

  it("re-throws non-P2002 errors without attempting the recovery lookup", async () => {
    const { repo, create, findFirst } = makeRepo();
    create.mockRejectedValue(new Error("connection reset"));

    await expect(repo.enqueue(COMPANY, CONNECTION, "product", "ext-1", {})).rejects.toThrow(
      "connection reset",
    );
    expect(findFirst).not.toHaveBeenCalled();
  });
});
