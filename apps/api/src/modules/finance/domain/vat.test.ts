/**
 * Exhaustive round-half-up coverage for {@link computeVatMinor} (EPIC-13,
 * M13.4, D3). Pure integer/BigInt arithmetic — no floats, per
 * api-conventions §12.1.
 */
import { describe, expect, it } from "vitest";
import { computeVatMinor } from "./vat";

describe("computeVatMinor", () => {
  it("computes a clean 14% VAT with no rounding needed", () => {
    expect(computeVatMinor(10000n, 1400)).toBe(1400n);
  });

  it("computes 0% VAT as zero", () => {
    expect(computeVatMinor(123456n, 0)).toBe(0n);
  });

  it("computes 100% VAT as the full subtotal", () => {
    expect(computeVatMinor(5000n, 10000)).toBe(5000n);
  });

  it("rounds exactly half up (.5 boundary)", () => {
    // 100 * 0.05% would be 0.05 -> half up to 1: use a rate/amount pair that
    // lands precisely on x.5 minor units. 1 * 500bps / 10000 = 0.05 -> not
    // exact half; pick 100 * 250bps / 10000 = 2.5 -> rounds to 3.
    expect(computeVatMinor(100n, 250)).toBe(3n);
  });

  it("rounds .5 up even for larger amounts", () => {
    // 50 * 100bps / 10000 = 0.5 -> rounds up to 1.
    expect(computeVatMinor(50n, 100)).toBe(1n);
  });

  it("rounds down when below the half boundary", () => {
    // 149 * 100bps / 10000 = 1.49 -> rounds down to 1.
    expect(computeVatMinor(149n, 100)).toBe(1n);
  });

  it("rounds up when above the half boundary", () => {
    // 151 * 100bps / 10000 = 1.51 -> rounds up to 2.
    expect(computeVatMinor(151n, 100)).toBe(2n);
  });

  it("handles a large subtotal with a realistic VAT rate", () => {
    // 987654321 minor units at 14% = 138271604.94 -> rounds up to 138271605.
    expect(computeVatMinor(987654321n, 1400)).toBe(138271605n);
  });

  it("returns zero VAT on a zero subtotal", () => {
    expect(computeVatMinor(0n, 1400)).toBe(0n);
  });
});
