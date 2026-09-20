/**
 * Pure view types + calculation functions for the five analytics axes
 * (EPIC-14, M14.2). Every function here is deterministic arithmetic over
 * numbers the repository already aggregated — no I/O, no framework, unit
 * testable without a database (ADR-0004: no AI/ML, no forecasting, just
 * real arithmetic over real rows).
 */
import type { Granularity } from "./analytics-query";

/** One bucketed point on a sparkline series. */
export interface SparklinePoint {
  readonly bucket: string;
  readonly orderCount: number;
  readonly collectedMinor: number;
  /** Orders placed in the bucket, at their full value — see `salesMinor`. */
  readonly salesMinor: number;
}

/** Raw aggregate facts the repository reads for the business axis. */
export interface BusinessRawFacts {
  readonly orderCount: number;
  readonly collectedMinor: number;
  readonly salesMinor: number;
  readonly previousOrderCount: number;
  readonly previousCollectedMinor: number;
  readonly previousSalesMinor: number;
  readonly series: readonly SparklinePoint[];
}

/** The computed business KPI summary. */
export interface BusinessSummary {
  readonly orderCount: number;
  readonly collectedMinor: number;
  /**
   * Expected revenue: every order placed in the window at its full total,
   * paid or not, excluding cancelled and returned orders. `collectedMinor` is
   * the money actually taken so far, so this is always the larger figure.
   */
  readonly salesMinor: number;
  readonly averageOrderValueMinor: number;
  readonly orderCountDeltaPct: number | null;
  readonly collectedDeltaPct: number | null;
  readonly salesDeltaPct: number | null;
  readonly series: readonly SparklinePoint[];
  readonly granularity: Granularity;
}

/** A signed percentage change from `previous` to `current`, or null when `previous` is 0. */
export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** Compute the business axis summary from raw aggregate facts. */
export function computeBusinessSummary(
  facts: BusinessRawFacts,
  granularity: Granularity,
): BusinessSummary {
  // Averaged over what the orders are worth, not what has been collected so
  // far, so it does not shrink just because an order has not been paid yet.
  const averageOrderValueMinor =
    facts.orderCount === 0 ? 0 : Math.round(facts.salesMinor / facts.orderCount);
  return {
    orderCount: facts.orderCount,
    collectedMinor: facts.collectedMinor,
    salesMinor: facts.salesMinor,
    averageOrderValueMinor,
    orderCountDeltaPct: percentDelta(facts.orderCount, facts.previousOrderCount),
    collectedDeltaPct: percentDelta(facts.collectedMinor, facts.previousCollectedMinor),
    salesDeltaPct: percentDelta(facts.salesMinor, facts.previousSalesMinor),
    series: facts.series,
    granularity,
  };
}

/** One variant's performance in the window. */
export interface ProductPerformanceRow {
  readonly variantId: string;
  readonly productId: string;
  /** The parent product's display image, when it has one. */
  readonly imageUrl: string | null;
  readonly productName: string;
  readonly variantName: string;
  readonly unitsSold: number;
  readonly revenueMinor: number;
}

/** Catalogue + sales headline numbers for one window. */
export interface ProductsTotals {
  /** Active products in the catalogue right now — a stock count, not a window figure. */
  readonly activeProducts: number;
  /** Products created inside the window. */
  readonly newProducts: number;
  /** Units sold in the window. */
  readonly unitsSold: number;
  readonly revenueMinor: number;
  /** Revenue ÷ units, in minor units; 0 when nothing sold. */
  readonly averagePriceMinor: number;
}

/** Raw catalogue/sales facts the repository reads for the products axis. */
export interface ProductsRawTotals {
  readonly activeProducts: number;
  readonly newProducts: number;
  readonly unitsSold: number;
  readonly revenueMinor: number;
}

/** Derive the products totals, filling in the average unit price. */
export function computeProductsTotals(facts: ProductsRawTotals): ProductsTotals {
  return {
    activeProducts: facts.activeProducts,
    newProducts: facts.newProducts,
    unitsSold: facts.unitsSold,
    revenueMinor: facts.revenueMinor,
    averagePriceMinor: facts.unitsSold === 0 ? 0 : Math.round(facts.revenueMinor / facts.unitsSold),
  };
}

/** Top and bottom performers by revenue in the window. */
export interface ProductsRanking {
  readonly top: readonly ProductPerformanceRow[];
  readonly bottom: readonly ProductPerformanceRow[];
}

/** The products axis view: the ranking plus the window totals and the preceding window's. */
export interface ProductsSummary extends ProductsRanking {
  readonly totals: ProductsTotals;
  /** The same totals over the preceding window of equal length, for the deltas. */
  readonly previous: ProductsTotals;
}

/** Split a revenue-sorted (descending) list of rows into top/bottom N, no overlap. */
export function computeProductsSummary(
  rowsDescByRevenue: readonly ProductPerformanceRow[],
  limit = 5,
): ProductsRanking {
  const top = rowsDescByRevenue.slice(0, limit);
  const bottomCandidates = rowsDescByRevenue.slice(limit).reverse();
  const bottom =
    bottomCandidates.length > 0
      ? bottomCandidates.slice(0, limit)
      : rowsDescByRevenue
          .slice(-limit)
          .reverse()
          .filter((row) => !top.includes(row));
  return { top, bottom };
}

/** Raw inventory facts the repository reads. */
export interface InventoryRawFacts {
  readonly onHandValueMinor: number;
  readonly lowStockCount: number;
  readonly outOfStockCount: number;
  readonly unitsSoldInWindow: number;
  readonly totalOnHandUnits: number;
}

/** The computed inventory health summary. */
export interface InventorySummary {
  readonly onHandValueMinor: number;
  readonly lowStockCount: number;
  readonly outOfStockCount: number;
  /** Units sold in the window ÷ current on-hand units — a cheap, approximate signal, not a real turnover ratio. */
  readonly turnoverSignal: number | null;
}

/** Compute the inventory axis summary from raw aggregate facts. */
export function computeInventorySummary(facts: InventoryRawFacts): InventorySummary {
  return {
    onHandValueMinor: facts.onHandValueMinor,
    lowStockCount: facts.lowStockCount,
    outOfStockCount: facts.outOfStockCount,
    turnoverSignal:
      facts.totalOnHandUnits === 0 ? null : facts.unitsSoldInWindow / facts.totalOnHandUnits,
  };
}

/** One staff member's performance in the window. */
export interface StaffPerformanceRow {
  readonly assigneeId: string | null;
  readonly assigneeName: string;
  readonly orderCount: number;
  readonly collectedMinor: number;
}

/** The computed staff performance summary. */
export interface StaffSummary {
  readonly rows: readonly StaffPerformanceRow[];
}

/** Profitability facts for one period (current or comparison). */
export interface ProfitabilityPeriodFacts {
  readonly collectedMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
}

/** The computed net-income-on-collected summary for one period. */
export interface ProfitabilityPeriod {
  readonly collectedMinor: number;
  readonly cogsMinor: number;
  readonly expensesMinor: number;
  readonly netIncomeMinor: number;
}

/** Net income on collected (D4): `collected − COGS − expenses`, never invoiced revenue. */
export function computeProfitabilityPeriod(facts: ProfitabilityPeriodFacts): ProfitabilityPeriod {
  return {
    collectedMinor: facts.collectedMinor,
    cogsMinor: facts.cogsMinor,
    expensesMinor: facts.expensesMinor,
    netIncomeMinor: facts.collectedMinor - facts.cogsMinor - facts.expensesMinor,
  };
}

/** One bucket of the profitability series — the same arithmetic as {@link ProfitabilityPeriod}. */
export interface ProfitabilityPoint extends ProfitabilityPeriod {
  readonly bucket: string;
}

/** One bucket as the repository reads it, before net income is derived. */
export interface ProfitabilityPointFacts extends ProfitabilityPeriodFacts {
  readonly bucket: string;
}

/** The computed profitability summary, current window plus the preceding window. */
export interface ProfitabilitySummary {
  readonly current: ProfitabilityPeriod;
  readonly previous: ProfitabilityPeriod;
  readonly netIncomeDeltaPct: number | null;
  /** The current window split by the requested granularity, oldest bucket first. */
  readonly series: readonly ProfitabilityPoint[];
  readonly granularity: Granularity;
}

/** Compute the full profitability axis summary (current vs. preceding window). */
export function computeProfitabilitySummary(
  current: ProfitabilityPeriodFacts,
  previous: ProfitabilityPeriodFacts,
  series: readonly ProfitabilityPointFacts[],
  granularity: Granularity,
): ProfitabilitySummary {
  const currentPeriod = computeProfitabilityPeriod(current);
  const previousPeriod = computeProfitabilityPeriod(previous);
  return {
    current: currentPeriod,
    previous: previousPeriod,
    netIncomeDeltaPct: percentDelta(currentPeriod.netIncomeMinor, previousPeriod.netIncomeMinor),
    series: series.map((point) => ({
      bucket: point.bucket,
      ...computeProfitabilityPeriod(point),
    })),
    granularity,
  };
}
