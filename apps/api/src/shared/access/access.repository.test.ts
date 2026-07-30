import type { PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { AccessRepository, PlatformAdminRepository } from "./access.repository";

const USER = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const COMPANY = "9f1c8f00-0000-4000-8000-000000000001";

/** Configurable rows the fake transaction returns for each finder the repo calls. */
interface Fixtures {
  subscription: unknown;
  features: { key: string }[];
  flags: { featureKey: string; enabled: boolean }[];
  addOns: { featureKey: string }[];
  member: { id: string; role: string } | null;
  template: { permissions: { permissionKey: string }[] } | null;
  memberPermissions: { permissionKey: string; granted: boolean }[];
  featurePermissions: { featureKey: string; permissionKey: string }[];
  platformAdmin: { id: string } | null;
}

function makeDb(f: Partial<Fixtures> = {}): PrismaClient {
  const fx: Fixtures = {
    subscription: null,
    features: [],
    flags: [],
    addOns: [],
    member: null,
    template: null,
    memberPermissions: [],
    featurePermissions: [],
    platformAdmin: null,
    ...f,
  };
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    subscription: { findUnique: () => Promise.resolve(fx.subscription) },
    feature: { findMany: () => Promise.resolve(fx.features) },
    companyFeatureFlag: { findMany: () => Promise.resolve(fx.flags) },
    addOn: { findMany: () => Promise.resolve(fx.addOns) },
    companyMember: { findFirst: () => Promise.resolve(fx.member) },
    permissionTemplate: { findUnique: () => Promise.resolve(fx.template) },
    memberPermission: { findMany: () => Promise.resolve(fx.memberPermissions) },
    featurePermission: { findMany: () => Promise.resolve(fx.featurePermissions) },
    platformAdmin: { findFirst: () => Promise.resolve(fx.platformAdmin) },
  };
  return {
    $transaction: <T>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as PrismaClient;
}

describe("AccessRepository.loadAccessData", () => {
  it("assembles access data from the plan, flags, membership, and edges", async () => {
    const db = makeDb({
      subscription: { plan: { features: [{ featureKey: "orders" }, { featureKey: "products" }] } },
      features: [{ key: "orders" }, { key: "products" }],
      flags: [{ featureKey: "products", enabled: false }],
      addOns: [{ featureKey: "inventory" }],
      member: { id: "m1", role: "owner" },
      template: { permissions: [{ permissionKey: "orders.read" }] },
      memberPermissions: [{ permissionKey: "orders.manage", granted: true }],
      featurePermissions: [{ featureKey: "orders", permissionKey: "orders.read" }],
    });
    const repo = new AccessRepository(db);
    const data = await repo.loadAccessData(USER, COMPANY);

    expect(data.planFeatureKeys).toEqual(["orders", "products"]);
    expect(data.activeFeatureKeys).toEqual(["orders", "products"]);
    expect(data.featureFlags).toEqual([{ featureKey: "products", enabled: false }]);
    expect(data.addOnFeatureKeys).toEqual(["inventory"]);
    expect(data.role).toBe("owner");
    expect(data.rolePermissionKeys).toEqual(["orders.read"]);
    expect(data.memberPermissions).toEqual([{ permissionKey: "orders.manage", granted: true }]);
    expect(data.featurePermissionEdges).toEqual([
      { featureKey: "orders", permissionKey: "orders.read" },
    ]);
  });

  it("returns empty role facts when the caller is not an active member", async () => {
    const repo = new AccessRepository(makeDb({ member: null }));
    const data = await repo.loadAccessData(USER, COMPANY);
    expect(data.role).toBeNull();
    expect(data.rolePermissionKeys).toEqual([]);
    expect(data.memberPermissions).toEqual([]);
  });
});

describe("PlatformAdminRepository.isPlatformAdmin", () => {
  it("is true when a grant row exists", async () => {
    const repo = new PlatformAdminRepository(makeDb({ platformAdmin: { id: "pa1" } }));
    expect(await repo.isPlatformAdmin(USER)).toBe(true);
  });

  it("is false when there is no grant row", async () => {
    const repo = new PlatformAdminRepository(makeDb({ platformAdmin: null }));
    expect(await repo.isPlatformAdmin(USER)).toBe(false);
  });
});
