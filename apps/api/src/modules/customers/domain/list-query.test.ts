import { describe, expect, it } from "vitest";
import { parseCustomerListQuery } from "./list-query";

describe("parseCustomerListQuery — defaults", () => {
  it("defaults to newest-first, active-only, no search", () => {
    const { query, errors } = parseCustomerListQuery({});
    expect(errors).toEqual([]);
    expect(query?.sort).toEqual({ field: "createdAt", dir: "desc" });
    expect(query?.active).toBe(true);
    expect(query?.search).toBeUndefined();
  });
});

describe("parseCustomerListQuery — sort", () => {
  it("accepts the whitelist in both directions", () => {
    expect(parseCustomerListQuery({ sort: "name" }).query?.sort).toEqual({
      field: "name",
      dir: "asc",
    });
    expect(parseCustomerListQuery({ sort: "-name" }).query?.sort).toEqual({
      field: "name",
      dir: "desc",
    });
  });

  it("rejects a field outside the whitelist", () => {
    const { query, errors } = parseCustomerListQuery({ sort: "totalSpent" });
    expect(query).toBeUndefined();
    expect(errors[0]?.field).toBe("sort");
  });
});

describe("parseCustomerListQuery — active", () => {
  it("parses the tri-state", () => {
    expect(parseCustomerListQuery({ active: "true" }).query?.active).toBe(true);
    expect(parseCustomerListQuery({ active: "false" }).query?.active).toBe(false);
    expect(parseCustomerListQuery({ active: "all" }).query?.active).toBe("all");
  });

  it("rejects anything else", () => {
    expect(parseCustomerListQuery({ active: "yes" }).errors[0]?.field).toBe("active");
  });
});

describe("parseCustomerListQuery — q routing", () => {
  it("routes an E.164 term to an exact phone lookup, normalized", () => {
    const { query } = parseCustomerListQuery({ q: "+20 100 123 4567" });
    expect(query?.search).toEqual({ kind: "phone", e164: "+201001234567" });
  });

  it("routes the 00-prefixed form to the same normalized number", () => {
    const { query } = parseCustomerListQuery({ q: "00201001234567" });
    expect(query?.search).toEqual({ kind: "phone", e164: "+201001234567" });
  });

  it("routes a name to a text search", () => {
    expect(parseCustomerListQuery({ q: "Ahmed" }).query?.search).toEqual({
      kind: "text",
      term: "Ahmed",
    });
  });

  it("treats a partial phone as text, not as a phone lookup", () => {
    // A blind index cannot answer "ends with 4567", so the term falls through to
    // the name/email search rather than silently matching nothing.
    expect(parseCustomerListQuery({ q: "4567" }).query?.search).toEqual({
      kind: "text",
      term: "4567",
    });
  });

  it("treats a bare national number as text (country is unknowable)", () => {
    expect(parseCustomerListQuery({ q: "01001234567" }).query?.search).toEqual({
      kind: "text",
      term: "01001234567",
    });
  });

  it("ignores an empty or whitespace-only term", () => {
    expect(parseCustomerListQuery({ q: "" }).query?.search).toBeUndefined();
    expect(parseCustomerListQuery({ q: "   " }).query?.search).toBeUndefined();
  });

  it("trims a text term", () => {
    expect(parseCustomerListQuery({ q: "  Ahmed  " }).query?.search).toEqual({
      kind: "text",
      term: "Ahmed",
    });
  });
});

describe("parseCustomerListQuery — filters", () => {
  it("accepts a uuid governorateId", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(parseCustomerListQuery({ governorateId: id }).query?.governorateId).toBe(id);
  });

  it("rejects a non-uuid governorateId", () => {
    expect(parseCustomerListQuery({ governorateId: "cairo" }).errors[0]?.field).toBe(
      "governorateId",
    );
  });

  it("normalizes the created-at bounds to ISO-8601", () => {
    const { query } = parseCustomerListQuery({
      createdAtFrom: "2026-01-01",
      createdAtTo: "2026-02-01T12:00:00Z",
    });
    expect(query?.createdAtFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(query?.createdAtTo).toBe("2026-02-01T12:00:00.000Z");
  });

  it("rejects an unparseable date bound", () => {
    const { errors } = parseCustomerListQuery({ createdAtFrom: "last tuesday" });
    expect(errors[0]?.field).toBe("createdAtFrom");
  });

  it("aggregates multiple errors instead of failing on the first", () => {
    const { query, errors } = parseCustomerListQuery({
      sort: "nope",
      active: "maybe",
      governorateId: "x",
    });
    expect(query).toBeUndefined();
    expect(errors.map((e) => e.field).sort()).toEqual(["active", "governorateId", "sort"]);
  });
});

describe("parseCustomerListQuery — passthrough", () => {
  it("carries limit and cursor through untouched", () => {
    const { query } = parseCustomerListQuery({ limit: "50", cursor: "abc" });
    expect(query?.limit).toBe(50);
    expect(query?.cursor).toBe("abc");
  });
});
