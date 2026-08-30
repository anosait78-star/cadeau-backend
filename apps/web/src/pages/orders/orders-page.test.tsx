import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { ToastProvider } from "@/components/toast/toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { OrdersPage } from "./orders-page";

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

/** Open a Combobox by its trigger's accessible name and click a matching option. */
async function pickCombobox(
  user: ReturnType<typeof userEvent.setup>,
  triggerLabel: string,
  optionName: string,
): Promise<void> {
  await user.click(screen.getByLabelText(triggerLabel));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

function renderPage(features = ["orders"], permissions = ["orders.read", "orders.manage"]) {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>{caps(features, permissions, <OrdersPage />)}</ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const ORDER_ROW = {
  id: "o1",
  orderNumber: 1042,
  customerId: "c1",
  customerName: "Sara",
  assigneeId: null,
  status: "new",
  followUpState: "none",
  labelId: null,
  reasonId: null,
  governorateId: null,
  itemCount: 2,
  subtotal: 30000,
  shippingFee: 5000,
  discount: 0,
  total: 35000,
  collectedAmount: 0,
  paymentStatus: "unpaid",
  statusChangedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const ORDER_DETAIL = {
  ...ORDER_ROW,
  notes: null,
  items: [
    {
      id: "i1",
      variantId: "v1",
      nameSnapshot: "T — L",
      quantity: 2,
      price: 15000,
      costSnapshot: 8000,
    },
  ],
};

const ORDERS_PAGE = { data: [ORDER_ROW], page: { limit: 25, nextCursor: null, hasMore: false } };
const COUNTS = { counts: { new: 1, processing: 0 } };
const CUSTOMER_DETAIL = {
  id: "c1",
  name: "Sara",
  phone: "+201001234567",
  email: null,
  notes: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ordersCount: 1,
  totalSpent: 35000,
  lastOrderAt: null,
  addresses: [],
};
const SHIPMENT = {
  id: "s1",
  orderId: "o1",
  carrier: "manual",
  trackingNumber: "MAN-ABC123",
  status: "created",
  fee: 0,
  waybillIssued: false,
  deliveredAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const ACTIVITY = {
  data: [
    {
      id: "act1",
      kind: "created",
      fromValue: null,
      toValue: "new",
      note: null,
      actorId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

describe("OrdersPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  /** Mutable per-test shipment fixture for GET /shipping/orders/o1/shipment. */
  let shipment: typeof SHIPMENT | null;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("cadeau.locale", "en");
    // Exercise the desktop DataGrid shell (ADR-002) — jsdom has no real
    // viewport, so force the ≥1024px media query to match.
    window.matchMedia = ((query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    shipment = null;
    fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/master-data/order-labels"))
        return Promise.resolve(json(200, { data: [], page: {} }));
      if (url.includes("/master-data/governorates"))
        return Promise.resolve(json(200, { data: [], page: {} }));
      if (url.includes("/warehouses")) {
        return Promise.resolve(
          json(200, {
            data: [
              {
                id: "w1",
                name: "Main",
                code: null,
                address: null,
                isDefault: true,
                active: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            page: {},
          }),
        );
      }
      if (url.includes("/orders/status-counts")) return Promise.resolve(json(200, COUNTS));
      if (url.match(/\/orders\/o1\/activity/)) return Promise.resolve(json(200, ACTIVITY));
      if (url.match(/\/orders\/o1\/vendor-groups/)) return Promise.resolve(json(200, { data: [] }));
      if (url.match(/\/shipping\/carriers$/) && method === "GET") {
        return Promise.resolve(
          json(200, {
            data: [
              { key: "manual", connected: true, pickupLocationWarning: false, connectedAt: null },
              { key: "bosta", connected: false, pickupLocationWarning: false, connectedAt: null },
            ],
          }),
        );
      }
      if (url.match(/\/shipping\/orders\/o1\/shipment$/) && method === "GET") {
        return Promise.resolve(
          shipment === null
            ? json(404, { error: { code: "NOT_FOUND", statusCode: 404 } })
            : json(200, shipment),
        );
      }
      if (url.match(/\/shipping\/shipments$/) && method === "POST") {
        shipment = { ...SHIPMENT };
        return Promise.resolve(json(201, shipment));
      }
      if (url.match(/\/shipping\/shipments\/s1\/status$/) && method === "POST") {
        const body =
          init?.body !== undefined
            ? (JSON.parse(String(init.body)) as { toStatus: string })
            : { toStatus: "created" };
        shipment = { ...SHIPMENT, status: body.toStatus };
        return Promise.resolve(json(200, shipment));
      }
      if (url.match(/\/shipping\/shipments\/s1\/waybill$/) && method === "POST") {
        if (shipment !== null) shipment = { ...shipment, waybillIssued: true };
        return Promise.resolve(
          json(200, { shipmentId: "s1", carrier: "manual", trackingNumber: "MAN-ABC123" }),
        );
      }
      if (url.match(/\/reviews\/orders\/o1$/) && method === "GET") {
        return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
      }
      if (url.match(/\/orders\/o1\/status$/) && method === "POST") {
        return Promise.resolve(json(200, { ...ORDER_DETAIL, status: "processing" }));
      }
      if (url.match(/\/orders\/bulk\/status$/) && method === "POST") {
        const body =
          init?.body !== undefined
            ? (JSON.parse(String(init.body)) as { orderIds: string[] })
            : { orderIds: [] };
        return Promise.resolve(
          json(200, { results: body.orderIds.map((id) => ({ orderId: id, ok: true })) }),
        );
      }
      if (url.match(/\/orders\/bulk\/assign$/) && method === "POST") {
        const body =
          init?.body !== undefined
            ? (JSON.parse(String(init.body)) as { orderIds: string[] })
            : { orderIds: [] };
        return Promise.resolve(
          json(200, { results: body.orderIds.map((id) => ({ orderId: id, ok: true })) }),
        );
      }
      if (url.match(/\/orders\/o1$/) && method === "PATCH") {
        return Promise.resolve(
          json(200, { ...ORDER_DETAIL, collectedAmount: 35000, paymentStatus: "paid" }),
        );
      }
      if (url.match(/\/orders\/o1$/) && method === "GET")
        return Promise.resolve(json(200, ORDER_DETAIL));
      if (url.match(/\/orders\/parse$/) && method === "POST") {
        return Promise.resolve(
          json(200, {
            name: "Sara",
            phone: "+201001234567",
            address: null,
            items: [{ name: "Shirt", quantity: 2 }],
            notes: null,
          }),
        );
      }
      if (url.includes("/orders") && method === "POST") {
        return Promise.resolve(json(201, { ...ORDER_DETAIL, id: "o2", orderNumber: 1043 }));
      }
      if (url.includes("/orders") && method === "GET")
        return Promise.resolve(json(200, ORDERS_PAGE));
      if (url.match(/\/customers\/c1$/)) return Promise.resolve(json(200, CUSTOMER_DETAIL));
      if (url.includes("/customers")) {
        return Promise.resolve(
          json(200, { data: [{ ...ORDER_ROW, id: "c1", name: "Sara" }], page: {} }),
        );
      }
      if (url.match(/\/products\/p1$/)) {
        return Promise.resolve(
          json(200, { id: "p1", name: "Shirt", variants: [{ id: "v1", name: "L" }] }),
        );
      }
      if (url.includes("/products")) {
        return Promise.resolve(json(200, { data: [{ id: "p1", name: "Shirt" }], page: {} }));
      }
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists orders with number, customer and status", async () => {
    renderPage();
    expect(await screen.findByText("#1042")).toBeInTheDocument();
    expect(screen.getByText("Sara")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("New");
  });

  it("shows the status tabs with live counts", async () => {
    renderPage();
    await screen.findByText("#1042");
    const tab = screen.getByRole("tab", { name: /New/ });
    expect(tab).toHaveTextContent("1");
  });

  it("renders the KPI row from status counts", async () => {
    renderPage();
    await screen.findByText("#1042");
    const kpiRow = await screen.findByTestId("orders-kpi-row");
    expect(within(kpiRow).getByText("Processing")).toBeInTheDocument();
  });

  it("hides the create button without orders.manage", async () => {
    renderPage(["orders"], ["orders.read"]);
    await screen.findByText("#1042");
    expect(screen.queryByRole("button", { name: "New order" })).not.toBeInTheDocument();
  });

  it("opens the detail panel on row click without navigating, and loads items/activity/payments", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByText("Sara"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Order no. 1042" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(await screen.findByText(/T — L × 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Activities" }));
    expect(await screen.findByText(/created/)).toBeInTheDocument();
  });

  it("bulk-changes status: selecting a row shows the bar, and a valid transition calls the API and reloads", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getAllByRole("checkbox", { name: "Select row" })[0] as HTMLElement);
    await user.click(await screen.findByRole("button", { name: "Change status" }));
    await user.click(await screen.findByRole("menuitem", { name: /Processing/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/orders\/bulk\/status$/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // The list reloads after a successful bulk action.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([u]) => String(u).match(/\/orders\?/) !== null).length,
      ).toBeGreaterThan(1),
    );
  });

  it("offers 'Create shipment' only for a single selected row, opening the per-order carrier dialog (no bulk shipping)", async () => {
    const user = userEvent.setup();
    renderPage(["orders", "shipping"], ["orders.read", "orders.manage", "shipping.manage"]);
    await screen.findByText("#1042");
    await user.click(screen.getAllByRole("checkbox", { name: "Select row" })[0] as HTMLElement);

    const createShipmentButton = await screen.findByRole("button", { name: "Create shipment" });
    await user.click(createShipmentButton);

    expect(await screen.findByText("Select a shipping carrier")).toBeInTheDocument();
    // No bulk shipment endpoint is ever called from this flow.
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).match(/\/shipping\/shipments\/bulk$/) !== null),
    ).toBe(false);
  });

  it("surfaces an error instead of doing nothing when the bulk request fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => Promise.resolve(json(200, ORDERS_PAGE)));
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getAllByRole("checkbox", { name: "Select row" })[0] as HTMLElement);
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("network down")));
    await user.click(await screen.findByRole("button", { name: "Change status" }));
    await user.click(await screen.findByRole("menuitem", { name: /Processing/ }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("the row-actions menu only offers Details (status changes live on the order itself)", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "Row actions" }));
    expect(await screen.findByRole("menuitem", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Processing/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Cancelled/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Details" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the create form and blocks submit until a customer and a line exist", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "New order" }));
    expect(await screen.findByText("Product / variant")).toBeInTheDocument();
    // Wait for the async warehouse fetch to resolve and auto-select the default.
    expect(await screen.findByLabelText("Warehouse")).toHaveTextContent("Main");
    // Save is disabled with no customer and no lines.
    const saves = screen.getAllByRole("button", { name: "Save" });
    expect(saves[saves.length - 1]).toBeDisabled();
  });

  it("collects a COD amount from the Payments tab", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByText("Sara"));
    await user.click(await screen.findByRole("tab", { name: "Payments" }));
    const input = await screen.findByLabelText("Collect amount");
    await user.type(input, "350");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/orders\/o1$/),
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("creates an order: pick a customer, add a line, submit", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "New order" }));

    // The warehouse auto-selects the company's default.
    expect(await screen.findByLabelText("Warehouse")).toHaveTextContent("Main");

    // The customer + variant comboboxes populate from the reference fetches.
    await pickCombobox(user, "Customer", "Sara");
    await pickCombobox(user, "Product / variant", "Shirt — L");
    await user.click(screen.getByRole("button", { name: "Add line" }));

    const saves = screen.getAllByRole("button", { name: "Save" });
    await user.click(saves[saves.length - 1]!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/orders$/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = fetchMock.mock.calls.find(
      ([u, i]) => String(u).match(/\/orders$/) !== null && (i as RequestInit)?.method === "POST",
    );
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as { warehouseId: string };
    expect(body.warehouseId).toBe("w1");
  });

  it("blocks submit until a warehouse is chosen when there is no default", async () => {
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/warehouses")) {
        return Promise.resolve(
          json(200, {
            data: [
              {
                id: "w1",
                name: "Main",
                code: null,
                address: null,
                isDefault: false,
                active: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
              {
                id: "w2",
                name: "Annex",
                code: null,
                address: null,
                isDefault: false,
                active: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            page: {},
          }),
        );
      }
      if (url.includes("/orders/status-counts")) return Promise.resolve(json(200, COUNTS));
      if (url.includes("/orders") && method === "GET")
        return Promise.resolve(json(200, ORDERS_PAGE));
      if (url.includes("/customers")) {
        return Promise.resolve(
          json(200, { data: [{ ...ORDER_ROW, id: "c1", name: "Sara" }], page: {} }),
        );
      }
      if (url.match(/\/products\/p1$/)) {
        return Promise.resolve(
          json(200, { id: "p1", name: "Shirt", variants: [{ id: "v1", name: "L" }] }),
        );
      }
      if (url.includes("/products")) {
        return Promise.resolve(json(200, { data: [{ id: "p1", name: "Shirt" }], page: {} }));
      }
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "New order" }));
    const warehouse = await screen.findByLabelText("Warehouse");
    expect(warehouse).toHaveTextContent("—");

    await pickCombobox(user, "Customer", "Sara");
    await pickCombobox(user, "Product / variant", "Shirt — L");
    await user.click(screen.getByRole("button", { name: "Add line" }));

    const saves = screen.getAllByRole("button", { name: "Save" });
    expect(saves[saves.length - 1]).toBeDisabled();
    await pickCombobox(user, "Warehouse", "Main");
    expect(saves[saves.length - 1]).not.toBeDisabled();
  });

  it("shows Paid Amount only for a non-Unpaid status, and validates it against the total", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "New order" }));
    await screen.findByLabelText("Warehouse");

    await pickCombobox(user, "Customer", "Sara");
    await pickCombobox(user, "Product / variant", "Shirt — L");
    await user.click(screen.getByRole("button", { name: "Add line" }));

    expect(screen.queryByLabelText("Paid amount")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Payment status"), "paid");
    const paid = await screen.findByLabelText("Paid amount");
    await user.clear(paid);
    await user.type(paid, "10");

    const saves = screen.getAllByRole("button", { name: "Save" });
    expect(saves[saves.length - 1]).toBeDisabled();
    expect(
      screen.getByText("Paid amount doesn't match the selected payment status."),
    ).toBeInTheDocument();
  });

  it("computes Remaining Amount live as the paid amount and discount change", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "New order" }));
    await screen.findByLabelText("Warehouse");

    await pickCombobox(user, "Customer", "Sara");
    await pickCombobox(user, "Product / variant", "Shirt — L");
    await user.click(screen.getByRole("button", { name: "Add line" }));

    await user.selectOptions(screen.getByLabelText("Payment status"), "partial");
    const paid = await screen.findByLabelText("Paid amount");
    await user.clear(paid);
    await user.type(paid, "1");
    const remaining = screen.getByLabelText("Remaining amount");
    expect(remaining).toHaveValue("-1.00");
  });

  it("keeps notes optional and sends them when filled", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "New order" }));
    await screen.findByLabelText("Warehouse");

    await pickCombobox(user, "Customer", "Sara");
    await pickCombobox(user, "Product / variant", "Shirt — L");
    await user.click(screen.getByRole("button", { name: "Add line" }));
    await user.type(screen.getByLabelText("Notes"), "Deliver after 6pm");

    const saves = screen.getAllByRole("button", { name: "Save" });
    await user.click(saves[saves.length - 1]!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/orders$/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = fetchMock.mock.calls.find(
      ([u, i]) => String(u).match(/\/orders$/) !== null && (i as RequestInit)?.method === "POST",
    );
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as { notes: string };
    expect(body.notes).toBe("Deliver after 6pm");
  });

  it("creates a new customer inline from the order form", async () => {
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/master-data/governorates"))
        return Promise.resolve(json(200, { data: [], page: {} }));
      if (url.includes("/warehouses")) {
        return Promise.resolve(
          json(200, {
            data: [
              {
                id: "w1",
                name: "Main",
                code: null,
                address: null,
                isDefault: true,
                active: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            page: {},
          }),
        );
      }
      if (url.includes("/orders/status-counts")) return Promise.resolve(json(200, COUNTS));
      if (url.includes("/orders") && method === "GET")
        return Promise.resolve(json(200, ORDERS_PAGE));
      if (url.match(/\/customers\/new1\/addresses$/) && method === "POST") {
        return Promise.resolve(
          json(201, { id: "addr1", customerId: "new1", line: "Cairo, 1 Main St" }),
        );
      }
      if (url.includes("/customers") && method === "POST") {
        return Promise.resolve(
          json(201, {
            id: "new1",
            name: "Mona",
            phone: "+201009998888",
            email: null,
            notes: null,
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            ordersCount: 0,
            totalSpent: 0,
            lastOrderAt: null,
            addresses: [],
          }),
        );
      }
      if (url.includes("/customers")) {
        return Promise.resolve(
          json(200, { data: [{ ...ORDER_ROW, id: "c1", name: "Sara" }], page: {} }),
        );
      }
      if (url.match(/\/products\/p1$/)) {
        return Promise.resolve(
          json(200, { id: "p1", name: "Shirt", variants: [{ id: "v1", name: "L" }] }),
        );
      }
      if (url.includes("/products")) {
        return Promise.resolve(json(200, { data: [{ id: "p1", name: "Shirt" }], page: {} }));
      }
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "New order" }));
    await screen.findByLabelText("Warehouse");

    await user.click(screen.getByRole("button", { name: "New customer" }));
    await user.type(await screen.findByLabelText("Name"), "Mona");
    await user.type(screen.getByLabelText("Phone"), "01009998888");
    await user.type(screen.getByLabelText("City"), "Cairo");
    await user.type(screen.getByLabelText("Street address"), "1 Main St");
    await user.click(screen.getByRole("button", { name: "Save customer" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/customers$/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/customers\/new1\/addresses$/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByLabelText("Customer")).toHaveTextContent("Mona");
  });

  it("runs deterministic smart-paste and shows the detected fields", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "New order" }));
    await user.type(await screen.findByLabelText("Smart paste (from a chat)"), "Sara 01001234567");
    await user.click(screen.getByRole("button", { name: "Detect" }));
    const detected = await screen.findByTestId("paste-detected");
    expect(detected).toHaveTextContent("+201001234567");
    expect(detected).toHaveTextContent("2× Shirt");
  });

  it("shows the forbidden fallback without the orders feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to orders.")).toBeInTheDocument();
  });

  describe("shipment section (EPIC-12 M12.5)", () => {
    const SHIPPING_FEATURES = ["orders", "shipping"];
    const SHIPPING_PERMISSIONS = [
      "orders.read",
      "orders.manage",
      "shipping.read",
      "shipping.manage",
    ];

    it("hides the Shipping tab's section content without the shipping feature", async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText("#1042");
      await user.click(screen.getByText("Sara"));
      await user.click(await screen.findByRole("tab", { name: "Shipping" }));
      expect(screen.queryByText("No shipment yet.")).not.toBeInTheDocument();
    });

    it("shows 'no shipment yet' and creates one", async () => {
      const user = userEvent.setup();
      renderPage(SHIPPING_FEATURES, SHIPPING_PERMISSIONS);
      await screen.findByText("#1042");
      await user.click(screen.getByText("Sara"));
      await user.click(await screen.findByRole("tab", { name: "Shipping" }));
      expect(await screen.findByText("No shipment yet.")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Create shipment" }));
      await screen.findByText("Select a shipping carrier");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(await screen.findByText("MAN-ABC123")).toBeInTheDocument();
      expect(screen.getByText("manual")).toBeInTheDocument();
    });

    it("advances shipment status through the manual select", async () => {
      const user = userEvent.setup();
      shipment = { ...SHIPMENT };
      renderPage(SHIPPING_FEATURES, SHIPPING_PERMISSIONS);
      await screen.findByText("#1042");
      await user.click(screen.getByText("Sara"));
      await user.click(await screen.findByRole("tab", { name: "Shipping" }));
      await screen.findByText("MAN-ABC123");

      const selects = screen.getAllByRole("combobox");
      const advance = selects[selects.length - 1]!;
      await user.selectOptions(advance, "picked_up");
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringMatching(/\/shipping\/shipments\/s1\/status$/),
          expect.objectContaining({ method: "POST" }),
        ),
      );
    });

    it("issues a waybill", async () => {
      const user = userEvent.setup();
      shipment = { ...SHIPMENT };
      renderPage(SHIPPING_FEATURES, SHIPPING_PERMISSIONS);
      await screen.findByText("#1042");
      await user.click(screen.getByText("Sara"));
      await user.click(await screen.findByRole("tab", { name: "Shipping" }));
      await screen.findByText("MAN-ABC123");

      await user.click(screen.getByRole("button", { name: "Waybill" }));
      await waitFor(() => expect(screen.getAllByText("Waybill issued").length).toBeGreaterThan(0));
      expect(screen.queryByRole("button", { name: "Waybill" })).not.toBeInTheDocument();
    });

    it("hides manage actions without shipping.manage, but still shows tracking", async () => {
      const user = userEvent.setup();
      shipment = { ...SHIPMENT };
      renderPage(["orders", "shipping"], ["orders.read", "orders.manage", "shipping.read"]);
      await screen.findByText("#1042");
      await user.click(screen.getByText("Sara"));
      await user.click(await screen.findByRole("tab", { name: "Shipping" }));
      await screen.findByText("MAN-ABC123");
      expect(screen.queryByRole("button", { name: "Waybill" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Create shipment" })).not.toBeInTheDocument();
    });
  });
});
