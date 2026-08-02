import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InvoiceListItem } from "@/features/finance/finance-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildInvoiceColumns } from "./invoices-columns";

const INVOICE: InvoiceListItem = {
  id: "i1",
  number: 200,
  orderId: "o1",
  subtotalMinor: 10000,
  vatMinor: 1400,
  totalMinor: 11400,
  vatRateBpsSnapshot: 1400,
  pdfGeneratedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const t = (key: TranslationKey): string => key;

describe("buildInvoiceColumns", () => {
  const columns = buildInvoiceColumns({ t, locale: "en" });

  it("renders every column without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(INVOICE)}</div>);
    }
  });

  it("renders the number and marks it client-sortable", () => {
    const number = columns.find((c) => c.key === "number");
    render(<div>{number?.render(INVOICE)}</div>);
    expect(screen.getByText("#200")).toBeInTheDocument();
    expect(number?.sortAccessor?.(INVOICE)).toBe(200);
  });

  it("marks money columns client-sortable with numeric accessors", () => {
    for (const key of ["totalMinor", "subtotalMinor", "vatMinor"]) {
      const column = columns.find((c) => c.key === key);
      expect(column?.clientSortable).toBe(true);
      expect(typeof column?.sortAccessor?.(INVOICE)).toBe("number");
    }
  });

  it("renders the orderId and a dash when null", () => {
    const orderId = columns.find((c) => c.key === "orderId");
    render(<div>{orderId?.render(INVOICE)}</div>);
    expect(screen.getByText("o1")).toBeInTheDocument();
    render(<div>{orderId?.render({ ...INVOICE, orderId: null })}</div>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("marks createdAt client-sortable", () => {
    const createdAt = columns.find((c) => c.key === "createdAt");
    expect(createdAt?.clientSortable).toBe(true);
    expect(createdAt?.sortAccessor?.(INVOICE)).toBe(INVOICE.createdAt);
  });
});
