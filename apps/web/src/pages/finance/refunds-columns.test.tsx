import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Refund } from "@/features/finance/finance-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildRefundColumns } from "./refunds-columns";

const REFUND: Refund = {
  id: "r1",
  invoiceId: "i1",
  orderId: "o1",
  amountMinor: 2500,
  reason: "Damaged item",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const t = (key: TranslationKey): string => key;

describe("buildRefundColumns", () => {
  const columns = buildRefundColumns({ t, locale: "en" });

  it("renders every column without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(REFUND)}</div>);
    }
  });

  it("marks the amount client-sortable with a numeric accessor", () => {
    const amount = columns.find((c) => c.key === "amountMinor");
    expect(amount?.clientSortable).toBe(true);
    expect(amount?.sortAccessor?.(REFUND)).toBe(2500);
  });

  it("renders the reason", () => {
    render(<div>{columns.find((c) => c.key === "reason")?.render(REFUND)}</div>);
    expect(screen.getByText("Damaged item")).toBeInTheDocument();
  });

  it("renders invoiceId/orderId and dashes when null", () => {
    const invoiceId = columns.find((c) => c.key === "invoiceId");
    const orderId = columns.find((c) => c.key === "orderId");
    render(<div>{invoiceId?.render(REFUND)}</div>);
    expect(screen.getByText("i1")).toBeInTheDocument();
    render(<div>{orderId?.render(REFUND)}</div>);
    expect(screen.getByText("o1")).toBeInTheDocument();
    render(
      <div>
        {invoiceId?.render({ ...REFUND, invoiceId: null })}
        {orderId?.render({ ...REFUND, orderId: null })}
      </div>,
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("marks createdAt client-sortable", () => {
    const createdAt = columns.find((c) => c.key === "createdAt");
    expect(createdAt?.clientSortable).toBe(true);
    expect(createdAt?.sortAccessor?.(REFUND)).toBe(REFUND.createdAt);
  });
});
