import { describe, expect, it } from "vitest";
import { buildQuery } from "./build-query";

describe("buildQuery", () => {
  it("returns an empty string when nothing is set", () => {
    expect(buildQuery({})).toBe("");
  });

  it("omits undefined values", () => {
    expect(buildQuery({ a: "1", b: undefined })).toBe("?a=1");
  });

  it("omits empty-string values", () => {
    expect(buildQuery({ a: "1", b: "" })).toBe("?a=1");
  });

  it("stringifies numbers and booleans", () => {
    expect(buildQuery({ limit: 25, active: true })).toBe("?limit=25&active=true");
  });

  it("prefixes with ? only when at least one param survives", () => {
    expect(buildQuery({ a: undefined, b: "" })).toBe("");
  });
});
