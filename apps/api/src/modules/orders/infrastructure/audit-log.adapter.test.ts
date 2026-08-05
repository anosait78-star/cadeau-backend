import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { OrdersAuditLogAdapter } from "./audit-log.adapter";

const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

function makeDb(): { adapter: OrdersAuditLogAdapter; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: vi.fn(() => Promise.resolve([])), auditLog: { create } };
  const db = {
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaClient;
  return { adapter: new OrdersAuditLogAdapter(db), create };
}

describe("OrdersAuditLogAdapter", () => {
  it("writes a tenant-scoped audit row with the change payload", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "order.status_changed",
      entityType: "order",
      entityId: "o1",
      changes: { from: "new", to: "processing" },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY,
        actorId: "a1",
        action: "order.status_changed",
        entityType: "order",
        entityId: "o1",
        changes: { from: "new", to: "processing" },
      },
    });
  });

  it("omits changes when none are given", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "order.created",
      entityType: "order",
      entityId: "o1",
    });
    const arg = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect("changes" in arg.data).toBe(false);
  });
});
