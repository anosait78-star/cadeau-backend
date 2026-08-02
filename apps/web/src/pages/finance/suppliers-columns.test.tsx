import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Supplier } from "@/features/finance/finance-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildSupplierColumns } from "./suppliers-columns";

const SUPPLIER: Supplier = {
  id: "s1",
  name: "Acme Co",
  phone: "0100000000",
  email: "acme@example.com",
  address: "Cairo",
  taxId: "TAX-1",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const NULL_SUPPLIER: Supplier = {
  ...SUPPLIER,
  phone: null,
  email: null,
  address: null,
  taxId: null,
  active: false,
};

const t = (key: TranslationKey): string => key;

describe("buildSupplierColumns", () => {
  const columns = buildSupplierColumns({ t });

  it("renders every column for populated and null-optional rows without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(SUPPLIER)}</div>);
      render(<div>{column.render(NULL_SUPPLIER)}</div>);
    }
  });

  it("renders the name and marks it client-sortable", () => {
    const name = columns.find((c) => c.key === "name");
    render(<div>{name?.render(SUPPLIER)}</div>);
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    expect(name?.clientSortable).toBe(true);
    expect(name?.sortAccessor?.(SUPPLIER)).toBe("Acme Co");
  });

  it("renders dashes for null optional fields", () => {
    const phone = columns.find((c) => c.key === "phone");
    const email = columns.find((c) => c.key === "email");
    const address = columns.find((c) => c.key === "address");
    const taxId = columns.find((c) => c.key === "taxId");
    render(
      <div>
        {phone?.render(NULL_SUPPLIER)}
        {email?.render(NULL_SUPPLIER)}
        {address?.render(NULL_SUPPLIER)}
        {taxId?.render(NULL_SUPPLIER)}
      </div>,
    );
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("renders active and inactive status badges", () => {
    const status = columns.find((c) => c.key === "status");
    render(<div>{status?.render(SUPPLIER)}</div>);
    expect(screen.getByText("finance.status.active")).toBeInTheDocument();
    render(<div>{status?.render(NULL_SUPPLIER)}</div>);
    expect(screen.getByText("finance.status.inactive")).toBeInTheDocument();
  });
});
