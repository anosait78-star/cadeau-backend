import { describe, expect, it } from "vitest";
import { parseListQuery } from "./list-query";
import { findResource } from "./resource-registry";
import type { ResourceDescriptor } from "./resource.types";

function resource(name: string): ResourceDescriptor {
  const descriptor = findResource(name);
  if (descriptor === undefined) throw new Error(`missing test resource ${name}`);
  return descriptor;
}

describe("parseListQuery", () => {
  it("defaults sort and active-only", () => {
    const { query, errors } = parseListQuery(resource("order-labels"), { filters: {} });
    expect(errors).toEqual([]);
    expect(query?.sort).toEqual({ field: "name", dir: "asc" });
    expect(query?.active).toBe(true);
  });

  it("parses a descending sort", () => {
    const { query } = parseListQuery(resource("order-labels"), { sort: "-createdAt", filters: {} });
    expect(query?.sort).toEqual({ field: "createdAt", dir: "desc" });
  });

  it("rejects an unwhitelisted sort field", () => {
    const { query, errors } = parseListQuery(resource("order-labels"), {
      sort: "color",
      filters: {},
    });
    expect(query).toBeUndefined();
    expect(errors[0]?.field).toBe("sort");
  });

  it("parses the active tri-state", () => {
    expect(
      parseListQuery(resource("order-labels"), { active: "false", filters: {} }).query?.active,
    ).toBe(false);
    expect(
      parseListQuery(resource("order-labels"), { active: "all", filters: {} }).query?.active,
    ).toBe("all");
    expect(
      parseListQuery(resource("order-labels"), { active: "maybe", filters: {} }).errors[0]?.field,
    ).toBe("active");
  });

  it("accepts a declared enum filter and rejects a bad value", () => {
    const ok = parseListQuery(resource("order-reasons"), { filters: { kind: "return" } });
    expect(ok.errors).toEqual([]);
    expect(ok.query?.filters).toEqual({ kind: "return" });
    const bad = parseListQuery(resource("order-reasons"), { filters: { kind: "nope" } });
    expect(bad.query).toBeUndefined();
    expect(bad.errors[0]?.field).toBe("kind");
  });

  it("rejects an unknown filter", () => {
    const { query, errors } = parseListQuery(resource("order-labels"), {
      filters: { color: "red" },
    });
    expect(query).toBeUndefined();
    expect(errors[0]).toEqual({ field: "color", messages: ["unknown filter color"] });
  });

  it("passes through limit, cursor, and trimmed q", () => {
    const { query } = parseListQuery(resource("order-labels"), {
      limit: "50",
      cursor: "abc",
      q: "  vip  ",
      filters: {},
    });
    expect(query?.limit).toBe(50);
    expect(query?.cursor).toBe("abc");
    expect(query?.q).toBe("vip");
  });
});
