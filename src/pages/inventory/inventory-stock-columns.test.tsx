import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StockLevel } from "@/features/inventory/inventory-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildStockColumns } from "./inventory-stock-columns";

const STOCK: StockLevel = {
  id: "st1",
  warehouseId: "w1",
  variantId: "v1",
  onHand: 100,
  committed: 20,
  available: 80,
  reorderPoint: 10,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const t = (key: TranslationKey): string => key;

describe("buildStockColumns", () => {
  const warehouseNames = new Map<string, string>([["w1", "Main WH"]]);
  const variantNames = new Map<string, string>([["v1", "Blue / M"]]);
  const columns = buildStockColumns({ t, warehouseNames, variantNames });

  it("renders every column without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(STOCK)}</div>);
    }
  });

  it("resolves the variant and warehouse names, falling back to the id when unknown", () => {
    const variant = columns.find((c) => c.key === "variant");
    const warehouse = columns.find((c) => c.key === "warehouse");
    render(<div>{variant?.render(STOCK)}</div>);
    expect(screen.getByText("Blue / M")).toBeInTheDocument();
    render(<div>{warehouse?.render(STOCK)}</div>);
    expect(screen.getByText("Main WH")).toBeInTheDocument();
    render(<div>{variant?.render({ ...STOCK, variantId: "unknown" })}</div>);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("marks the available column client-sortable with a numeric accessor", () => {
    const available = columns.find((c) => c.key === "available");
    expect(available?.clientSortable).toBe(true);
    expect(available?.sortAccessor?.(STOCK)).toBe(80);
  });

  it("shows the low-stock badge when available is at or below the reorder point", () => {
    const reorderPoint = columns.find((c) => c.key === "reorderPoint");
    render(<div>{reorderPoint?.render({ ...STOCK, available: 5, reorderPoint: 10 })}</div>);
    expect(screen.getByTestId("low-badge")).toBeInTheDocument();
  });

  it("hides the low-stock badge when stock is healthy or reorder point is unset", () => {
    const reorderPoint = columns.find((c) => c.key === "reorderPoint");
    render(<div>{reorderPoint?.render(STOCK)}</div>);
    expect(screen.queryByTestId("low-badge")).not.toBeInTheDocument();
    render(<div>{reorderPoint?.render({ ...STOCK, reorderPoint: 0, available: 0 })}</div>);
    expect(screen.queryAllByTestId("low-badge")).toHaveLength(0);
  });
});
