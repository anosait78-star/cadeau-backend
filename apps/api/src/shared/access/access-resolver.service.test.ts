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
    const repo: AccessRepositoryPort = { loadAccessData: vi.fn() };
    const resolver = new AccessResolverService(repo, new CapabilityCache(CLOCK));
    const caps = await resolver.resolve(principal(null));
    expect(caps).toEqual({ features: [], permissions: [] });
    expect(repo.loadAccessData).not.toHaveBeenCalled();
  });

  it("resolves from the repository on a cache miss and caches the result", async () => {
    const load = vi.fn().mockResolvedValue(emptyData());
    const resolver = new AccessResolverService(
      { loadAccessData: load },
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
});
