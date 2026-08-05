/**
 * CSV rendering for `POST /v1/analytics/export` (EPIC-14, M14.3, D5). Pure
 * formatting over already-computed view objects — no I/O. One row per
 * computed metric, axis-specific columns; fields are minimally escaped
 * (wrapped in quotes with internal quotes doubled) per RFC 4180.
 */
import type {
  BusinessSummary,
  InventorySummary,
  ProductPerformanceRow,
  ProfitabilitySummary,
  StaffPerformanceRow,
} from "./analytics.entity";

function escapeCsvField(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Render the business axis as CSV: one summary row plus the sparkline series. */
export function businessSummaryToCsv(summary: BusinessSummary): string {
  const summaryHeader = [
    "metric",
    "orderCount",
    "collectedMinor",
    "averageOrderValueMinor",
    "orderCountDeltaPct",
    "collectedDeltaPct",
  ];
  const summaryRow: (string | number)[] = [
    "summary",
    summary.orderCount,
    summary.collectedMinor,
    summary.averageOrderValueMinor,
    summary.orderCountDeltaPct ?? "",
    summary.collectedDeltaPct ?? "",
  ];
  const seriesHeader = ["bucket", "orderCount", "collectedMinor"];
  const seriesRows = summary.series.map((point) => [
    point.bucket,
    point.orderCount,
    point.collectedMinor,
  ]);
  return toCsv(summaryHeader, [summaryRow]) + "\r\n" + toCsv(seriesHeader, seriesRows);
}

/** Render the products axis as CSV: top rows then bottom rows, labeled. */
export function productsRowsToCsv(rows: {
  readonly top: readonly ProductPerformanceRow[];
  readonly bottom: readonly ProductPerformanceRow[];
}): string {
  const header = ["rank", "variantId", "productName", "variantName", "unitsSold", "revenueMinor"];
  const body: (string | number)[][] = [
    ...rows.top.map((r) => [
      "top",
      r.variantId,
      r.productName,
      r.variantName,
      r.unitsSold,
      r.revenueMinor,
    ]),
    ...rows.bottom.map((r) => [
      "bottom",
      r.variantId,
      r.productName,
      r.variantName,
      r.unitsSold,
      r.revenueMinor,
    ]),
  ];
  return toCsv(header, body);
}

/** Render the inventory axis as CSV: one summary row. */
export function inventorySummaryToCsv(summary: InventorySummary): string {
  const header = ["onHandValueMinor", "lowStockCount", "outOfStockCount", "turnoverSignal"];
  return toCsv(header, [
    [
      summary.onHandValueMinor,
      summary.lowStockCount,
      summary.outOfStockCount,
      summary.turnoverSignal ?? "",
    ],
  ]);
}

/** Render the staff axis as CSV: one row per staff member. */
export function staffRowsToCsv(rows: readonly StaffPerformanceRow[]): string {
  const header = ["assigneeId", "assigneeName", "orderCount", "collectedMinor"];
  return toCsv(
    header,
    rows.map((r) => [r.assigneeId ?? "", r.assigneeName, r.orderCount, r.collectedMinor]),
  );
}

/** Render the profitability axis as CSV: current + previous period rows. */
export function profitabilitySummaryToCsv(summary: ProfitabilitySummary): string {
  const header = ["period", "collectedMinor", "cogsMinor", "expensesMinor", "netIncomeMinor"];
  return toCsv(header, [
    [
      "current",
      summary.current.collectedMinor,
      summary.current.cogsMinor,
      summary.current.expensesMinor,
      summary.current.netIncomeMinor,
    ],
    [
      "previous",
      summary.previous.collectedMinor,
      summary.previous.cogsMinor,
      summary.previous.expensesMinor,
      summary.previous.netIncomeMinor,
    ],
  ]);
}
