import { describe, expect, it } from "vitest";
import {
  computeBusinessSummary,
  computeInventorySummary,
  computeProductsSummary,
  computeProfitabilityPeriod,
  computeProfitabilitySummary,
  percentDelta,
  type ProductPerformanceRow,
} from "./analytics.entity";

describe("percentDelta", () => {
  it("computes a positive percentage change", () => {
    expect(percentDelta(120, 100)).toBe(20);
  });

  it("computes a negative percentage change", () => {
    expect(percentDelta(80, 100)).toBe(-20);
  });

  it("returns 0 when both current and previous are zero", () => {
    expect(percentDelta(0, 0)).toBe(0);
  });

  it("returns null when previous is zero but current is not (undefined ratio)", () => {
    expect(percentDelta(50, 0)).toBeNull();
  });
});

describe("computeBusinessSummary", () => {
  it("computes average order value and deltas from real aggregate facts", () => {
    const summary = computeBusinessSummary(
      {
        orderCount: 10,
        collectedMinor: 100000,
        previousOrderCount: 8,
        previousCollectedMinor: 80000,
        series: [{ bucket: "2026-01-01T00:00:00.000Z", orderCount: 10, collectedMinor: 100000 }],
      },
      "day",
    );
    expect(summary.averageOrderValueMinor).toBe(10000);
    expect(summary.orderCountDeltaPct).toBe(25);
    expect(summary.collectedDeltaPct).toBe(25);
    expect(summary.granularity).toBe("day");
    expect(summary.series).toHaveLength(1);
  });

  it("returns zero average order value with no orders (no division by zero)", () => {
    const summary = computeBusinessSummary(
      {
        orderCount: 0,
        collectedMinor: 0,
        previousOrderCount: 0,
        previousCollectedMinor: 0,
        series: [],
      },
      "month",
    );
    expect(summary.averageOrderValueMinor).toBe(0);
    expect(summary.orderCountDeltaPct).toBe(0);
  });
});

describe("computeProductsSummary", () => {
  const row = (id: string, revenue: number): ProductPerformanceRow => ({
    variantId: id,
    productName: `Product ${id}`,
    variantName: "Default",
    unitsSold: revenue / 100,
    revenueMinor: revenue,
  });

  it("splits a revenue-descending list into non-overlapping top/bottom", () => {
    const rows = [
      row("a", 500),
      row("b", 400),
      row("c", 300),
      row("d", 200),
      row("e", 100),
      row("f", 50),
    ];
    const { top, bottom } = computeProductsSummary(rows, 3);
    expect(top.map((r) => r.variantId)).toEqual(["a", "b", "c"]);
    expect(bottom.map((r) => r.variantId)).toEqual(["f", "e", "d"]);
    const overlap = top.filter((t) => bottom.some((b) => b.variantId === t.variantId));
    expect(overlap).toEqual([]);
  });

  it("handles fewer rows than the limit without overlap or crashing", () => {
    const rows = [row("a", 500), row("b", 400)];
    const { top, bottom } = computeProductsSummary(rows, 5);
    expect(top).toHaveLength(2);
    expect(bottom).toHaveLength(0);
  });

  it("handles an empty list", () => {
    const { top, bottom } = computeProductsSummary([], 5);
    expect(top).toEqual([]);
    expect(bottom).toEqual([]);
  });
});

describe("computeInventorySummary", () => {
  it("computes a turnover signal from units sold vs on-hand", () => {
    const summary = computeInventorySummary({
      onHandValueMinor: 500000,
      lowStockCount: 2,
      outOfStockCount: 1,
      unitsSoldInWindow: 50,
      totalOnHandUnits: 200,
    });
    expect(summary.turnoverSignal).toBe(0.25);
    expect(summary.onHandValueMinor).toBe(500000);
  });

  it("returns null turnover signal when there is no on-hand stock (no division by zero)", () => {
    const summary = computeInventorySummary({
      onHandValueMinor: 0,
      lowStockCount: 0,
      outOfStockCount: 5,
      unitsSoldInWindow: 0,
      totalOnHandUnits: 0,
    });
    expect(summary.turnoverSignal).toBeNull();
  });
});

describe("computeProfitabilityPeriod / computeProfitabilitySummary", () => {
  it("computes net income on collected minus COGS minus expenses (D4)", () => {
    const period = computeProfitabilityPeriod({
      collectedMinor: 100000,
      cogsMinor: 40000,
      expensesMinor: 20000,
    });
    expect(period.netIncomeMinor).toBe(40000);
  });

  it("computes a full summary with a positive delta vs. the preceding window", () => {
    const summary = computeProfitabilitySummary(
      { collectedMinor: 100000, cogsMinor: 40000, expensesMinor: 20000 },
      { collectedMinor: 80000, cogsMinor: 30000, expensesMinor: 20000 },
    );
    expect(summary.current.netIncomeMinor).toBe(40000);
    expect(summary.previous.netIncomeMinor).toBe(30000);
    expect(summary.netIncomeDeltaPct).toBeCloseTo(33.33, 1);
  });

  it("returns a null delta when the preceding window's net income was zero", () => {
    const summary = computeProfitabilitySummary(
      { collectedMinor: 100000, cogsMinor: 40000, expensesMinor: 20000 },
      { collectedMinor: 0, cogsMinor: 0, expensesMinor: 0 },
    );
    expect(summary.netIncomeDeltaPct).toBeNull();
  });
});
