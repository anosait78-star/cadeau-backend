import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CustomerListItem } from "@/features/customers/customers-api";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildCustomerColumns } from "./customers-columns";

const CUSTOMER: CustomerListItem = {
  id: "c1",
  name: "Sara",
  phoneMasked: "+2010•••4567",
  email: "sara@example.com",
  active: true,
  ordersCount: 3,
  totalSpent: 12345,
  lastOrderAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const t = (key: TranslationKey): string => key;

describe("buildCustomerColumns", () => {
  const columns = buildCustomerColumns({ t, locale: "en" });

  it("renders every column for a row without throwing", () => {
    for (const column of columns) {
      render(<div>{column.render(CUSTOMER)}</div>);
    }
  });

  it("renders the name and marks it client-sortable", () => {
    const name = columns.find((c) => c.key === "name");
    render(<div>{name?.render(CUSTOMER)}</div>);
    expect(screen.getByText("Sara")).toBeInTheDocument();
    expect(name?.clientSortable).toBe(true);
    expect(name?.sortAccessor?.(CUSTOMER)).toBe("Sara");
  });

  it("renders the masked phone", () => {
    render(<div>{columns.find((c) => c.key === "phone")?.render(CUSTOMER)}</div>);
    expect(screen.getByText("+2010•••4567")).toBeInTheDocument();
  });

  it("renders the email when present and a dash when null", () => {
    const email = columns.find((c) => c.key === "email");
    render(<div>{email?.render(CUSTOMER)}</div>);
    expect(screen.getByText("sara@example.com")).toBeInTheDocument();
    render(<div>{email?.render({ ...CUSTOMER, email: null })}</div>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders orders count and marks it client-sortable", () => {
    const orders = columns.find((c) => c.key === "orders");
    render(<div>{orders?.render(CUSTOMER)}</div>);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(orders?.clientSortable).toBe(true);
    expect(orders?.sortAccessor?.(CUSTOMER)).toBe(3);
  });

  it("renders the spent amount and marks it client-sortable", () => {
    const spent = columns.find((c) => c.key === "spent");
    render(<div>{spent?.render(CUSTOMER)}</div>);
    expect(spent?.clientSortable).toBe(true);
    expect(spent?.sortAccessor?.(CUSTOMER)).toBe(12345);
  });

  it("renders the last order date and a dash when null", () => {
    const lastOrder = columns.find((c) => c.key === "lastOrder");
    render(<div>{lastOrder?.render(CUSTOMER)}</div>);
    render(<div>{lastOrder?.render({ ...CUSTOMER, lastOrderAt: null })}</div>);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders active and inactive status badges", () => {
    const status = columns.find((c) => c.key === "status");
    render(<div>{status?.render(CUSTOMER)}</div>);
    expect(screen.getByText("customers.status.active")).toBeInTheDocument();
    render(<div>{status?.render({ ...CUSTOMER, active: false })}</div>);
    expect(screen.getByText("customers.status.inactive")).toBeInTheDocument();
  });
});
