import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PurchaseOrderListItem } from "@/features/finance/finance-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildPurchaseOrderColumns } from "./purchase-orders-columns";

const PO: PurchaseOrderListItem = {
  id: "po1",
  number: 100,
  supplierId: "s1",
  status: "draft",
  expectedDate: "2026-01-05T00:00:00.000Z",
  notes: "Rush order",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const t = (key: TranslationKey): string => key;

describe("buildPurchaseOrderColumns", () => {
  const supplierNames = new Map<string, string>([["s1", "Acme Co"]]);
  const columns = buildPurchaseOrderColumns({ t, locale: "en", supplierNames });

  it("renders every column without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(PO)}</div>);
    }
  });

  it("renders the number and marks it client-sortable", () => {
    const number = columns.find((c) => c.key === "number");
    render(<div>{number?.render(PO)}</div>);
    expect(screen.getByText("#100")).toBeInTheDocument();
    expect(number?.clientSortable).toBe(true);
    expect(number?.sortAccessor?.(PO)).toBe(100);
  });

  it("resolves the supplier name, falling back to the id when unknown", () => {
    const supplier = columns.find((c) => c.key === "supplier");
    render(<div>{supplier?.render(PO)}</div>);
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    render(<div>{supplier?.render({ ...PO, supplierId: "unknown" })}</div>);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("renders notes and a dash when null", () => {
    const notes = columns.find((c) => c.key === "notes");
    render(<div>{notes?.render(PO)}</div>);
    expect(screen.getByText("Rush order")).toBeInTheDocument();
    render(<div>{notes?.render({ ...PO, notes: null })}</div>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the expected date and a dash when null", () => {
    const expectedDate = columns.find((c) => c.key === "expectedDate");
    render(<div>{expectedDate?.render(PO)}</div>);
    render(<div>{expectedDate?.render({ ...PO, expectedDate: null })}</div>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
