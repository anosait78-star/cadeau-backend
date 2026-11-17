import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@cadeau/database";
import type { AccessResolverService } from "../../../shared/access/access-resolver.service";
import { MessagingFactsAdapter } from "./messaging-facts.adapter";

const COMPANY = "11111111-1111-1111-1111-111111111111";

function makeAdapter() {
  const companyMember = { findMany: vi.fn().mockResolvedValue([]) };
  const messageThread = { findUnique: vi.fn().mockResolvedValue(null) };
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]), companyMember, messageThread };
  const prisma = { $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const access = {
    resolveCompanyMembers: vi.fn().mockResolvedValue([
      { userId: "owner", permissions: ["messaging.manage", "vendor_payouts.manage"] },
      { userId: "finance", permissions: ["vendor_payouts.manage"] },
      { userId: "clerk", permissions: ["orders.read"] },
    ]),
  };
  const adapter = new MessagingFactsAdapter(
    prisma as unknown as PrismaClient,
    access as unknown as AccessResolverService,
  );
  return { adapter, companyMember, messageThread };
}

describe("MessagingFactsAdapter", () => {
  it("finds a thread's vendor, or null when it is gone", async () => {
    const { adapter, messageThread } = makeAdapter();
    messageThread.findUnique.mockResolvedValueOnce({ vendorMember: { userId: "vendor1" } });
    expect(await adapter.findThreadVendor(COMPANY, "t1")).toEqual({ vendorUserId: "vendor1" });
    expect(await adapter.findThreadVendor(COMPANY, "t1")).toBeNull();
  });

  it("lists every active account of one vendor warehouse", async () => {
    const { adapter, companyMember } = makeAdapter();
    companyMember.findMany.mockResolvedValueOnce([{ userId: "v1" }, { userId: "v2" }]);
    expect(await adapter.listWarehouseVendorUsers(COMPANY, "w1")).toEqual(["v1", "v2"]);
    expect(companyMember.findMany.mock.calls[0]![0].where).toEqual({
      companyId: COMPANY,
      warehouseId: "w1",
      status: "active",
    });
  });

  it("lists the holders of a permission minus the actor", async () => {
    const { adapter } = makeAdapter();
    expect(await adapter.listPermissionHolders(COMPANY, "vendor_payouts.manage", "owner")).toEqual([
      "finance",
    ]);
    expect(await adapter.listPermissionHolders(COMPANY, "vendor_payouts.manage", null)).toEqual([
      "owner",
      "finance",
    ]);
  });

  it("keeps messaging.manage recipients on the same resolver", async () => {
    const { adapter } = makeAdapter();
    expect(await adapter.listMessagingManageRecipients(COMPANY, null)).toEqual(["owner"]);
  });
});
