import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StockLevel } from "@/features/inventory/inventory-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildStockColumns } from "./inventory-stock-columns";

const STOCK: StockLevel = {
  id: "st1",
  warehouseId: "w1",
  variantId: "v1",
  variantName: "Blue / M",
  productId: "p1",
  productName: "Satin bouquet",
  sku: "SKU-1",
  imageUrl: "https://cdn.example.com/a.png",
  onHand: 100,
  committed: 20,
  available: 80,
  reorderPoint: 10,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const t = (key: TranslationKey): string => key;

describe("buildStockColumns", () => {
  const warehouseNames = new Map<string, string>([["w1", "Main WH"]]);
  const columns = buildStockColumns({ t, warehouseNames });

  it("renders every column without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(STOCK)}</div>);
    }
  });

  it("names the product from the row itself, never a uuid", () => {
    const product = columns.find((c) => c.key === "product");
    render(<div>{product?.render(STOCK)}</div>);
    expect(screen.getByText("Satin bouquet")).toBeInTheDocument();
    expect(screen.queryByText("v1")).not.toBeInTheDocument();
  });

  it("shows the variant and sku as secondary detail", () => {
    const product = columns.find((c) => c.key === "product");
    render(<div>{product?.render(STOCK)}</div>);
    expect(screen.getByText("Blue / M · SKU-1")).toBeInTheDocument();
  });

  it("drops the variant name when it only repeats the product name", () => {
    const product = columns.find((c) => c.key === "product");
    render(<div>{product?.render({ ...STOCK, variantName: "Satin bouquet", sku: null })}</div>);
    expect(screen.getByText("Satin bouquet")).toBeInTheDocument();
    expect(screen.queryByText("Satin bouquet · Satin bouquet")).not.toBeInTheDocument();
  });

  it("renders the product image, and a placeholder when there is none", () => {
    const image = columns.find((c) => c.key === "image");
    const { container } = render(<div>{image?.render(STOCK)}</div>);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.example.com/a.png");
    render(<div>{image?.render({ ...STOCK, imageUrl: null })}</div>);
    expect(screen.getByTestId("product-thumb-placeholder")).toBeInTheDocument();
  });

  it("resolves the warehouse name, falling back to the id when unknown", () => {
    const warehouse = columns.find((c) => c.key === "warehouse");
    render(<div>{warehouse?.render(STOCK)}</div>);
    expect(screen.getByText("Main WH")).toBeInTheDocument();
    render(<div>{warehouse?.render({ ...STOCK, warehouseId: "unknown" })}</div>);
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
