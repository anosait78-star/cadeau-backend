import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { OrderFactsAdapter } from "./order-facts.adapter";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ORDER = "22222222-2222-2222-2222-222222222222";

function makeAdapter(order: unknown) {
  const findUnique = vi.fn().mockResolvedValue(order);
  const txHost = { $queryRaw: vi.fn(), order: { findUnique } };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  return { adapter: new OrderFactsAdapter(prisma as unknown as PrismaClient), findUnique };
}

describe("OrderFactsAdapter", () => {
  it("reads assigneeId/orderNumber tenant-bound", async () => {
    const { adapter, findUnique } = makeAdapter({ assigneeId: "p1", orderNumber: 42n });
    const facts = await adapter.findById(COMPANY, ORDER);
    expect(facts).toEqual({ assigneeId: "p1", orderNumber: 42n });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: ORDER },
      select: { assigneeId: true, orderNumber: true },
    });
  });

  it("returns null when the order does not exist", async () => {
    const { adapter } = makeAdapter(null);
    expect(await adapter.findById(COMPANY, ORDER)).toBeNull();
  });
});
