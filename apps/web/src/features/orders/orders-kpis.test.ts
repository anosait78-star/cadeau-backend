import { describe, expect, it } from "vitest";
import type { OrderListItem } from "@/features/orders/orders-api";
import { buildOrdersKpis, computePending, sumCounts, sumTodayRevenue } from "./orders-kpis";

function order(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: "o1",
    orderNumber: 1,
    customerId: "c1",
    customerName: "Sara",
    assigneeId: null,
    status: "new",
    followUpState: "none",
    labelId: null,
    reasonId: null,
    governorateId: null,
    warehouseId: null,
    itemCount: 1,
    subtotal: 1000,
    shippingFee: 0,
    discount: 0,
    total: 1000,
    collectedAmount: 0,
    paymentStatus: "unpaid",
    statusChangedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("orders-kpis", () => {
  it("computePending sums the pending-lifecycle statuses only", () => {
    const counts = {
      new: 2,
      confirming: 1,
      processing: 1,
      incomplete: 0,
      delivered: 5,
      cancelled: 1,
    };
    expect(computePending(counts)).toBe(4);
  });

  it("sumCounts sums every status", () => {
    expect(sumCounts({ new: 2, delivered: 3 })).toBe(5);
  });

  it("sumTodayRevenue sums total and COD-only collectedAmount", () => {
    const orders = [
      order({ total: 1000, collectedAmount: 1000, paymentStatus: "paid" }),
      order({ total: 500, collectedAmount: 0, paymentStatus: "unpaid" }),
    ];
    const result = sumTodayRevenue(orders, false);
    expect(result.revenueToday).toBe(1500);
    expect(result.codToday).toBe(1000);
    expect(result.todayApproximate).toBe(false);
  });

  it("flags todayApproximate when the sample was capped", () => {
    expect(sumTodayRevenue([], true).todayApproximate).toBe(true);
  });

  it("buildOrdersKpis assembles all six KPIs", () => {
    const kpis = buildOrdersKpis({
      allCounts: { new: 1, confirming: 1, delivered: 3, cancelled: 2 },
      todayCounts: { new: 1, delivered: 1 },
      todayOrders: [order({ total: 100, collectedAmount: 100, paymentStatus: "paid" })],
      todayOrdersHasMore: false,
    });
    expect(kpis.ordersToday).toBe(2);
    expect(kpis.pending).toBe(2);
    expect(kpis.delivered).toBe(3);
    expect(kpis.cancelled).toBe(2);
    expect(kpis.revenueToday).toBe(100);
    expect(kpis.codToday).toBe(100);
    expect(kpis.todayApproximate).toBe(false);
  });
});
