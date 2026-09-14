import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import type { AccessResolverService } from "../../../shared/access/access-resolver.service";
import { OrderFactsAdapter } from "./order-facts.adapter";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ORDER = "22222222-2222-2222-2222-222222222222";

interface MemberRow {
  readonly memberId: string;
  readonly userId: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

function makeAdapter(
  order: unknown,
  vendorGroups: unknown[] = [],
  options: { members?: MemberRow[]; owners?: { userId: string }[] } = {},
) {
  const findUnique = vi.fn().mockResolvedValue(order);
  const findMany = vi.fn().mockResolvedValue(vendorGroups);
  const memberFindMany = vi.fn().mockResolvedValue(options.owners ?? []);
  const txHost = {
    $queryRaw: vi.fn(),
    order: { findUnique },
    orderVendorGroup: { findMany },
    companyMember: { findMany: memberFindMany },
  };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  const resolveCompanyMembers = vi.fn().mockResolvedValue(options.members ?? []);
  return {
    adapter: new OrderFactsAdapter(
      prisma as unknown as PrismaClient,
      {
        resolveCompanyMembers,
      } as unknown as AccessResolverService,
    ),
    findUnique,
    findMany,
    memberFindMany,
    resolveCompanyMembers,
  };
}

describe("OrderFactsAdapter", () => {
  it("reads assignee, order number, customer name and total tenant-bound", async () => {
    const { adapter, findUnique } = makeAdapter({
      assigneeId: "p1",
      orderNumber: 42n,
      total: 25_000n,
      customer: { name: "Layla Hassan" },
    });
    const facts = await adapter.findById(COMPANY, ORDER);
    expect(facts).toEqual({
      assigneeId: "p1",
      orderNumber: 42n,
      customerName: "Layla Hassan",
      totalMinor: 25_000,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: ORDER },
      select: {
        assigneeId: true,
        orderNumber: true,
        total: true,
        customer: { select: { name: true } },
      },
    });
  });

  it("returns null when the order does not exist", async () => {
    const { adapter } = makeAdapter(null);
    expect(await adapter.findById(COMPANY, ORDER)).toBeNull();
  });
});

describe("OrderFactsAdapter — listVendorGroupRecipients (Vendor Accounts, Phase 5)", () => {
  it("returns one recipient per group that has an active vendor joined", async () => {
    const { adapter, findMany } = makeAdapter(null, [
      { id: "g1", warehouseId: "w1", warehouse: { vendorMembers: [{ userId: "u1" }] } },
      { id: "g2", warehouseId: "w2", warehouse: { vendorMembers: [] } }, // no vendor yet
    ]);
    const recipients = await adapter.listVendorGroupRecipients(COMPANY, ORDER);
    expect(recipients).toEqual([
      { orderVendorGroupId: "g1", warehouseId: "w1", vendorUserId: "u1" },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: ORDER, companyId: COMPANY } }),
    );
  });

  it("returns an empty array when the order has no vendor groups", async () => {
    const { adapter } = makeAdapter(null, []);
    expect(await adapter.listVendorGroupRecipients(COMPANY, ORDER)).toEqual([]);
  });
});

describe("OrderFactsAdapter — listNewOrderRecipients", () => {
  it("unions owners with orders.manage holders and de-duplicates", async () => {
    const { adapter, memberFindMany } = makeAdapter(null, [], {
      owners: [{ userId: "owner1" }],
      members: [
        { memberId: "m1", userId: "owner1", role: "owner", permissions: ["orders.manage"] },
        { memberId: "m2", userId: "manager1", role: "manager", permissions: ["orders.manage"] },
      ],
    });
    expect(await adapter.listNewOrderRecipients(COMPANY, null)).toEqual(["owner1", "manager1"]);
    expect(memberFindMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY, role: "owner", status: "active" },
      select: { userId: true },
    });
  });

  it("includes an owner whose orders.manage was revoked", async () => {
    const { adapter } = makeAdapter(null, [], {
      owners: [{ userId: "owner1" }],
      members: [{ memberId: "m1", userId: "owner1", role: "owner", permissions: [] }],
    });
    expect(await adapter.listNewOrderRecipients(COMPANY, null)).toEqual(["owner1"]);
  });

  it("excludes a member who only holds orders.read", async () => {
    const { adapter } = makeAdapter(null, [], {
      owners: [],
      members: [
        { memberId: "m1", userId: "viewer1", role: "finance", permissions: ["orders.read"] },
      ],
    });
    expect(await adapter.listNewOrderRecipients(COMPANY, null)).toEqual([]);
  });

  it("excludes the actor", async () => {
    const { adapter } = makeAdapter(null, [], {
      owners: [{ userId: "owner1" }],
      members: [
        { memberId: "m2", userId: "manager1", role: "manager", permissions: ["orders.manage"] },
      ],
    });
    expect(await adapter.listNewOrderRecipients(COMPANY, "owner1")).toEqual(["manager1"]);
  });
});
