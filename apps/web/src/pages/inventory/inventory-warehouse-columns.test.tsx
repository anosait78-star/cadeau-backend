import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Warehouse } from "@/features/inventory/inventory-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildWarehouseColumns } from "./inventory-warehouse-columns";

const WAREHOUSE: Warehouse = {
  id: "w1",
  name: "Main WH",
  code: "MAIN",
  address: "Cairo",
  isDefault: true,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const NULL_WAREHOUSE: Warehouse = {
  ...WAREHOUSE,
  code: null,
  address: null,
  isDefault: false,
  active: false,
};

const t = (key: TranslationKey): string => key;

describe("buildWarehouseColumns", () => {
  const columns = buildWarehouseColumns({ t });

  it("renders every column for populated and null-optional rows without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(WAREHOUSE)}</div>);
      render(<div>{column.render(NULL_WAREHOUSE)}</div>);
    }
  });

  it("shows the default badge only when isDefault is true, and marks name client-sortable", () => {
    const name = columns.find((c) => c.key === "name");
    render(<div>{name?.render(WAREHOUSE)}</div>);
    expect(screen.getByText("inventory.field.isDefault")).toBeInTheDocument();
    render(<div>{name?.render(NULL_WAREHOUSE)}</div>);
    expect(name?.clientSortable).toBe(true);
    expect(name?.sortAccessor?.(WAREHOUSE)).toBe("Main WH");
  });

  it("renders dashes for null code and address", () => {
    const code = columns.find((c) => c.key === "code");
    const address = columns.find((c) => c.key === "address");
    render(
      <div>
        {code?.render(NULL_WAREHOUSE)}
        {address?.render(NULL_WAREHOUSE)}
      </div>,
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("renders active and inactive status badges", () => {
    const status = columns.find((c) => c.key === "status");
    render(<div>{status?.render(WAREHOUSE)}</div>);
    expect(screen.getByText("inventory.status.active")).toBeInTheDocument();
    render(<div>{status?.render(NULL_WAREHOUSE)}</div>);
    expect(screen.getByText("inventory.status.inactive")).toBeInTheDocument();
  });
});
