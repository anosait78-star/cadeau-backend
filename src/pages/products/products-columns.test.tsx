import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Product } from "@/features/products/products-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildProductColumns } from "./products-columns";

const PRODUCT: Product = {
  id: "p1",
  name: "Gift Box",
  description: "A nice box",
  categoryId: "cat1",
  unitId: "u1",
  imageUrl: null,
  allowOversell: false,
  active: true,
  warehouseNames: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const NULL_PRODUCT: Product = {
  ...PRODUCT,
  categoryId: null,
  unitId: null,
  active: false,
};

const t = (key: TranslationKey): string => key;

describe("buildProductColumns", () => {
  const categoryNames = new Map<string, string>([["cat1", "Gifts"]]);
  const unitNames = new Map<string, string>([["u1", "Piece"]]);
  const columns = buildProductColumns({ t, categoryNames, unitNames });

  it("renders every column for populated and null-optional rows without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(PRODUCT)}</div>);
      render(<div>{column.render(NULL_PRODUCT)}</div>);
    }
  });

  it("renders the name and marks it client-sortable", () => {
    const name = columns.find((c) => c.key === "name");
    render(<div>{name?.render(PRODUCT)}</div>);
    expect(screen.getByText("Gift Box")).toBeInTheDocument();
    expect(name?.clientSortable).toBe(true);
    expect(name?.sortAccessor?.(PRODUCT)).toBe("Gift Box");
  });

  it("resolves category and unit names, falling back to a dash when null", () => {
    const category = columns.find((c) => c.key === "category");
    const unit = columns.find((c) => c.key === "unit");
    render(<div>{category?.render(PRODUCT)}</div>);
    expect(screen.getByText("Gifts")).toBeInTheDocument();
    render(<div>{unit?.render(PRODUCT)}</div>);
    expect(screen.getByText("Piece")).toBeInTheDocument();
    render(
      <div>
        {category?.render(NULL_PRODUCT)}
        {unit?.render(NULL_PRODUCT)}
      </div>,
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("joins multiple warehouse names, and falls back to 'none' when there are no stock rows", () => {
    const warehouse = columns.find((c) => c.key === "warehouse");
    render(<div>{warehouse?.render({ ...PRODUCT, warehouseNames: ["Cairo", "Alexandria"] })}</div>);
    expect(screen.getByText("Cairo، Alexandria")).toBeInTheDocument();
    render(<div>{warehouse?.render(PRODUCT)}</div>);
    expect(screen.getByText("products.field.warehouseNone")).toBeInTheDocument();
  });

  it("renders active and inactive status badges", () => {
    const status = columns.find((c) => c.key === "status");
    render(<div>{status?.render(PRODUCT)}</div>);
    expect(screen.getByText("products.status.active")).toBeInTheDocument();
    render(<div>{status?.render(NULL_PRODUCT)}</div>);
    expect(screen.getByText("products.status.inactive")).toBeInTheDocument();
  });
});
