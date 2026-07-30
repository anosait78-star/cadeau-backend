import { describe, expect, it } from "vitest";
import { parseProductListQuery } from "./list-query";

const UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("parseProductListQuery", () => {
  it("defaults to active-only, -createdAt sort", () => {
    const { query, errors } = parseProductListQuery({});
    expect(errors).toEqual([]);
    expect(query).toMatchObject({ active: true, sort: { field: "createdAt", dir: "desc" } });
  });

  it("parses name ascending sort", () => {
    const { query } = parseProductListQuery({ sort: "name" });
    expect(query?.sort).toEqual({ field: "name", dir: "asc" });
  });

  it("parses -createdAt descending sort", () => {
    const { query } = parseProductListQuery({ sort: "-createdAt" });
    expect(query?.sort).toEqual({ field: "createdAt", dir: "desc" });
  });

  it("rejects a sort field outside the whitelist", () => {
    const { query, errors } = parseProductListQuery({ sort: "price" });
    expect(query).toBeUndefined();
    expect(errors[0]?.field).toBe("sort");
  });

  it("parses the active tri-state", () => {
    expect(parseProductListQuery({ active: "false" }).query?.active).toBe(false);
    expect(parseProductListQuery({ active: "all" }).query?.active).toBe("all");
  });

  it("rejects a bad active value", () => {
    const { errors } = parseProductListQuery({ active: "maybe" });
    expect(errors[0]?.field).toBe("active");
  });

  it("accepts a uuid categoryId filter", () => {
    const { query, errors } = parseProductListQuery({ categoryId: UUID });
    expect(errors).toEqual([]);
    expect(query?.categoryId).toBe(UUID);
  });

  it("rejects a non-uuid categoryId", () => {
    const { query, errors } = parseProductListQuery({ categoryId: "nope" });
    expect(query).toBeUndefined();
    expect(errors[0]?.field).toBe("categoryId");
  });

  it("trims and keeps a non-empty search q; drops a blank one", () => {
    expect(parseProductListQuery({ q: "  mug  " }).query?.q).toBe("mug");
    expect(parseProductListQuery({ q: "   " }).query?.q).toBeUndefined();
  });

  it("passes through limit and cursor", () => {
    const { query } = parseProductListQuery({ limit: "10", cursor: "abc" });
    expect(query?.limit).toBe(10);
    expect(query?.cursor).toBe("abc");
  });

  it("collects multiple errors at once", () => {
    const { errors } = parseProductListQuery({ sort: "x", active: "y" });
    expect(errors.map((e) => e.field).sort()).toEqual(["active", "sort"]);
  });
});
