import { describe, expect, it } from "vitest";
import { MAX_SEARCH_LENGTH, parseVariantSearchQuery } from "./variant-search-query";

describe("parseVariantSearchQuery", () => {
  it("defaults to the head of the catalogue with no filters", () => {
    const { query, errors } = parseVariantSearchQuery({});
    expect(errors).toEqual([]);
    expect(query).toEqual({ hasStock: false });
  });

  it("keeps a real search term", () => {
    expect(parseVariantSearchQuery({ q: "قميص" }).query).toMatchObject({ q: "قميص" });
  });

  it("trims the term", () => {
    expect(parseVariantSearchQuery({ q: "  قميص  " }).query).toMatchObject({ q: "قميص" });
  });

  // An untouched search box is not a search for the empty string.
  it("treats a blank term as no search at all", () => {
    expect(parseVariantSearchQuery({ q: "   " }).query?.q).toBeUndefined();
    expect(parseVariantSearchQuery({ q: "" }).query?.q).toBeUndefined();
  });

  it("caps a pasted term instead of passing it through", () => {
    const parsed = parseVariantSearchQuery({ q: "a".repeat(MAX_SEARCH_LENGTH + 50) });
    expect(parsed.query?.q).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it("passes limit and cursor through", () => {
    expect(parseVariantSearchQuery({ limit: "50", cursor: "abc" }).query).toMatchObject({
      limit: 50,
      cursor: "abc",
    });
  });

  it("reads hasStock as a boolean", () => {
    expect(parseVariantSearchQuery({ hasStock: "true" }).query?.hasStock).toBe(true);
    expect(parseVariantSearchQuery({ hasStock: "false" }).query?.hasStock).toBe(false);
  });

  it("rejects a hasStock that is neither", () => {
    const { errors } = parseVariantSearchQuery({ hasStock: "yes" });
    expect(errors).toEqual([{ field: "hasStock", messages: ["hasStock must be true or false"] }]);
  });

  it("accepts a warehouse id", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(parseVariantSearchQuery({ warehouseId: id }).query?.warehouseId).toBe(id);
  });

  // It reaches a query filter, so it is validated here rather than trusted.
  it("rejects a warehouseId that is not a UUID", () => {
    const { query, errors } = parseVariantSearchQuery({ warehouseId: "' OR 1=1--" });
    expect(query).toBeUndefined();
    expect(errors[0]?.field).toBe("warehouseId");
  });

  it("reports every problem at once", () => {
    const { errors } = parseVariantSearchQuery({ warehouseId: "nope", hasStock: "maybe" });
    expect(errors.map((e) => e.field).sort()).toEqual(["hasStock", "warehouseId"]);
  });
});
