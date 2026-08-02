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
import { AnalyticsPage } from "./analytics-page";

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

function renderPage(
  features = ["analytics"],
  permissions = ["analytics.read", "analytics.manage"],
) {
  return render(
    <I18nProvider>
      <ToastProvider>{caps(features, permissions, <AnalyticsPage />)}</ToastProvider>
    </I18nProvider>,
  );
}

const BUSINESS = {
  orderCount: 10,
  collectedMinor: 100000,
  averageOrderValueMinor: 10000,
  orderCountDeltaPct: 12.5,
  collectedDeltaPct: null,
  series: [{ bucket: "2026-01-01T00:00:00.000Z", orderCount: 10, collectedMinor: 100000 }],
  granularity: "day",
};

const STAFF = {
  rows: [{ assigneeId: "u1", assigneeName: "Amina", orderCount: 3, collectedMinor: 30000 }],
};

const PRODUCTS = {
  top: [
    {
      variantId: "v1",
      productName: "Widget",
      variantName: "Red",
      unitsSold: 5,
      revenueMinor: 5000,
    },
  ],
  bottom: [],
};

const INVENTORY = {
  onHandValueMinor: 500000,
  lowStockCount: 2,
  outOfStockCount: 1,
  turnoverSignal: 0.25,
};

const PROFITABILITY = {
  current: {
    collectedMinor: 100000,
    cogsMinor: 40000,
    expensesMinor: 20000,
    netIncomeMinor: 40000,
  },
  previous: {
    collectedMinor: 80000,
    cogsMinor: 30000,
    expensesMinor: 20000,
    netIncomeMinor: 30000,
  },
  netIncomeDeltaPct: 33.33,
};

describe("AnalyticsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn().mockResolvedValue(json(200, BUSINESS));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the forbidden fallback without the analytics feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to analytics.")).toBeTruthy();
  });

  it("loads and renders the business axis by default", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    expect(fetchMock.mock.calls[0]![0] as string).toContain("/analytics/business");
  });

  it("switches tabs and fetches the staff axis", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes("/analytics/staff") ? json(200, STAFF) : json(200, BUSINESS)),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Staff" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/analytics/staff"))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(screen.getByText("Amina")).toBeTruthy());
  });

  it("switches to the products tab and renders top performers", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/analytics/products") ? json(200, PRODUCTS) : json(200, BUSINESS),
      ),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Products" }));
    await waitFor(() => expect(screen.getByText(/Widget/)).toBeTruthy());
  });

  it("switches to the inventory tab and renders stock health", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/analytics/inventory") ? json(200, INVENTORY) : json(200, BUSINESS),
      ),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Inventory" }));
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy());
  });

  it("switches to the profitability tab and renders net income", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/analytics/profitability") ? json(200, PROFITABILITY) : json(200, BUSINESS),
      ),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Profitability" }));
    await waitFor(() => expect(screen.getAllByText("400.00").length).toBeGreaterThan(0));
  });

  it("triggers an export request when Export CSV is clicked", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("10")).toBeTruthy());
    fetchMock.mockResolvedValueOnce(new Response(new Blob(["a,b\r\n"]), { status: 200 }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/analytics/export"))).toBe(
        true,
      ),
    );
  });
});
