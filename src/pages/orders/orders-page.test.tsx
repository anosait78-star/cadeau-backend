import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
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

function renderPage(features = ["orders"], permissions = ["orders.read", "orders.manage"]) {
  return render(<I18nProvider>{caps(features, permissions, <OrdersPage />)}</I18nProvider>);
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

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/orders/status-counts")) return Promise.resolve(json(200, COUNTS));
      if (url.match(/\/orders\/o1\/activity/)) return Promise.resolve(json(200, ACTIVITY));
      if (url.match(/\/orders\/o1\/status$/) && method === "POST") {
        return Promise.resolve(json(200, { ...ORDER_DETAIL, status: "processing" }));
      }
      if (url.match(/\/orders\/o1$/) && method === "PATCH") {
        return Promise.resolve(
          json(200, { ...ORDER_DETAIL, collectedAmount: 35000, paymentStatus: "paid" }),
        );
      }
      if (url.match(/\/orders\/o1$/) && method === "GET")
        return Promise.resolve(json(200, ORDER_DETAIL));
      if (url.includes("/orders") && method === "POST") {
        return Promise.resolve(json(201, { ...ORDER_DETAIL, id: "o2", orderNumber: 1043 }));
      }
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

  it("hides the create button without orders.manage", async () => {
    renderPage(["orders"], ["orders.read"]);
    await screen.findByText("#1042");
    expect(screen.queryByRole("button", { name: "New order" })).not.toBeInTheDocument();
  });

  it("opens the detail panel and loads items + activity", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText(/T — L × 2/)).toBeInTheDocument();
    expect(screen.getByText(/created/)).toBeInTheDocument();
  });

  it("changes status inline through the state machine", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    // The status select offers the legal next states from "new".
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "processing");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/orders\/o1\/status$/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("warns that cancelling needs a reason", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.selectOptions(screen.getByRole("combobox"), "cancelled");
    expect(await screen.findByRole("status")).toHaveTextContent(/reason/i);
  });

  it("opens the create form and blocks submit until a customer and a line exist", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "New order" }));
    expect(await screen.findByText("Product / variant")).toBeInTheDocument();
    // Save is disabled with no customer and no lines.
    const saves = screen.getAllByRole("button", { name: "Save" });
    expect(saves[saves.length - 1]).toBeDisabled();
  });

  it("collects a COD amount from the detail panel", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("#1042");
    await user.click(screen.getByRole("button", { name: "Details" }));
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

    // The customer + variant selects populate from the reference fetches.
    const customer = await screen.findByLabelText("Customer");
    await user.selectOptions(customer, "c1");
    const variant = await screen.findByLabelText("Product / variant");
    await waitFor(() => expect(within(variant).getByText("Shirt — L")).toBeInTheDocument());
    await user.selectOptions(variant, "v1");
    await user.click(screen.getByRole("button", { name: "Add line" }));

    const saves = screen.getAllByRole("button", { name: "Save" });
    await user.click(saves[saves.length - 1]!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/orders$/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows the forbidden fallback without the orders feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to orders.")).toBeInTheDocument();
  });
});

// Silence unused-import lint if `within` is not exercised in a given run.
void within;
