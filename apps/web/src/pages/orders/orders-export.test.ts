import { describe, expect, it } from "vitest";
import type { OrderListItem } from "@/features/orders/orders-api";
import { ordersToCsv } from "./orders-export";

function order(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: "o1",
    orderNumber: 1042,
    customerId: "c1",
    customerName: "Sara",
    assigneeId: null,
    status: "new",
    followUpState: "none",
    labelId: null,
    reasonId: null,
    governorateId: null,
    warehouseId: null,
    itemCount: 2,
    subtotal: 30000,
    shippingFee: 5000,
    discount: 0,
    total: 35000,
    collectedAmount: 0,
    paymentStatus: "unpaid",
    statusChangedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ordersToCsv", () => {
  it("emits a header row and one data row per order", () => {
    const csv = ordersToCsv([order()]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "orderNumber,customerName,itemCount,total,collectedAmount,paymentStatus,status,createdAt",
    );
    expect(lines[1]).toContain("1042");
    expect(lines[1]).toContain("Sara");
    expect(lines[1]).toContain("350.00");
  });

  it("quotes fields containing a comma", () => {
    const csv = ordersToCsv([order({ customerName: "Sara, Ali" })]);
    expect(csv).toContain('"Sara, Ali"');
  });

  it("returns just the header for an empty list", () => {
    const csv = ordersToCsv([]);
    expect(csv.split("\n")).toHaveLength(1);
  });
});
