import { describe, expect, it } from "vitest";
import { type AccessData, can, resolveCapabilities } from "./capabilities";

/** A baseline access-data fixture; tests override the parts they exercise. */
function data(overrides: Partial<AccessData> = {}): AccessData {
  return {
    planFeatureKeys: ["orders", "products"],
    activeFeatureKeys: ["orders", "products", "inventory", "finance", "analytics"],
    featureFlags: [],
    addOnFeatureKeys: [],
    role: "owner",
    rolePermissionKeys: ["orders.read", "orders.manage", "products.read"],
    memberPermissions: [],
    featurePermissionEdges: [
      { permissionKey: "orders.read", featureKey: "orders" },
      { permissionKey: "orders.manage", featureKey: "orders" },
      { permissionKey: "products.read", featureKey: "products" },
      { permissionKey: "inventory.read", featureKey: "inventory" },
    ],
    ...overrides,
  };
}

describe("resolveCapabilities — features (Subscription ∧ Feature-Flag)", () => {
  it("starts from the plan's features", () => {
    expect(resolveCapabilities(data()).features).toEqual(["orders", "products"]);
  });

  it("adds add-ons beyond the plan", () => {
    expect(resolveCapabilities(data({ addOnFeatureKeys: ["inventory"] })).features).toEqual([
      "inventory",
      "orders",
      "products",
    ]);
  });

  it("a per-company flag enables a feature the plan omits", () => {
    const result = resolveCapabilities(
      data({ featureFlags: [{ featureKey: "finance", enabled: true }] }),
    );
    expect(result.features).toContain("finance");
  });

  it("a per-company flag disables a feature the plan includes", () => {
    const result = resolveCapabilities(
      data({ featureFlags: [{ featureKey: "orders", enabled: false }] }),
    );
    expect(result.features).not.toContain("orders");
  });

  it("a globally-inactive feature is never effective, even via plan/add-on/flag", () => {
    const result = resolveCapabilities(
      data({
        planFeatureKeys: ["orders"],
        addOnFeatureKeys: ["inventory"],
        featureFlags: [{ featureKey: "finance", enabled: true }],
        activeFeatureKeys: ["orders"], // inventory + finance are globally off
      }),
    );
    expect(result.features).toEqual(["orders"]);
  });
});

describe("resolveCapabilities — permissions (Permission layer)", () => {
  it("grants the role template's permissions", () => {
    expect(resolveCapabilities(data()).permissions).toEqual([
      "orders.manage",
      "orders.read",
      "products.read",
    ]);
  });

  it("a member override can grant an extra permission", () => {
    const result = resolveCapabilities(
      data({
        planFeatureKeys: ["orders", "products", "inventory"],
        memberPermissions: [{ permissionKey: "inventory.read", granted: true }],
      }),
    );
    expect(result.permissions).toContain("inventory.read");
  });

  it("a member override can revoke a template permission", () => {
    const result = resolveCapabilities(
      data({ memberPermissions: [{ permissionKey: "orders.manage", granted: false }] }),
    );
    expect(result.permissions).not.toContain("orders.manage");
  });

  it("drops a permission whose gating feature is not effective", () => {
    // products is not in the plan here, so products.read must be gated out.
    const result = resolveCapabilities(data({ planFeatureKeys: ["orders"] }));
    expect(result.permissions).toEqual(["orders.manage", "orders.read"]);
  });

  it("keeps a feature-independent permission (no gating edge)", () => {
    const result = resolveCapabilities(
      data({
        rolePermissionKeys: ["access.read"],
        planFeatureKeys: [],
      }),
    );
    expect(result.permissions).toEqual(["access.read"]);
  });

  it("has no capabilities when the member is not found (role null)", () => {
    const result = resolveCapabilities(data({ role: null, rolePermissionKeys: [] }));
    expect(result.permissions).toEqual([]);
  });
});

describe("can — the triple check", () => {
  const caps = { features: ["orders"], permissions: ["orders.read"] };

  it("passes when both feature and permission are held", () => {
    expect(can(caps, { feature: "orders", permission: "orders.read" })).toBe(true);
  });

  it("fails when the feature is missing (Feature layer)", () => {
    expect(can(caps, { feature: "finance", permission: "orders.read" })).toBe(false);
  });

  it("fails when the permission is missing (Permission layer)", () => {
    expect(can(caps, { feature: "orders", permission: "orders.manage" })).toBe(false);
  });

  it("checks only what is required", () => {
    expect(can(caps, { feature: "orders" })).toBe(true);
    expect(can(caps, { permission: "orders.read" })).toBe(true);
    expect(can(caps, {})).toBe(true);
  });
});
