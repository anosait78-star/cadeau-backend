import type { OrderListItem } from "@/features/orders/orders-api";

const PENDING_STATUSES = ["new", "confirming", "processing", "incomplete"] as const;

export interface OrdersKpis {
  readonly ordersToday: number;
  readonly pending: number;
  readonly delivered: number;
  readonly cancelled: number;
  /** In integer minor units. */
  readonly revenueToday: number;
  /** In integer minor units. */
  readonly codToday: number;
  /** True when revenueToday/codToday were computed over a capped sample, not the full day. */
  readonly todayApproximate: boolean;
}

/** Sum of `orderStatusCounts()` across the "pending" lifecycle states. */
export function computePending(counts: Record<string, number>): number {
  return PENDING_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

/** Sum of `orderStatusCounts()` across all statuses (used for "Orders Today"). */
export function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/**
 * Revenue/COD today from a capped sample of today's orders. If `hasMore` is
 * still true after the cap, the totals are an undercount of the true day total
 * — callers must surface `todayApproximate` to the user rather than implying
 * an exact figure.
 */
export function sumTodayRevenue(
  todayOrders: OrderListItem[],
  hasMore: boolean,
): { revenueToday: number; codToday: number; todayApproximate: boolean } {
  let revenueToday = 0;
  let codToday = 0;
  for (const order of todayOrders) {
    revenueToday += order.total;
    if (order.paymentStatus !== "unpaid") codToday += order.collectedAmount;
  }
  return { revenueToday, codToday, todayApproximate: hasMore };
}

export function buildOrdersKpis(input: {
  readonly allCounts: Record<string, number>;
  readonly todayCounts: Record<string, number>;
  readonly todayOrders: OrderListItem[];
  readonly todayOrdersHasMore: boolean;
}): OrdersKpis {
  const { revenueToday, codToday, todayApproximate } = sumTodayRevenue(
    input.todayOrders,
    input.todayOrdersHasMore,
  );
  return {
    ordersToday: sumCounts(input.todayCounts),
    pending: computePending(input.allCounts),
    delivered: input.allCounts["delivered"] ?? 0,
    cancelled: input.allCounts["cancelled"] ?? 0,
    revenueToday,
    codToday,
    todayApproximate,
  };
}
