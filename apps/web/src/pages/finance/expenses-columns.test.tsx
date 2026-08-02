import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Expense } from "@/features/finance/finance-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildExpenseColumns } from "./expenses-columns";

const EXPENSE: Expense = {
  id: "e1",
  category: "Utilities",
  amountMinor: 5000,
  incurredAt: "2026-01-01T00:00:00.000Z",
  notes: "Electric bill",
  supplierId: "s1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const t = (key: TranslationKey): string => key;

describe("buildExpenseColumns", () => {
  const supplierNames = new Map<string, string>([["s1", "Acme Co"]]);
  const columns = buildExpenseColumns({ t, locale: "en", supplierNames });

  it("renders every column without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(EXPENSE)}</div>);
    }
  });

  it("renders the category and marks it client-sortable", () => {
    const category = columns.find((c) => c.key === "category");
    render(<div>{category?.render(EXPENSE)}</div>);
    expect(screen.getByText("Utilities")).toBeInTheDocument();
    expect(category?.clientSortable).toBe(true);
    expect(category?.sortAccessor?.(EXPENSE)).toBe("Utilities");
  });

  it("marks the amount and incurredAt columns client-sortable", () => {
    const amount = columns.find((c) => c.key === "amountMinor");
    const incurredAt = columns.find((c) => c.key === "incurredAt");
    expect(amount?.sortAccessor?.(EXPENSE)).toBe(5000);
    expect(incurredAt?.sortAccessor?.(EXPENSE)).toBe(EXPENSE.incurredAt);
  });

  it("resolves the supplier name or falls back to id, and shows a dash when null", () => {
    const supplier = columns.find((c) => c.key === "supplier");
    render(<div>{supplier?.render(EXPENSE)}</div>);
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    render(<div>{supplier?.render({ ...EXPENSE, supplierId: "unknown" })}</div>);
    expect(screen.getByText("unknown")).toBeInTheDocument();
    render(<div>{supplier?.render({ ...EXPENSE, supplierId: null })}</div>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders notes and a dash when null", () => {
    const notes = columns.find((c) => c.key === "notes");
    render(<div>{notes?.render(EXPENSE)}</div>);
    expect(screen.getByText("Electric bill")).toBeInTheDocument();
    render(<div>{notes?.render({ ...EXPENSE, notes: null })}</div>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
