import { describe, expect, it } from "vitest";
import { formatMoney } from "./format-money";

describe("formatMoney", () => {
  it("renders minor units as a 2-decimal amount", () => {
    expect(formatMoney(12345, "en-US")).toBe("123.45");
  });

  it("pads whole amounts to 2 decimals", () => {
    expect(formatMoney(100, "en-US")).toBe("1.00");
  });

  it("respects the given locale's grouping/decimal separators", () => {
    expect(formatMoney(123456, "de-DE")).toBe("1.234,56");
  });

  it("handles negative amounts", () => {
    expect(formatMoney(-500, "en-US")).toBe("-5.00");
  });
});
