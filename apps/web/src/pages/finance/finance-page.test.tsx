import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { ToastProvider } from "@/components/toast/toast";
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
  return render(
    <I18nProvider>
      <ToastProvider>{caps(features, permissions, <FinancePage />)}</ToastProvider>
    </I18nProvider>,
  );
}

/**
 * Sets a date field by driving the app's own DatePicker — open the calendar and
 * click a day — since it replaced the native `input[type=date]` a phone renders
 * as an LTR, US-ordered control inside an RTL screen.
 */
async function pickAnyDay(fieldLabel: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: fieldLabel }));
  await userEvent.click(await screen.findByRole("button", { name: "15" }));
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

const SUPPLIER_2 = "77777777-7777-7777-7777-777777777777";
const SUPPLIERS_PAGE_1 = {
  data: SUPPLIERS.data,
  page: { limit: 25, nextCursor: "sup-2", hasMore: true },
};
const SUPPLIERS_PAGE_2 = {
  data: [
    {
      id: SUPPLIER_2,
      name: "Beta Supplies",
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

const RECON_1 = {
  id: "recon-1",
  carrier: "Aramex",
  statementRef: "STMT-1",
  periodKey: "2026-01",
  totalStatementMinor: 10000,
  totalFeeMinor: 9000,
  totalVarianceMinor: 1000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const RECON_2 = {
  ...RECON_1,
  id: "recon-2",
  carrier: "Bosta",
  statementRef: "STMT-2",
};
const RECON_PAGE_1 = {
  data: [RECON_1],
  page: { limit: 25, nextCursor: "recon-2", hasMore: true },
};
const RECON_PAGE_2 = {
  data: [RECON_2],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const EXPENSE_1 = {
  id: "exp-1",
  category: "printing",
  amountMinor: 2500,
  incurredAt: "2026-01-05T00:00:00.000Z",
  notes: "Business cards",
  supplierId: SUPPLIER,
  createdAt: "2026-01-05T00:00:00.000Z",
  updatedAt: "2026-01-05T00:00:00.000Z",
};
const EXPENSE_2 = { ...EXPENSE_1, id: "exp-2", category: "shipping supplies", supplierId: null };
const EXPENSE_PAGE_1 = {
  data: [EXPENSE_1],
  page: { limit: 25, nextCursor: "exp-2", hasMore: true },
};
const EXPENSE_PAGE_2 = {
  data: [EXPENSE_2],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

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
    if (url.match(/\/finance\/suppliers\/[^/]+$/) && method === "PATCH") {
      return Promise.resolve(json(200, { ...SUPPLIERS.data[0], name: "Acme Renamed" }));
    }
    if (url.match(/\/finance\/suppliers\/[^/]+$/) && method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.includes("/finance/suppliers") && url.includes("cursor=sup-2")) {
      return Promise.resolve(json(200, SUPPLIERS_PAGE_2));
    }
    if (url.includes("/finance/suppliers") && url.includes("q=beta")) {
      return Promise.resolve(json(200, SUPPLIERS_PAGE_2));
    }
    if (url.includes("/finance/suppliers")) return Promise.resolve(json(200, SUPPLIERS_PAGE_1));

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
    if (url.match(/\/finance\/expenses\/[^/]+$/) && method === "PATCH") {
      return Promise.resolve(json(200, { ...EXPENSE_1, category: "office supplies" }));
    }
    if (url.includes("/finance/expenses") && url.includes("cursor=exp-2")) {
      return Promise.resolve(json(200, EXPENSE_PAGE_2));
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

    if (url.includes("/finance/reconciliations") && method === "POST") {
      return Promise.resolve(
        json(201, {
          ...RECON_1,
          id: "recon-3",
          lines: [
            {
              id: "rl1",
              shipmentId: "s1",
              statementAmountMinor: 500,
              shipmentFeeMinor: 450,
              varianceMinor: 50,
            },
          ],
        }),
      );
    }
    if (url.includes("/finance/reconciliations") && url.includes("cursor=recon-2")) {
      return Promise.resolve(json(200, RECON_PAGE_2));
    }
    if (url.includes("/finance/reconciliations")) return Promise.resolve(json(200, RECON_PAGE_1));

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
          ...(url.includes("compareFrom")
            ? {
                previous: {
                  revenueMinor: 80000,
                  cogsMinor: 30000,
                  expensesMinor: 15000,
                  netIncomeMinor: 35000,
                },
              }
            : {}),
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
    await userEvent.click(screen.getByLabelText("Supplier", { selector: "#po-create-supplier" }));
    await userEvent.click(await screen.findByRole("option", { name: "Acme Trading" }));
    await userEvent.click(screen.getByLabelText("Variant"));
    await userEvent.click(await screen.findByRole("option", { name: "Mug — Small" }));
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
    await userEvent.click(screen.getByLabelText("Warehouse"));
    await userEvent.click(await screen.findByRole("option", { name: "Main" }));
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
    // Date defaults to today (already a valid value); the DatePicker is
    // calendar-only, and the assertion below doesn't check incurredAt.
    await userEvent.type(screen.getByLabelText("Notes"), "Printer paper");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === "http://localhost:3000/v1/finance/expenses" &&
          (c[1] as RequestInit)?.method === "POST",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        category: "office",
        notes: "Printer paper",
      });
    });
  });

  it("cancels the expense create form", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Expenses" }));
    await screen.findByText("No expenses yet.");
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
  });

  it("lists an expense, edits it, and loads a second page", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    fetchMock.mockImplementationOnce(() => Promise.resolve(json(200, EXPENSE_PAGE_1)));
    await userEvent.click(screen.getByRole("tab", { name: "Expenses" }));
    expect(await screen.findByText("printing")).toBeInTheDocument();
    expect(screen.getByText("Business cards")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("shipping supplies")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[0] as HTMLElement);
    const categoryInput = screen.getByLabelText("Category", {
      selector: "#expense-category",
    }) as HTMLInputElement;
    expect(categoryInput.value).toBe("printing");
    await userEvent.clear(categoryInput);
    await userEvent.type(categoryInput, "office supplies");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]).includes("/finance/expenses/exp-1") &&
          (c[1] as RequestInit)?.method === "PATCH",
      );
      expect(call).toBeDefined();
    });
  });

  it("shows an error state for expenses and retries", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    const baseImpl = fetchMock.getMockImplementation();
    let failNext = true;
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (failNext && url.includes("/finance/expenses") && method === "GET") {
        failNext = false;
        return Promise.resolve(json(500, { error: { code: "INTERNAL", statusCode: 500 } }));
      }
      return baseImpl!(input, init);
    });
    await userEvent.click(screen.getByRole("tab", { name: "Expenses" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No expenses yet.")).toBeInTheDocument();
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
    await screen.findByText("Acme Trading");
    fetchMock.mockImplementationOnce(() => Promise.resolve(json(200, EMPTY_PAGE)));
    await userEvent.click(screen.getByRole("tab", { name: "Shipping reconciliation" }));
    expect(await screen.findByText("No reconciliations yet.")).toBeInTheDocument();
  });

  it("lists reconciliations and loads a second page", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Shipping reconciliation" }));
    expect(await screen.findByText("Aramex")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Bosta")).toBeInTheDocument();
  });

  it("creates a reconciliation with a tracking line", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Shipping reconciliation" }));
    await screen.findByText("Aramex");
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Carrier"), "DHL");
    await userEvent.type(screen.getByLabelText("Statement reference"), "STMT-9");
    await userEvent.type(screen.getByLabelText("Period (YYYY-MM)"), "2026-02");
    await userEvent.type(screen.getByLabelText("Tracking number"), "TRK-1");
    await userEvent.type(screen.getByLabelText("Statement amount"), "5.00");
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(screen.getByText("TRK-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === "http://localhost:3000/v1/finance/reconciliations" &&
          (c[1] as RequestInit)?.method === "POST",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        carrier: "DHL",
        statementRef: "STMT-9",
        periodKey: "2026-02",
        lines: [{ trackingNumber: "TRK-1", statementAmountMinor: 500 }],
      });
    });
  });

  it("cancels a reconciliation create form", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Shipping reconciliation" }));
    await screen.findByText("Aramex");
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Carrier"), "DHL");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Carrier")).not.toBeInTheDocument();
  });

  it("shows an error state for reconciliations and retries", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    const baseImpl = fetchMock.getMockImplementation();
    let failNext = true;
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (failNext && url.includes("/finance/reconciliations") && method === "GET") {
        failNext = false;
        return Promise.resolve(json(500, { error: { code: "INTERNAL", statusCode: 500 } }));
      }
      return baseImpl!(input, init);
    });
    await userEvent.click(screen.getByRole("tab", { name: "Shipping reconciliation" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Aramex")).toBeInTheDocument();
  });

  // ---- Suppliers (extra coverage) ---------------------------------------------

  it("edits a supplier", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Acme Trading");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Acme Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]).includes(`/finance/suppliers/${SUPPLIER}`) &&
          (c[1] as RequestInit)?.method === "PATCH",
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        name: "Acme Renamed",
      });
    });
  });

  it("cancels editing a supplier", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Acme Trading")).toBeInTheDocument();
  });

  it("filters suppliers by search text and the active-only toggle", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    await userEvent.click(screen.getByLabelText("Active only"));
    await userEvent.type(screen.getByLabelText("Search by name…"), "beta");
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) => String(c[0]).includes("/finance/suppliers") && String(c[0]).includes("q=beta"),
        ),
      ).toBe(true);
    });
    expect(await screen.findByText("Beta Supplies")).toBeInTheDocument();
  });

  it("loads a second page of suppliers", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Beta Supplies")).toBeInTheDocument();
  });

  it("shows a save-failed notice when creating a supplier fails", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    const baseImpl = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/finance/suppliers") && method === "POST") {
        return Promise.resolve(json(500, { error: { code: "INTERNAL", statusCode: 500 } }));
      }
      return baseImpl!(input, init);
    });
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Name"), "Failing Co");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not save. Please try again.")).toBeInTheDocument();
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

  it("loads a comparison range and shows the previous period", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Cash center & P&L" }));
    // The comparison is requested whenever both compare dates are set; which
    // days they are is the mocked response's business, not this test's.
    await pickAnyDay("Compare from");
    await pickAnyDay("Compare to");
    await userEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText("Previous period")).toBeInTheDocument();
  });

  it("shows a save-failed notice when loading reports fails", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Cash center & P&L" }));
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(json(500, { error: { code: "INTERNAL", statusCode: 500 } })),
    );
    await userEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByText("Could not save. Please try again.")).toBeInTheDocument();
  });

  // ---- Refunds (extra coverage) ------------------------------------------------

  it("disables save for an invalid refund and re-enables once valid", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Refunds" }));
    await screen.findByText("No refunds yet.");
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Order ID"), "order-1");
    await userEvent.type(screen.getByLabelText("Amount"), "5.00");
    await userEvent.type(screen.getByLabelText("Reason"), "Damaged item");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("cancels the refund create form", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Refunds" }));
    await screen.findByText("No refunds yet.");
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
  });

  it("shows a save-failed notice when a refund fails", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Refunds" }));
    await screen.findByText("No refunds yet.");
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText("Invoice ID"), INVOICE);
    await userEvent.type(screen.getByLabelText("Amount"), "5.00");
    await userEvent.type(screen.getByLabelText("Reason"), "Damaged item");
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(json(500, { error: { code: "INTERNAL", statusCode: 500 } })),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not save. Please try again.")).toBeInTheDocument();
  });

  it("shows an error state for refunds and retries", async () => {
    renderPage();
    await screen.findByText("Acme Trading");
    const baseImpl = fetchMock.getMockImplementation();
    let failNext = true;
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (failNext && url.includes("/finance/refunds") && method === "GET") {
        failNext = false;
        return Promise.resolve(json(500, { error: { code: "INTERNAL", statusCode: 500 } }));
      }
      return baseImpl!(input, init);
    });
    await userEvent.click(screen.getByRole("tab", { name: "Refunds" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No refunds yet.")).toBeInTheDocument();
  });
});
