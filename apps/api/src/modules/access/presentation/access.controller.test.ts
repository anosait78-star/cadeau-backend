import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { AccessService } from "../application/access.service";
import { AccessController } from "./access.controller";

const PRINCIPAL: RequestPrincipal = { userId: "u1", sessionId: "s1", companyId: "c1" };

describe("AccessController", () => {
  it("maps capabilities to the DTO", async () => {
    const service = {
      getCapabilities: vi.fn().mockResolvedValue({
        features: ["orders"],
        permissions: ["orders.read"],
        isSuperAdmin: false,
        activeCompanyId: "c1",
      }),
    } as unknown as AccessService;
    const dto = await new AccessController(service).getCapabilities(PRINCIPAL);
    expect(dto).toEqual({
      features: ["orders"],
      permissions: ["orders.read"],
      isSuperAdmin: false,
      activeCompanyId: "c1",
    });
  });

  it("maps the features list to the envelope", async () => {
    const service = {
      listFeatures: vi
        .fn()
        .mockResolvedValue([{ key: "orders", name: "Orders", category: "ops", enabled: true }]),
    } as unknown as AccessService;
    const dto = await new AccessController(service).listFeatures(PRINCIPAL);
    expect(dto.data).toEqual([{ key: "orders", name: "Orders", category: "ops", enabled: true }]);
  });

  it("maps permission templates to the envelope", async () => {
    const service = {
      listPermissionTemplates: vi
        .fn()
        .mockResolvedValue([{ key: "owner", name: "Owner", description: null, permissions: [] }]),
    } as unknown as AccessService;
    const dto = await new AccessController(service).listPermissionTemplates();
    expect(dto.data[0]?.key).toBe("owner");
  });

  it("maps available permissions to the envelope", async () => {
    const service = {
      listAvailablePermissions: vi
        .fn()
        .mockResolvedValue([
          { key: "orders.read", description: "View orders", featureKey: "orders" },
        ]),
    } as unknown as AccessService;
    const dto = await new AccessController(service).listAvailablePermissions(PRINCIPAL);
    expect(dto.data).toEqual([
      { key: "orders.read", description: "View orders", featureKey: "orders" },
    ]);
  });

  it("forwards a member assignment and maps the result", async () => {
    const assign = vi.fn().mockResolvedValue({
      role: "store_manager",
      overrides: [{ key: "orders.manage", granted: true }],
    });
    const service = { assignMemberPermissions: assign } as unknown as AccessService;
    const dto = await new AccessController(service).assignMemberPermissions(PRINCIPAL, "m1", {
      templateKey: "store_manager",
      permissions: [{ key: "orders.manage", granted: true }],
    });
    expect(assign).toHaveBeenCalledWith(PRINCIPAL, "m1", {
      templateKey: "store_manager",
      overrides: [{ key: "orders.manage", granted: true }],
    });
    expect(dto.role).toBe("store_manager");
    expect(dto.overrides).toEqual([{ key: "orders.manage", granted: true }]);
  });

  it("omits absent assignment fields when forwarding", async () => {
    const assign = vi.fn().mockResolvedValue({ role: "owner", overrides: [] });
    const service = { assignMemberPermissions: assign } as unknown as AccessService;
    await new AccessController(service).assignMemberPermissions(PRINCIPAL, "m1", {
      templateKey: "owner",
    });
    expect(assign).toHaveBeenCalledWith(PRINCIPAL, "m1", { templateKey: "owner" });
  });
});
