import { describe, expect, it } from "vitest";
import { findResource, RESOURCE_NAMES, RESOURCES } from "./resource-registry";

describe("resource registry", () => {
  it("exposes the eight EPIC-7 resources", () => {
    expect(RESOURCE_NAMES).toEqual([
      "currencies",
      "country-configs",
      "governorates",
      "units",
      "product-categories",
      "order-labels",
      "order-reasons",
      "shipping-zones",
    ]);
  });

  it("finds a resource by name and misses unknowns", () => {
    expect(findResource("units")?.model).toBe("unit");
    expect(findResource("nope")).toBeUndefined();
  });

  it("has unique names and models", () => {
    expect(new Set(RESOURCES.map((r) => r.name)).size).toBe(RESOURCES.length);
    expect(new Set(RESOURCES.map((r) => r.model)).size).toBe(RESOURCES.length);
  });

  it("marks the three catalog tables system and the rest tenant", () => {
    const system = RESOURCES.filter((r) => r.scope === "system").map((r) => r.name);
    expect(system).toEqual(["currencies", "country-configs", "governorates"]);
  });

  it("every resource declares name as searchable and a default sort in its whitelist", () => {
    for (const r of RESOURCES) {
      expect(r.searchable).toContain("name");
      expect(r.sortWhitelist).toContain(r.defaultSort.replace(/^-/, ""));
    }
  });

  it("code-keyed resources provide a client id spec", () => {
    for (const r of RESOURCES) {
      if (r.clientProvidesId) expect(r.idSpec).toBeDefined();
    }
  });
});
