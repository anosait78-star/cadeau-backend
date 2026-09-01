import { getBusinessAnalytics, type AnalyticsWindow } from "@/features/analytics/analytics-api";
import { orderStatusCounts } from "@/features/orders/orders-api";

/** The periods the dashboard KPI row can be scoped to. */
export const KPI_PERIODS = ["today", "month", "lastMonth", "quarter", "year", "all"] as const;
export type KpiPeriod = (typeof KPI_PERIODS)[number];

/** Statuses that mean "the order is still being worked on". */
const PENDING_STATUSES = ["new", "confirming", "processing", "incomplete"] as const;

export interface PeriodKpis {
  /** Money actually collected in the period, in minor units. */
  readonly collectedMinor: number;
  readonly collectedTrendPct: number | null;
  readonly orderCount: number;
  readonly orderCountTrendPct: number | null;
  readonly averageOrderValueMinor: number;
  readonly shipped: number;
  readonly processing: number;
  /** Orders created in the period, from the status aggregate. */
  readonly totalInPeriod: number;
  /** Order-count history across the period, oldest → newest. */
  readonly orderSeries: readonly number[];
  /** Collected-money history across the period, oldest → newest. */
  readonly collectedSeries: readonly number[];
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The date window a period covers, plus the bucket size its series should use.
 *
 * `all` deliberately carries no bounds: the API reads an absent window as "all
 * time", which is cheaper and more accurate than picking an arbitrary earliest
 * date on the client. Note that a period with no `from` also has no previous
 * period, so the server returns no trend for it — the cards render "—" rather
 * than inventing a comparison.
 */
export function resolvePeriodWindow(period: KpiPeriod): AnalyticsWindow {
  const now = new Date();

  if (period === "all") return { granularity: "month" };

  if (period === "today") {
    return { from: startOfToday().toISOString(), granularity: "day" };
  }

  if (period === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: from.toISOString(), granularity: "day" };
  }

  if (period === "lastMonth") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // The first instant of this month, so last month is covered end to end.
    const to = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: from.toISOString(), to: to.toISOString(), granularity: "day" };
  }

  if (period === "quarter") {
    const from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    return { from: from.toISOString(), granularity: "week" };
  }

  // year
  const from = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
  return { from: from.toISOString(), granularity: "month" };
}

function pendingCount(counts: Record<string, number>): number {
  return PENDING_STATUSES.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/**
 * KPI figures for one period.
 *
 * Money and order counts come from `/v1/analytics/business`, which aggregates
 * server-side and returns its own period-over-period deltas — unlike the Orders
 * page's KPIs, which sample a capped page of rows and are flagged approximate.
 * Over a year that sampling would be badly wrong, so it is not reused here.
 *
 * The per-status figures come from the orders status aggregate over the same
 * window, so every number on the row describes the same period.
 */
export async function fetchPeriodKpis(period: KpiPeriod): Promise<PeriodKpis> {
  const window = resolvePeriodWindow(period);

  const [business, counts] = await Promise.all([
    getBusinessAnalytics(window),
    orderStatusCounts({
      ...(window.from !== undefined ? { createdAtFrom: window.from } : {}),
      ...(window.to !== undefined ? { createdAtTo: window.to } : {}),
    }),
  ]);

  return {
    collectedMinor: business.collectedMinor,
    collectedTrendPct: business.collectedDeltaPct,
    orderCount: business.orderCount,
    orderCountTrendPct: business.orderCountDeltaPct,
    averageOrderValueMinor: business.averageOrderValueMinor,
    shipped: counts.counts["shipped"] ?? 0,
    processing: pendingCount(counts.counts),
    totalInPeriod: sumCounts(counts.counts),
    orderSeries: business.series.map((point) => point.orderCount),
    collectedSeries: business.series.map((point) => point.collectedMinor),
  };
}
