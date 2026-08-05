import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { MasterDataAuditLogAdapter } from "./audit-log.adapter";

const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

function makeDb(): { adapter: MasterDataAuditLogAdapter; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: vi.fn(() => Promise.resolve([])), auditLog: { create } };
  const db = {
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaClient;
  return { adapter: new MasterDataAuditLogAdapter(db), create };
}

describe("MasterDataAuditLogAdapter", () => {
  it("writes a tenant-scoped audit row with a snapshot", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "master_data.created",
      entityType: "order-labels",
      entityId: "l1",
      changes: { name: "VIP" },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY,
        actorId: "a1",
        action: "master_data.created",
        entityType: "order-labels",
        entityId: "l1",
        changes: { name: "VIP" },
      },
    });
  });

  it("omits changes when none are given", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "master_data.deactivated",
      entityType: "order-labels",
      entityId: "l1",
    });
    const arg = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect("changes" in arg.data).toBe(false);
  });
});
