import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { ShippingAuditLogAdapter } from "./audit-log.adapter";

const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

function makeDb(): { adapter: ShippingAuditLogAdapter; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: vi.fn(() => Promise.resolve([])), auditLog: { create } };
  const db = {
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaClient;
  return { adapter: new ShippingAuditLogAdapter(db), create };
}

describe("ShippingAuditLogAdapter", () => {
  it("writes a tenant-scoped audit row with the change payload", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "shipment.status_changed",
      entityType: "shipment",
      entityId: "s1",
      changes: { from: "created", to: "picked_up" },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY,
        actorId: "a1",
        action: "shipment.status_changed",
        entityType: "shipment",
        entityId: "s1",
        changes: { from: "created", to: "picked_up" },
      },
    });
  });

  it("records a null actorId for a system-originated change (M12.4 webhook processor)", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: null,
      action: "shipment.status_changed",
      entityType: "shipment",
      entityId: "s1",
      changes: { from: "in_transit", to: "delivered" },
    });
    const arg = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(arg.data["actorId"]).toBeNull();
  });

  it("omits changes when none are given", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "shipment.created",
      entityType: "shipment",
      entityId: "s1",
    });
    const arg = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect("changes" in arg.data).toBe(false);
  });
});
