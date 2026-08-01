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
}

/** Raw aggregate facts the repository reads for the business axis. */
export interface BusinessRawFacts {
  readonly orderCount: number;
  readonly collectedMinor: number;
  readonly previousOrderCount: number;
  readonly previousCollectedMinor: number;
  readonly series: readonly SparklinePoint[];
}

/** The computed business KPI summary. */
export interface BusinessSummary {
  readonly orderCount: number;
  readonly collectedMinor: number;
  readonly averageOrderValueMinor: number;
  readonly orderCountDeltaPct: number | null;
  readonly collectedDeltaPct: number | null;
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
  const averageOrderValueMinor =
    facts.orderCount === 0 ? 0 : Math.round(facts.collectedMinor / facts.orderCount);
  return {
    orderCount: facts.orderCount,
    collectedMinor: facts.collectedMinor,
    averageOrderValueMinor,
    orderCountDeltaPct: percentDelta(facts.orderCount, facts.previousOrderCount),
    collectedDeltaPct: percentDelta(facts.collectedMinor, facts.previousCollectedMinor),
    series: facts.series,
    granularity,
  };
}

/** One variant's performance in the window. */
export interface ProductPerformanceRow {
  readonly variantId: string;
  readonly productName: string;
  readonly variantName: string;
  readonly unitsSold: number;
  readonly revenueMinor: number;
}

/** Top and bottom performers by revenue in the window. */
export interface ProductsSummary {
  readonly top: readonly ProductPerformanceRow[];
  readonly bottom: readonly ProductPerformanceRow[];
}

/** Split a revenue-sorted (descending) list of rows into top/bottom N, no overlap. */
export function computeProductsSummary(
  rowsDescByRevenue: readonly ProductPerformanceRow[],
  limit = 5,
): ProductsSummary {
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

/** The computed profitability summary, current window plus the preceding window. */
export interface ProfitabilitySummary {
  readonly current: ProfitabilityPeriod;
  readonly previous: ProfitabilityPeriod;
  readonly netIncomeDeltaPct: number | null;
}

/** Compute the full profitability axis summary (current vs. preceding window). */
export function computeProfitabilitySummary(
  current: ProfitabilityPeriodFacts,
  previous: ProfitabilityPeriodFacts,
): ProfitabilitySummary {
  const currentPeriod = computeProfitabilityPeriod(current);
  const previousPeriod = computeProfitabilityPeriod(previous);
  return {
    current: currentPeriod,
    previous: previousPeriod,
    netIncomeDeltaPct: percentDelta(currentPeriod.netIncomeMinor, previousPeriod.netIncomeMinor),
  };
}
