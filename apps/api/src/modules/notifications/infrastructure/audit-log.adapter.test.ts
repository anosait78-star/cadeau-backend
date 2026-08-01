import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { NotificationsAuditLogAdapter } from "./audit-log.adapter";

const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

function makeDb(): { adapter: NotificationsAuditLogAdapter; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: vi.fn(() => Promise.resolve([])), auditLog: { create } };
  const db = {
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaClient;
  return { adapter: new NotificationsAuditLogAdapter(db), create };
}

describe("NotificationsAuditLogAdapter", () => {
  it("writes a tenant-scoped, system-originated audit row", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      action: "notification.created",
      entityType: "notification",
      entityId: "n1",
      changes: { type: "order.status_changed", recipientProfileId: "p1" },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY,
        actorId: null,
        action: "notification.created",
        entityType: "notification",
        entityId: "n1",
        changes: { type: "order.status_changed", recipientProfileId: "p1" },
      },
    });
  });

  it("omits changes when none are given", async () => {
    const { adapter, create } = makeDb();
    await adapter.record({
      companyId: COMPANY,
      action: "notification.created",
      entityType: "notification",
      entityId: "n1",
    });
    const arg = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect("changes" in arg.data).toBe(false);
  });
});
