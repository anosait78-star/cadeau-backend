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
  route = "/analytics",
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <I18nProvider>
        <ToastProvider>{caps(features, permissions, <AnalyticsPage />)}</ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

const PRODUCTS = {
  top: [
    {
      variantId: "v1",
      productId: "p1",
      imageUrl: null,
      productName: "Widget",
      variantName: "Red",
      unitsSold: 5,
      revenueMinor: 5000,
    },
  ],
  bottom: [],
  totals: {
    activeProducts: 128,
    newProducts: 4,
    unitsSold: 342,
    revenueMinor: 1132500,
    averagePriceMinor: 33100,
  },
  previous: {
    activeProducts: 120,
    newProducts: 2,
    unitsSold: 300,
    revenueMinor: 1000000,
    averagePriceMinor: 33000,
  },
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
  series: [
    {
      bucket: "2026-01-01T00:00:00.000Z",
      collectedMinor: 100000,
      cogsMinor: 40000,
      expensesMinor: 20000,
      netIncomeMinor: 40000,
    },
  ],
  granularity: "day",
};

/** Answers each axis with its own payload, whatever order the page asks in. */
function routeByAxis() {
  return (url: string) =>
    Promise.resolve(
      url.includes("/analytics/profitability") ? json(200, PROFITABILITY) : json(200, PRODUCTS),
    );
}

describe("AnalyticsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn().mockImplementation(routeByAxis());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the forbidden fallback without the analytics feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to analytics.")).toBeTruthy();
  });

  it("opens on the products tab and renders its totals and ranking", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("128")).toBeTruthy());
    expect(fetchMock.mock.calls[0]![0] as string).toContain("/analytics/products");
    expect(screen.getByText("Widget")).toBeTruthy();
    expect(screen.getByText("+4 new this period")).toBeTruthy();
  });

  it("asks for the whole of the end day, not just its first instant", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("128")).toBeTruthy());
    const url = fetchMock.mock.calls[0]![0] as string;
    const to = new URLSearchParams(url.slice(url.indexOf("?"))).get("to");
    // Midnight here would cut the picked day — today by default — out of the window.
    expect(to).toMatch(/T23:59:59.999Z$/);
  });

  it("shows only the two axes as tabs", () => {
    renderPage();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Products", "Profitability"]);
  });

  it("links each ranking to the products page", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Widget")).toBeTruthy());
    const links = screen.getAllByRole("link", { name: "View all products" });
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toBe("/products");
  });

  it("switches to profitability, fetching that axis and rendering its indicators", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("128")).toBeTruthy());

    await userEvent.setup().click(screen.getByRole("tab", { name: "Profitability" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) =>
          (call[0] as string).includes("/analytics/profitability"),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("Break-even point")).toBeTruthy());
    expect(screen.getAllByText("400.00").length).toBeGreaterThan(0);
  });

  it("opens the tab named in the query string", async () => {
    renderPage(undefined, undefined, "/analytics?tab=profitability");

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Profitability" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(fetchMock.mock.calls[0]![0] as string).toContain("/analytics/profitability");
  });

  it("hides the export button without analytics.manage", async () => {
    renderPage(["analytics"], ["analytics.read"]);

    await waitFor(() => expect(screen.getByText("128")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Export CSV/ })).toBeNull();
  });

  it("exports the open axis when Export CSV is clicked", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("128")).toBeTruthy());
    fetchMock.mockResolvedValueOnce(new Response(new Blob(["a,b\r\n"]), { status: 200 }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });

    await userEvent.setup().click(screen.getByRole("button", { name: /Export CSV/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => (c[0] as string).includes("/analytics/export"));
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as RequestInit).body as string).axis).toBe("products");
    });
  });

  it("shows a message when an axis fails to load", async () => {
    fetchMock.mockResolvedValue(json(500, { error: { code: "INTERNAL" } }));
    renderPage();

    await waitFor(() => expect(screen.getByText("Could not load. Please try again.")).toBeTruthy());
  });

  it("renders the two-slice split with the period's totals", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("128")).toBeTruthy());

    await userEvent.setup().click(screen.getByRole("tab", { name: "Profitability" }));

    const split = await screen.findByRole("region", { name: "How the money divides" });
    // Sales 1,000.00 and expenses 200.00, totalling 1,200.00 in the middle.
    expect(within(split).getByText("1,200.00")).toBeTruthy();
    expect(within(split).getByText("83%")).toBeTruthy();
    expect(within(split).getByText("17%")).toBeTruthy();
  });
});
