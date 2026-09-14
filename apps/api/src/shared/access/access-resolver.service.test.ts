import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../auth/authenticated-request";
import type { Clock } from "../time/clock";
import type { AccessRepositoryPort } from "./access-repository.port";
import { AccessResolverService } from "./access-resolver.service";
import { CapabilityCache } from "./capability-cache";
import type { AccessData } from "./capabilities";

const CLOCK: Clock = { now: () => 1_000 };

function emptyData(): AccessData {
  return {
    planFeatureKeys: ["orders"],
    activeFeatureKeys: ["orders"],
    featureFlags: [],
    addOnFeatureKeys: [],
    role: "owner",
    rolePermissionKeys: ["orders.read"],
    memberPermissions: [],
    featurePermissionEdges: [{ permissionKey: "orders.read", featureKey: "orders" }],
  };
}

function principal(companyId: string | null): RequestPrincipal {
  return { userId: "u1", sessionId: "s1", companyId };
}

describe("AccessResolverService", () => {
  it("returns empty capabilities with no DB read when there is no active tenant", async () => {
    const repo: AccessRepositoryPort = {
      loadAccessData: vi.fn(),
      loadCompanyMembersAccessData: vi.fn(),
    };
    const resolver = new AccessResolverService(repo, new CapabilityCache(CLOCK));
    const caps = await resolver.resolve(principal(null));
    expect(caps).toEqual({ features: [], permissions: [] });
    expect(repo.loadAccessData).not.toHaveBeenCalled();
  });

  it("resolves from the repository on a cache miss and caches the result", async () => {
    const load = vi.fn().mockResolvedValue(emptyData());
    const resolver = new AccessResolverService(
      { loadAccessData: load, loadCompanyMembersAccessData: vi.fn() },
      new CapabilityCache(CLOCK),
    );

    const first = await resolver.resolve(principal("c1"));
    expect(first.features).toEqual(["orders"]);
    expect(first.permissions).toEqual(["orders.read"]);
    expect(load).toHaveBeenCalledTimes(1);

    const second = await resolver.resolve(principal("c1"));
    expect(second).toEqual(first);
    expect(load).toHaveBeenCalledTimes(1); // served from cache
  });

  it("resolves each company member through the same rules as the guards", async () => {
    const base = emptyData();
    const loadMembers = vi.fn().mockResolvedValue([
      // Template grant, one override revoking it and one adding a gated permission
      // whose feature is not in the plan — both must disappear.
      {
        memberId: "m1",
        userId: "u1",
        data: {
          ...base,
          role: "store_manager",
          rolePermissionKeys: ["orders.read", "orders.manage"],
          memberPermissions: [
            { permissionKey: "orders.manage", granted: false },
            { permissionKey: "finance.read", granted: true },
          ],
          featurePermissionEdges: [
            ...base.featurePermissionEdges,
            { permissionKey: "orders.manage", featureKey: "orders" },
            { permissionKey: "finance.read", featureKey: "finance" },
          ],
        },
      },
      // A custom member has no template: only its granted overrides count.
      {
        memberId: "m2",
        userId: "u2",
        data: {
          ...base,
          role: "custom",
          rolePermissionKeys: [],
          memberPermissions: [{ permissionKey: "access.read", granted: true }],
        },
      },
    ]);
    const resolver = new AccessResolverService(
      { loadAccessData: vi.fn(), loadCompanyMembersAccessData: loadMembers },
      new CapabilityCache(CLOCK),
    );

    const members = await resolver.resolveCompanyMembers("c1");
    expect(loadMembers).toHaveBeenCalledWith("c1");
    expect(members).toEqual([
      { memberId: "m1", userId: "u1", role: "store_manager", permissions: ["orders.read"] },
      { memberId: "m2", userId: "u2", role: "custom", permissions: ["access.read"] },
    ]);
  });
});
