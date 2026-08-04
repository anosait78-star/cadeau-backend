import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OrderListItem } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildOrderColumns, type OrderLabel } from "./orders-columns";

const ORDER: OrderListItem = {
  id: "o1",
  orderNumber: 1042,
  customerId: "c1",
  customerName: "Sara",
  assigneeId: null,
  status: "new",
  followUpState: "none",
  labelId: "l1",
  reasonId: null,
  governorateId: null,
  warehouseId: null,
  itemCount: 2,
  subtotal: 30000,
  shippingFee: 5000,
  discount: 0,
  total: 35000,
  collectedAmount: 0,
  paymentStatus: "paid",
  statusChangedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const t = (key: TranslationKey): string => key;

describe("buildOrderColumns", () => {
  const labelsById = new Map<string, OrderLabel>([
    ["l1", { id: "l1", name: "VIP", color: "#ff0000" }],
  ]);
  const columns = buildOrderColumns({ t, locale: "en", labelsById });

  it("renders every column for a row without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(ORDER)}</div>);
    }
  });

  it("renders the order number", () => {
    render(<div>{columns.find((c) => c.key === "orderNumber")?.render(ORDER)}</div>);
    expect(screen.getByText("#1042")).toBeInTheDocument();
  });

  it("renders the payment badge with a colored class", () => {
    render(<div>{columns.find((c) => c.key === "payment")?.render(ORDER)}</div>);
    expect(screen.getByTestId("payment-status")).toHaveClass("bg-success/15");
  });

  it("renders the label chip for a known labelId", () => {
    render(<div>{columns.find((c) => c.key === "tags")?.render(ORDER)}</div>);
    expect(screen.getByText("VIP")).toBeInTheDocument();
  });

  it("renders a dash for a null labelId", () => {
    render(<div>{columns.find((c) => c.key === "tags")?.render({ ...ORDER, labelId: null })}</div>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("marks the amount column as client-sortable with a numeric accessor", () => {
    const amount = columns.find((c) => c.key === "amount");
    expect(amount?.clientSortable).toBe(true);
    expect(amount?.sortAccessor?.(ORDER)).toBe(35000);
  });

  it("marks createdAt as server-sortable", () => {
    const createdAt = columns.find((c) => c.key === "createdAt");
    expect(createdAt?.sortable).toBe(true);
  });
});
