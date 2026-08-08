import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { AccessResolverService } from "../../../shared/access/access-resolver.service";
import { CapabilityCache } from "../../../shared/access/capability-cache";
import type { PlatformAdminRepositoryPort } from "../../../shared/access/access-repository.port";
import type { EventBusPort } from "../../../shared/events/event-bus.port";
import type { AccessAuditPort } from "../domain/access-audit.port";
import type {
  AccessManagementRepositoryPort,
  AssignMemberPermissionsResult,
} from "../domain/access-management.port";
import { AccessService } from "./access.service";

const PRINCIPAL: RequestPrincipal = { userId: "u1", sessionId: "s1", companyId: "c1" };

function build(overrides: {
  resolve?: () => Promise<{ features: string[]; permissions: string[] }>;
  isSuperAdmin?: boolean;
  repo?: Partial<AccessManagementRepositoryPort>;
}): {
  service: AccessService;
  audit: AccessAuditPort;
  events: EventBusPort;
  cache: CapabilityCache;
} {
  const resolver = {
    resolve: vi.fn(overrides.resolve ?? (() => Promise.resolve({ features: [], permissions: [] }))),
  } as unknown as AccessResolverService;
  const platformAdmins: PlatformAdminRepositoryPort = {
    isPlatformAdmin: vi.fn().mockResolvedValue(overrides.isSuperAdmin ?? false),
  };
  const repo = {
    listFeatureCatalog: vi.fn().mockResolvedValue([]),
    listPermissionTemplates: vi.fn().mockResolvedValue([]),
    listAvailablePermissions: vi.fn().mockResolvedValue([]),
    listTemplateKeys: vi.fn().mockResolvedValue(["owner", "store_manager"]),
    findMember: vi.fn().mockResolvedValue({ id: "m1", userId: "u2", role: "member" }),
    assignMemberPermissions: vi.fn(),
    ...overrides.repo,
  } as unknown as AccessManagementRepositoryPort;
  const audit: AccessAuditPort = { record: vi.fn().mockResolvedValue(undefined) };
  const events: EventBusPort = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
  };
  const cache = new CapabilityCache({ now: () => 0 });
  return {
    service: new AccessService(
      resolver,
      platformAdmins,
      repo,
      audit,
      events,
      { now: () => 42 },
      cache,
    ),
    audit,
    events,
    cache,
  };
}

describe("AccessService.getCapabilities", () => {
  it("merges resolved capabilities with the super-admin flag and tenant", async () => {
    const { service } = build({
      resolve: () => Promise.resolve({ features: ["orders"], permissions: ["orders.read"] }),
      isSuperAdmin: true,
    });
    const view = await service.getCapabilities(PRINCIPAL);
    expect(view).toEqual({
      features: ["orders"],
      permissions: ["orders.read"],
      isSuperAdmin: true,
      activeCompanyId: "c1",
    });
  });
});

describe("AccessService.listFeatures", () => {
  it("annotates the catalog with the company's effective features", async () => {
    const { service } = build({
      resolve: () => Promise.resolve({ features: ["orders"], permissions: [] }),
      repo: {
        listFeatureCatalog: vi.fn().mockResolvedValue([
          { key: "orders", name: "Orders", category: "operations", isActive: true },
          { key: "finance", name: "Finance", category: "finance", isActive: true },
        ]),
      },
    });
    const features = await service.listFeatures(PRINCIPAL);
    expect(features).toEqual([
      { key: "orders", name: "Orders", category: "operations", enabled: true },
      { key: "finance", name: "Finance", category: "finance", enabled: false },
    ]);
  });
});

describe("AccessService.listAvailablePermissions", () => {
  it("delegates to the repo scoped to the caller's active company", async () => {
    const { service } = build({
      repo: {
        listAvailablePermissions: vi
          .fn()
          .mockResolvedValue([{ key: "orders.read", description: null, featureKey: "orders" }]),
      },
    });
    const result = await service.listAvailablePermissions(PRINCIPAL);
    expect(result).toEqual([{ key: "orders.read", description: null, featureKey: "orders" }]);
  });

  it("403s when the caller has no active company", async () => {
    const { service } = build({});
    await expect(
      service.listAvailablePermissions({ ...PRINCIPAL, companyId: null }),
    ).rejects.toBeInstanceOf(AppException);
  });
});

describe("AccessService.assignMemberPermissions", () => {
  const result: AssignMemberPermissionsResult = {
    before: { role: "member", overrides: [] },
    after: { role: "store_manager", overrides: [{ key: "orders.manage", granted: true }] },
    memberUserId: "u2",
  };

  it("rejects an empty assignment", async () => {
    const { service } = build({});
    await expect(service.assignMemberPermissions(PRINCIPAL, "m1", {})).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it("rejects an unknown template", async () => {
    const { service } = build({});
    await expect(
      service.assignMemberPermissions(PRINCIPAL, "m1", { templateKey: "wizard" }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("404s when the member does not exist", async () => {
    const { service } = build({ repo: { findMember: vi.fn().mockResolvedValue(null) } });
    await expect(
      service.assignMemberPermissions(PRINCIPAL, "m1", { templateKey: "owner" }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it("assigns, audits, and invalidates the member's cache", async () => {
    const assign = vi.fn().mockResolvedValue(result);
    const { service, audit, events, cache } = build({ repo: { assignMemberPermissions: assign } });
    const invalidate = vi.spyOn(cache, "invalidateMember");

    const after = await service.assignMemberPermissions(PRINCIPAL, "m1", {
      templateKey: "store_manager",
      overrides: [{ key: "orders.manage", granted: true }],
    });

    expect(after).toEqual(result.after);
    expect(assign).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "access.permissions_changed", companyId: "c1" }),
    );
    expect(invalidate).toHaveBeenCalledWith("c1", "u2");
    expect(events.publish).toHaveBeenCalledWith({
      type: "access.permissions_changed",
      companyId: "c1",
      actorId: "u1",
      occurredAt: 42,
      payload: { memberId: "m1", memberUserId: "u2", templateKey: "store_manager" },
    });
  });

  it("forbids assignment without an active tenant", async () => {
    const { service } = build({});
    await expect(
      service.assignMemberPermissions({ ...PRINCIPAL, companyId: null }, "m1", {
        templateKey: "owner",
      }),
    ).rejects.toBeInstanceOf(AppException);
  });
});
