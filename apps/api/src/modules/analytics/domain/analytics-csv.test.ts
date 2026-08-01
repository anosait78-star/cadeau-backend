import { describe, expect, it } from "vitest";
import {
  businessSummaryToCsv,
  inventorySummaryToCsv,
  productsRowsToCsv,
  profitabilitySummaryToCsv,
  staffRowsToCsv,
} from "./analytics-csv";
import type { BusinessSummary, ProfitabilitySummary } from "./analytics.entity";

const business: BusinessSummary = {
  orderCount: 10,
  collectedMinor: 100000,
  averageOrderValueMinor: 10000,
  orderCountDeltaPct: 25,
  collectedDeltaPct: null,
  series: [{ bucket: "2026-01-01T00:00:00.000Z", orderCount: 10, collectedMinor: 100000 }],
  granularity: "day",
};

describe("businessSummaryToCsv", () => {
  it("renders a header, a summary row, and the series rows", () => {
    const csv = businessSummaryToCsv(business);
    expect(csv).toContain("metric,orderCount,collectedMinor");
    expect(csv).toContain("summary,10,100000,10000,25,");
    expect(csv).toContain("bucket,orderCount,collectedMinor");
    expect(csv).toContain("2026-01-01T00:00:00.000Z,10,100000");
  });
});

describe("productsRowsToCsv", () => {
  it("labels top and bottom rows and escapes commas in names", () => {
    const csv = productsRowsToCsv({
      top: [
        {
          variantId: "v1",
          productName: 'Widget, Deluxe "Pro"',
          variantName: "Red",
          unitsSold: 5,
          revenueMinor: 5000,
        },
      ],
      bottom: [],
    });
    expect(csv).toContain("rank,variantId,productName,variantName,unitsSold,revenueMinor");
    expect(csv).toContain('top,v1,"Widget, Deluxe ""Pro""",Red,5,5000');
  });
});

describe("inventorySummaryToCsv", () => {
  it("renders one summary row", () => {
    const csv = inventorySummaryToCsv({
      onHandValueMinor: 500000,
      lowStockCount: 2,
      outOfStockCount: 1,
      turnoverSignal: 0.25,
    });
    expect(csv).toContain("onHandValueMinor,lowStockCount,outOfStockCount,turnoverSignal");
    expect(csv).toContain("500000,2,1,0.25");
  });

  it("renders an empty field for a null turnover signal", () => {
    const csv = inventorySummaryToCsv({
      onHandValueMinor: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      turnoverSignal: null,
    });
    expect(csv).toContain("0,0,0,\r\n");
  });
});

describe("staffRowsToCsv", () => {
  it("renders one row per staff member, unassigned as an empty id", () => {
    const csv = staffRowsToCsv([
      { assigneeId: "u1", assigneeName: "Amina", orderCount: 5, collectedMinor: 50000 },
      { assigneeId: null, assigneeName: "Unassigned", orderCount: 2, collectedMinor: 8000 },
    ]);
    expect(csv).toContain("u1,Amina,5,50000");
    expect(csv).toContain(",Unassigned,2,8000");
  });
});

describe("profitabilitySummaryToCsv", () => {
  it("renders current and previous period rows", () => {
    const summary: ProfitabilitySummary = {
      current: {
        collectedMinor: 100000,
        cogsMinor: 40000,
        expensesMinor: 20000,
        netIncomeMinor: 40000,
      },
      previous: {
        collectedMinor: 80000,
        cogsMinor: 30000,
        expensesMinor: 20000,
        netIncomeMinor: 30000,
      },
      netIncomeDeltaPct: 33.33,
    };
    const csv = profitabilitySummaryToCsv(summary);
    expect(csv).toContain("current,100000,40000,20000,40000");
    expect(csv).toContain("previous,80000,30000,20000,30000");
  });
});
