import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { FinanceAuditLogAdapter } from "./audit-log.adapter";

const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

function makeDb(): { adapter: FinanceAuditLogAdapter; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: vi.fn(() => Promise.resolve([])), auditLog: { create } };
  const db = {
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaClient;
  return { adapter: new FinanceAuditLogAdapter(db), create };
}

describe("FinanceAuditLogAdapter", () => {
  it("writes a tenant-scoped audit row with a snapshot", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "purchase_order.received",
      entityType: "purchase_order_receipt",
      entityId: "r1",
      changes: { receiptId: "r1" },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY,
        actorId: "a1",
        action: "purchase_order.received",
        entityType: "purchase_order_receipt",
        entityId: "r1",
        changes: { receiptId: "r1" },
      },
    });
  });

  it("omits changes when none are given", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "supplier.archived",
      entityType: "supplier",
      entityId: "s1",
    });
    const arg = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect("changes" in arg.data).toBe(false);
  });
});
