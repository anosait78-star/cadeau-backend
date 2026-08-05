import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { ProductsAuditLogAdapter } from "./audit-log.adapter";

const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

function makeDb(): { adapter: ProductsAuditLogAdapter; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: vi.fn(() => Promise.resolve([])), auditLog: { create } };
  const db = {
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaClient;
  return { adapter: new ProductsAuditLogAdapter(db), create };
}

describe("ProductsAuditLogAdapter", () => {
  it("writes a tenant-scoped audit row with a snapshot", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "product.created",
      entityType: "product",
      entityId: "p1",
      changes: { name: "Mug" },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY,
        actorId: "a1",
        action: "product.created",
        entityType: "product",
        entityId: "p1",
        changes: { name: "Mug" },
      },
    });
  });

  it("omits changes when none are given", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "product.archived",
      entityType: "product",
      entityId: "p1",
    });
    const arg = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect("changes" in arg.data).toBe(false);
  });
});
