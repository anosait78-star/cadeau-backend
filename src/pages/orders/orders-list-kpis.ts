import { listOrders, orderStatusCounts } from "@/features/orders/orders-api";
import { sumTodayRevenue } from "@/features/orders/orders-kpis";

/**
 * KPI data for the Orders list page header cards — deliberately independent
 * from `features/orders/orders-kpis.ts` (which the Dashboard also consumes):
 * this module only ever powers the Orders page, so it's free to shape its
 * response (trend %, 7-day sparkline series) without any risk to Dashboard.
 *
 * Every number here is real (no fabricated trend/forecast data): day-over-day
 * trend and the sparkline both come from the same 7 lightweight status-count
 * aggregate calls (cheap grouped queries, not full-row pulls); the two money
 * metrics reuse the existing capped-sample technique from `orders-kpis.ts`
 * (`sumTodayRevenue`) for both today and yesterday, so they carry the same
 * `approximate` caveat the rest of the app already surfaces.
 */

const PENDING_STATUSES = ["new", "confirming", "processing", "incomplete"] as const;

export interface OrdersCountKpi {
  readonly value: number;
  /** Percent day-over-day change; `null` when there's no meaningful baseline (yesterday = 0). */
  readonly trendPct: number | null;
  /** 7 points, oldest → newest, today last. */
  readonly series: readonly number[];
}

export interface OrdersMoneyKpi {
  readonly value: number;
  readonly trendPct: number | null;
  readonly approximate: boolean;
}

export interface OrdersListKpis {
  readonly ordersToday: OrdersCountKpi;
  readonly totalOrders: OrdersCountKpi;
  readonly shipped: OrdersCountKpi;
  readonly processing: OrdersCountKpi;
  readonly revenueToday: OrdersMoneyKpi;
  readonly codToday: OrdersMoneyKpi;
}

function startOfDay(daysAgo: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function nextDay(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return next;
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function pendingCount(counts: Record<string, number>): number {
  return PENDING_STATUSES.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

function trendPct(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

export async function fetchOrdersListKpis(): Promise<OrdersListKpis> {
  const days = Array.from({ length: 7 }, (_, i) => startOfDay(6 - i)); // oldest -> newest, today last
  const yesterday = days[5]!;
  const today = days[6]!;

  const [dayBuckets, allCounts, todayOrders, yesterdayOrders] = await Promise.all([
    Promise.all(
      days.map((from) =>
        orderStatusCounts({ createdAtFrom: from.toISOString(), createdAtTo: nextDay(from).toISOString() }),
      ),
    ),
    orderStatusCounts({}),
    listOrders({ createdAtFrom: today.toISOString(), sort: "-createdAt" }),
    listOrders({
      createdAtFrom: yesterday.toISOString(),
      createdAtTo: today.toISOString(),
      sort: "-createdAt",
    }),
  ]);

  const totalSeries = dayBuckets.map((d) => sumCounts(d.counts));
  const shippedSeries = dayBuckets.map((d) => d.counts["shipped"] ?? 0);
  const processingSeries = dayBuckets.map((d) => pendingCount(d.counts));

  const last = (series: readonly number[]): number => series[series.length - 1]!;
  const prev = (series: readonly number[]): number => series[series.length - 2]!;

  const todayRevenue = sumTodayRevenue(todayOrders.data, todayOrders.page.hasMore);
  const yesterdayRevenue = sumTodayRevenue(yesterdayOrders.data, yesterdayOrders.page.hasMore);

  return {
    ordersToday: {
      value: last(totalSeries),
      trendPct: trendPct(last(totalSeries), prev(totalSeries)),
      series: totalSeries,
    },
    totalOrders: {
      value: sumCounts(allCounts.counts),
      trendPct: trendPct(last(totalSeries), prev(totalSeries)),
      series: totalSeries,
    },
    shipped: {
      value: allCounts.counts["shipped"] ?? 0,
      trendPct: trendPct(last(shippedSeries), prev(shippedSeries)),
      series: shippedSeries,
    },
    processing: {
      value: pendingCount(allCounts.counts),
      trendPct: trendPct(last(processingSeries), prev(processingSeries)),
      series: processingSeries,
    },
    revenueToday: {
      value: todayRevenue.revenueToday,
      trendPct: trendPct(todayRevenue.revenueToday, yesterdayRevenue.revenueToday),
      approximate: todayRevenue.todayApproximate || yesterdayRevenue.todayApproximate,
    },
    codToday: {
      value: todayRevenue.codToday,
      trendPct: trendPct(todayRevenue.codToday, yesterdayRevenue.codToday),
      approximate: todayRevenue.todayApproximate || yesterdayRevenue.todayApproximate,
    },
  };
}
