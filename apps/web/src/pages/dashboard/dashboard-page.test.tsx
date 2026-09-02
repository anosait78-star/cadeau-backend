import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { I18nProvider } from "@/i18n/i18n-provider";
import { DashboardPage } from "./dashboard-page";

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

const ALL_FEATURES = ["orders", "customers", "products", "inventory", "analytics", "notifications"];
const ALL_PERMISSIONS = [
  "analytics.read",
  "orders.manage",
  "customers.manage",
  "products.manage",
  "inventory.manage",
];

function renderPage(features = ALL_FEATURES, permissions = ALL_PERMISSIONS) {
  return render(
    <MemoryRouter>
      <I18nProvider>{caps(features, permissions, <DashboardPage />)}</I18nProvider>
    </MemoryRouter>,
  );
}

const ORDER = {
  id: "o1",
  orderNumber: 101,
  customerId: "c1",
  customerName: "Sara",
  assigneeId: null,
  status: "new",
  followUpState: "none",
  labelId: null,
  reasonId: null,
  governorateId: null,
  itemCount: 1,
  subtotal: 1000,
  shippingFee: 0,
  discount: 0,
  total: 1000,
  collectedAmount: 0,
  paymentStatus: "unpaid",
  statusChangedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const STOCK_ROW = {
  id: "s1",
  warehouseId: "w1",
  variantId: "v1",
  variantName: "Red",
  productId: "p1",
  productName: "Shirt",
  sku: "SKU-1",
  imageUrl: null,
  onHand: 2,
  committed: 0,
  available: 2,
  reorderPoint: 5,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mockFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((input: string | URL) => {
    const url = String(input);
    if (url.includes("/orders/status-counts"))
      return Promise.resolve(json(200, { counts: { new: 2, delivered: 1 } }));
    if (url.includes("/orders")) {
      return Promise.resolve(
        json(200, { data: [ORDER], page: { limit: 20, nextCursor: null, hasMore: false } }),
      );
    }
    if (url.includes("/analytics/business")) {
      return Promise.resolve(
        json(200, {
          orderCount: 3,
          collectedMinor: 50000,
          averageOrderValueMinor: 1000,
          orderCountDeltaPct: null,
          collectedDeltaPct: null,
          series: [{ bucket: "2026-01-01", orderCount: 3, collectedMinor: 50000 }],
          granularity: "day",
        }),
      );
    }
    if (url.includes("/inventory/stock")) {
      return Promise.resolve(
        json(200, { data: [STOCK_ROW], page: { limit: 20, nextCursor: null, hasMore: false } }),
      );
    }
    if (url.match(/\/products\/p1\/variants/)) {
      return Promise.resolve(json(200, { data: [{ id: "v1", name: "Red" }] }));
    }
    if (url.includes("/products")) {
      return Promise.resolve(
        json(200, {
          data: [{ id: "p1", name: "Shirt", active: true }],
          page: { limit: 20, nextCursor: null, hasMore: false },
        }),
      );
    }
    if (url.includes("/customers")) {
      return Promise.resolve(
        json(200, {
          data: [{ id: "c1", name: "Sara" }],
          page: { limit: 20, nextCursor: null, hasMore: false },
        }),
      );
    }
    if (url.includes("/notifications")) {
      return Promise.resolve(
        json(200, { data: [], page: { limit: 5, nextCursor: null, hasMore: false } }),
      );
    }
    return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
  });
}

describe("DashboardPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("composes every widget from real API data", async () => {
    renderPage();

    // The period-scoped KPI row, which replaced the old overview tiles.
    const kpiRow = await screen.findByTestId("dashboard-kpi-row");
    expect(within(kpiRow).getByText("500.00")).toBeInTheDocument(); // collected

    // Recent orders + activity, both derived from the same /orders call
    expect(screen.getByText("#101")).toBeInTheDocument();
    expect(screen.getByText(/Order #101/)).toBeInTheDocument();

    // Low stock alert names the product from the stock row itself
    expect(await screen.findByRole("link", { name: "Shirt" })).toBeInTheDocument();

    // Quick actions render as navigable links
    expect(screen.getByRole("link", { name: "New order" })).toHaveAttribute("href", "/orders");
  });

  it("omits gated widgets when their feature is unavailable", async () => {
    renderPage(["orders"], []);
    expect(await screen.findByText("Recent orders")).toBeInTheDocument();
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
    expect(screen.queryByText("Low stock alerts")).not.toBeInTheDocument();
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
  });
});
