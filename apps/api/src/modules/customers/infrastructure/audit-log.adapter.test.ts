import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { CustomersAuditLogAdapter } from "./audit-log.adapter";

const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

function makeDb(): { adapter: CustomersAuditLogAdapter; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: vi.fn(() => Promise.resolve([])), auditLog: { create } };
  const db = {
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaClient;
  return { adapter: new CustomersAuditLogAdapter(db), create };
}

describe("CustomersAuditLogAdapter", () => {
  it("writes a tenant-scoped audit row", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "customer.updated",
      entityType: "customer",
      entityId: "c1",
      changes: { fields: ["phone"] },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY,
        actorId: "a1",
        action: "customer.updated",
        entityType: "customer",
        entityId: "c1",
        changes: { fields: ["phone"] },
      },
    });
  });

  it("records the field name, never the value the caller sent", async () => {
    // The audit log is read across tenants by platform admins, so a customer
    // audit row must name what changed without carrying the personal value.
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "customer.updated",
      entityType: "customer",
      entityId: "c1",
      changes: { fields: ["phone", "email"] },
    });
    const serialized = JSON.stringify(create.mock.calls[0]?.[0]);
    expect(serialized).toContain("phone");
    expect(serialized).not.toContain("+20");
    expect(serialized).not.toContain("@");
  });

  it("omits changes when none are given", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      actorId: "a1",
      action: "customer.created",
      entityType: "customer",
      entityId: "c1",
    });
    const arg = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect("changes" in arg.data).toBe(false);
  });
});
