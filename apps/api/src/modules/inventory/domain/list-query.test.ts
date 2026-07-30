import { describe, expect, it } from "vitest";
import { parseStockListQuery, parseWarehouseListQuery } from "./list-query";

describe("parseWarehouseListQuery", () => {
  it("defaults to newest-first, active-only", () => {
    const { query, errors } = parseWarehouseListQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({ sort: { field: "createdAt", dir: "desc" }, active: true });
  });

  it("accepts an ascending whitelisted sort", () => {
    expect(parseWarehouseListQuery({ sort: "name" }).query?.sort).toEqual({
      field: "name",
      dir: "asc",
    });
  });

  it("rejects a sort field outside the whitelist", () => {
    const { query, errors } = parseWarehouseListQuery({ sort: "-code" });
    expect(query).toBeUndefined();
    expect(errors[0]?.field).toBe("sort");
  });

  it("parses the active tri-state and rejects anything else", () => {
    expect(parseWarehouseListQuery({ active: "false" }).query?.active).toBe(false);
    expect(parseWarehouseListQuery({ active: "all" }).query?.active).toBe("all");
    expect(parseWarehouseListQuery({ active: "yes" }).errors[0]?.field).toBe("active");
  });

  it("trims a search term and drops it when empty", () => {
    expect(parseWarehouseListQuery({ q: "  main  " }).query?.q).toBe("main");
    expect(parseWarehouseListQuery({ q: "   " }).query).not.toHaveProperty("q");
  });

  it("passes limit and cursor through", () => {
    const { query } = parseWarehouseListQuery({ limit: "10", cursor: "abc" });
    expect(query?.limit).toBe(10);
    expect(query?.cursor).toBe("abc");
  });
});

describe("parseStockListQuery", () => {
  const WAREHOUSE = "11111111-1111-1111-1111-111111111111";

  it("defaults to most-recently-changed first, no low-stock filter", () => {
    const { query, errors } = parseStockListQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({ sort: { field: "updatedAt", dir: "desc" }, belowReorder: false });
  });

  it("accepts sorting by available ascending", () => {
    expect(parseStockListQuery({ sort: "available" }).query?.sort).toEqual({
      field: "available",
      dir: "asc",
    });
  });

  it("rejects a sort field outside the whitelist", () => {
    expect(parseStockListQuery({ sort: "onHand" }).errors[0]?.field).toBe("sort");
  });

  it("parses the belowReorder flag strictly", () => {
    expect(parseStockListQuery({ belowReorder: "true" }).query?.belowReorder).toBe(true);
    expect(parseStockListQuery({ belowReorder: "1" }).errors[0]?.field).toBe("belowReorder");
  });

  it("accepts uuid filters and rejects malformed ones", () => {
    expect(parseStockListQuery({ warehouseId: WAREHOUSE }).query?.warehouseId).toBe(WAREHOUSE);
    const { errors } = parseStockListQuery({ warehouseId: "nope", variantId: "also-nope" });
    expect(errors.map((e) => e.field)).toEqual(["warehouseId", "variantId"]);
  });

  it("reports every problem at once", () => {
    const { query, errors } = parseStockListQuery({ sort: "bogus", belowReorder: "maybe" });
    expect(query).toBeUndefined();
    expect(errors.map((e) => e.field)).toEqual(["sort", "belowReorder"]);
  });
});
