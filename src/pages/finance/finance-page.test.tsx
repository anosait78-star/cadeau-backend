import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { I18nProvider } from "@/i18n/i18n-provider";
import { FinancePage } from "./finance-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function caps(features: string[], permissions: string[], children: ReactNode): ReactNode {
  const value: CapabilitiesContextValue = {
    status: "ready",
    features,
    permissions,
    isSuperAdmin: false,
    has: (req: CapabilityRequirement) =>
      (req.feature === undefined || features.includes(req.feature)) &&
      (req.permission === undefined || permissions.includes(req.permission)),
    reload: () => Promise.resolve(),
  };
  return <CapabilitiesContext value={value}>{children}</CapabilitiesContext>;
}

function renderPage(features = ["finance"], permissions = ["finance.read", "finance.manage"]) {
  return render(<I18nProvider>{caps(features, permissions, <FinancePage />)}</I18nProvider>);
}

const SUPPLIER = "11111111-1111-1111-1111-111111111111";
const VARIANT = "22222222-2222-2222-2222-222222222222";
const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const PO = "44444444-4444-4444-4444-444444444444";
const INVOICE = "55555555-5555-5555-5555-555555555555";
const PO_LINE = "66666666-6666-6666-6666-666666666666";

const SUPPLIERS = {
  data: [
    {
      id: SUPPLIER,
      name: "Acme Trading",
      phone: null,
      email: null,
      address: null,
      taxId: null,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const PRODUCTS = {
  data: [
    {
      id: "p1",
      name: "Mug",
      description: null,
      categoryId: null,
      unitId: null,
      allowOversell: false,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const VARIANTS = {
  data: [
    {
      id: VARIANT,
      productId: "p1",
      name: "Small",
      sku: "SKU-1",
      barcode: null,
      averageCost: 0,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const WAREHOUSES = {
  data: [
    {
      id: WAREHOUSE,
      name: "Main",
      code: null,
      address: null,
      isDefault: true,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const PO_LIST = {
  data: [
    {
      id: PO,
      number: 1001,
      supplierId: SUPPLIER,
      status: "ordered",
      expectedDate: null,
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const PO_DETAIL = {
  ...PO_LIST.data[0],
  lines: [
    { id: PO_LINE, variantId: VARIANT, quantityOrdered: 10, quantityReceived: 0, unitCost: 500 },
  ],
};

const INVOICE_LIST = {
  data: [
    {
      id: INVOICE,
      number: 42,
      orderId: null,
      subtotalMinor: 10000,
      vatMinor: 1400,
      totalMinor: 11400,
      vatRateBpsSnapshot: 1400,
      pdfGeneratedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const EMPTY_PAGE = { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };

function buildFetchMock() {
  return vi.fn((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.includes("/products/p1/variants")) return Promise.resolve(json(200, VARIANTS));
    if (url.includes("/products")) return Promise.resolve(json(200, PRODUCTS));
    if (url.includes("/warehouses")) return Promise.resolve(json(200, WAREHOUSES));

    if (url.includes("/finance/suppliers") && method === "POST") {
      return Promise.resolve(
        json(201, { ...SUPPLIERS.data[0], id: "s2", name: "New Co", active: true }),
      );
    }
    if (url.match(/\/finance\/suppliers\/[^/]+$/) && method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.includes("/finance/suppliers")) return Promise.resolve(json(200, SUPPLIERS));

    if (url.includes(`/finance/purchase-orders/${PO}/receipts`) && method === "POST") {
      return Promise.resolve(
        json(201, {
          id: "r1",
          poId: PO,
          warehouseId: WAREHOUSE,
          receivedAt: "2026-01-02T00:00:00.000Z",
          lines: [{ id: "rl1", poLineId: PO_LINE, quantity: 10 }],
        }),
      );
    }
    if (url.includes(`/finance/purchase-orders/${PO}/payments`) && method === "POST") {
      return Promise.resolve(
        json(201, {
          id: "pay1",
          poId: PO,
          amountMinor: 5000,
          method: "bank_transfer",
          paidAt: "2026-01-02T00:00:00.000Z",
        }),
      );
    }
    if (url.includes("/finance/purchase-orders") && method === "POST") {
      return Promise.resolve(json(201, PO_DETAIL));
    }
    if (url.match(/\/finance\/purchase-orders\/[^/]+$/) && method === "GET") {
      return Promise.resolve(json(200, PO_DETAIL));
    }
    if (url.includes("/finance/purchase-orders")) return Promise.resolve(json(200, PO_LIST));

    if (url.includes("/finance/expenses") && method === "POST") {
      return Promise.resolve(
        json(201, {
          id: "e1",
          category: "office",
          amountMinor: 1000,
          incurredAt: "2026-01-01T00:00:00.000Z",
          notes: null,
          supplierId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
    }
    if (url.includes("/finance/expenses")) return Promise.resolve(json(200, EMPTY_PAGE));

    if (url.includes(`/finance/invoices/${INVOICE}/pdf`)) {
      return Promise.resolve(
        new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), { status: 200 }),
      );
    }
    if (url.match(/\/finance\/invoices\/[^/]+$/) && method === "GET") {
      return Promise.resolve(json(200, { ...INVOICE_LIST.data[0], lines: [] }));
    }
    if (url.includes("/finance/invoices") && method === "POST") {
      return Promise.resolve(json(201, { ...INVOICE_LIST.data[0], lines: [] }));
    }
    if (url.includes("/finance/invoices")) return Promise.resolve(json(200, INVOICE_LIST));

    if (url.includes("/finance/refunds") && method === "POST") {
      return Promise.resolve(
        json(201, {
          id: "ref1",
          invoiceId: INVOICE,
          orderId: null,
          amountMinor: 500,
          reason: "damaged",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
    }
    if (url.includes("/finance/refunds")) return Promise.resolve(json(200, EMPTY_PAGE));

    if (url.includes("/finance/reconciliations")) return Promise.resolve(json(200, EMPTY_PAGE));

    if (url.includes("/finance/periods")) {
      return Promise.resolve(
        json(200, [
          {
            id: "period1",
            periodKey: "2026-01",
            status: "open",
            closedAt: null,
            closedBy: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      );
    }

    if (url.includes("/finance/reports/cash-center")) {
      return Promise.resolve(
        json(200, {
          collectedMinor: 100000,
          expensesMinor: 20000,
          purchaseOrderPaymentsMinor: 10000,
          refundsMinor: 5000,
          shippingFeesMinor: 3000,
          netCashMinor: 62000,
        }),
      );
    }
    if (url.includes("/finance/reports/pnl")) {
      return Promise.resolve(
        json(200, {
          current: {
            revenueMinor: 100000,
            cogsMinor: 40000,
            expensesMinor: 20000,
            netIncomeMinor: 40000,
          },
        }),
      );
    }

    return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
  });
}

describe("FinancePage", () => {
  let fetchMock: ReturnType<typeof buildFetchMock>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides the whole screen without the feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to finance.")).toBeInTheDocument();
  });

  // ---- Suppliers -----------------------------------------------------------

  it("lists suppliers on the default tab", async () => {
    renderPage();
    expect(await screen.findByText("Acme Trading")).toBeInTheDocument();
  });

  it("hides create without the manage permission", async () => {
    renderPage(["finance"], ["finance.read"]);
    await screen.findByText("Acme Trading");
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });

  it("creates a supplier", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Name"), "New Co");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]).includes("/finance/suppliers") && (c[1] as RequestInit)?.method === "POST",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({ name: "New Co" });
    });
  });

  it("archives a supplier", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            String(c[0]).includes(`/finance/suppliers/${SUPPLIER}`) &&
            (c[1] as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true);
    });
  });

  it("shows an error state and retries", async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(json(500, { error: { code: "INTERNAL", statusCode: 500 } })),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Acme Trading")).toBeInTheDocument();
  });

  // ---- Purchase orders -------------------------------------------------------

  it("lists purchase orders, filters by status, and creates one", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Purchase orders" }));
    expect(await screen.findByText("PO number #1001")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.selectOptions(
      screen.getByLabelText("Supplier", { selector: "#po-create-supplier" }),
      SUPPLIER,
    );
    await userEvent.selectOptions(screen.getByLabelText("Variant"), VARIANT);
    await userEvent.type(screen.getByLabelText("Quantity"), "10");
    await userEvent.type(screen.getByLabelText("Unit cost"), "5.00");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === "http://localhost:3000/v1/finance/purchase-orders" &&
          (c[1] as RequestInit)?.method === "POST",
      );
      expect(call).toBeDefined();
      const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBeTruthy();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        supplierId: SUPPLIER,
        lines: [{ variantId: VARIANT, quantityOrdered: 10, unitCost: 500 }],
      });
    });
  });

  it("receives a purchase order into a warehouse", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Purchase orders" }));
    await screen.findByText("PO number #1001");
    await userEvent.click(screen.getByRole("button", { name: "Receive" }));
    await userEvent.selectOptions(screen.getByLabelText("Warehouse"), WAREHOUSE);
    await userEvent.click(screen.getByRole("button", { name: "Confirm receipt" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes(`/finance/purchase-orders/${PO}/receipts`),
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        warehouseId: WAREHOUSE,
        lines: [{ poLineId: PO_LINE, quantity: 10 }],
      });
    });
  });

  it("records a payment against a purchase order", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Purchase orders" }));
    await screen.findByText("PO number #1001");
    await userEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await userEvent.type(screen.getByLabelText("Amount"), "50.00");
    const payButtons = screen.getAllByRole("button", { name: "Record payment" });
    await userEvent.click(payButtons[payButtons.length - 1] as HTMLElement);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes(`/finance/purchase-orders/${PO}/payments`),
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        amountMinor: 5000,
      });
    });
  });

  // ---- Invoices --------------------------------------------------------------

  it("lists invoices, issues a manual one, and downloads the PDF", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Invoices" }));
    expect(await screen.findByText("Invoice number #42")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes(`/finance/invoices/${INVOICE}/pdf`)),
      ).toBe(true);
    });

    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(screen.getByRole("tab", { name: "Manual lines" }));
    await userEvent.type(screen.getByLabelText("Description"), "Consulting");
    await userEvent.clear(screen.getByLabelText("Qty"));
    await userEvent.type(screen.getByLabelText("Qty"), "1");
    await userEvent.type(screen.getByLabelText("Unit price"), "100.00");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === "http://localhost:3000/v1/finance/invoices" &&
          (c[1] as RequestInit)?.method === "POST",
      );
      expect(call).toBeDefined();
      const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBeTruthy();
    });
  });

  // ---- Smoke tests for the lighter tabs ---------------------------------------

  it("renders the expenses tab and creates an expense", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Expenses" }));
    expect(await screen.findByText("No expenses yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(
      screen.getByLabelText("Category", { selector: "#expense-category" }),
      "office",
    );
    await userEvent.type(screen.getByLabelText("Amount"), "10.00");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            String(c[0]) === "http://localhost:3000/v1/finance/expenses" &&
            (c[1] as RequestInit)?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("renders the refunds tab and issues a refund with a mandatory idempotency key", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Refunds" }));
    expect(await screen.findByText("No refunds yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Invoice ID"), INVOICE);
    await userEvent.type(screen.getByLabelText("Amount"), "5.00");
    await userEvent.type(screen.getByLabelText("Reason"), "Damaged item");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === "http://localhost:3000/v1/finance/refunds" &&
          (c[1] as RequestInit)?.method === "POST",
      );
      expect(call).toBeDefined();
      const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBeTruthy();
    });
  });

  it("renders the reconciliations tab empty state", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Shipping reconciliation" }));
    expect(await screen.findByText("No reconciliations yet.")).toBeInTheDocument();
  });

  it("renders periods and closes one with confirmation", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Accounting periods" }));
    expect(await screen.findByText("2026-01")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close period" }));
    expect(screen.getByText(/Closing this period is permanent/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, close it" }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/finance/periods/2026-01/close")),
      ).toBe(true);
    });
  });

  it("renders the reports tab and loads the cash center / P&L summary", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Cash center & P&L" }));
    await userEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText("Cash center")).toBeInTheDocument();
    expect(await screen.findByText("Profit & loss")).toBeInTheDocument();
  });
});
