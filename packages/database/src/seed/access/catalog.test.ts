import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_KEYS, FEATURES, PERMISSIONS, PLANS, TEMPLATES } from "./catalog";

const featureKeys = new Set(FEATURES.map((f) => f.key));
const permissionKeys = new Set(PERMISSIONS.map((p) => p.key));

describe("access catalog integrity", () => {
  it("has unique feature, permission, plan, and template keys", () => {
    expect(featureKeys.size).toBe(FEATURES.length);
    expect(permissionKeys.size).toBe(PERMISSIONS.length);
    expect(new Set(PLANS.map((p) => p.code)).size).toBe(PLANS.length);
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(TEMPLATES.length);
  });

  it("gates every non-core permission by a real feature", () => {
    for (const p of PERMISSIONS) {
      if (p.feature === null) {
        expect(p.key.startsWith("access.")).toBe(true);
      } else {
        expect(featureKeys.has(p.feature)).toBe(true);
      }
    }
  });

  it("references only real features from every plan", () => {
    for (const plan of PLANS) {
      for (const feature of plan.features) {
        expect(featureKeys.has(feature)).toBe(true);
      }
    }
  });

  it("references only real permissions from every template", () => {
    for (const t of TEMPLATES) {
      for (const permission of t.permissions) {
        expect(permissionKeys.has(permission)).toBe(true);
      }
    }
  });

  it("grants the Owner template every permission", () => {
    const owner = TEMPLATES.find((t) => t.key === "owner");
    expect(owner).toBeDefined();
    expect(new Set(owner?.permissions)).toEqual(new Set(ALL_PERMISSION_KEYS));
  });

  it("defines the six required system templates", () => {
    expect(TEMPLATES.map((t) => t.key).sort()).toEqual(
      ["call_center", "finance", "marketing", "owner", "store_manager", "warehouse"].sort(),
    );
  });

  it("ships the AI feature inactive (ADR-004)", () => {
    expect(FEATURES.find((f) => f.key === "ai")?.active).toBe(false);
  });
});
