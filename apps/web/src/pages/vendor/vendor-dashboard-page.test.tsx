import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
import { setViewport } from "@/test/setup";
import { VendorDashboardPage } from "./vendor-dashboard-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ME = {
  id: "u1",
  email: "vendor@test.dev",
  fullName: "Me",
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: "c1",
  companies: [{ id: "c1", name: "Acme", slug: "acme", role: "vendor", status: "active" }],
};

const CAPS = { features: [], permissions: [], isSuperAdmin: false };

function group(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "g1",
    orderId: "o1",
    orderNumber: 1042,
    warehouseId: "w1",
    warehouseName: "Main",
    warehouseCode: null,
    vendorMemberId: "m1",
    vendorName: "Me",
    status: "new",
    updatedAt: "2026-01-01T00:00:00.000Z",
    items: [
      {
        id: "i1",
        variantId: "v1",
        nameSnapshot: "T-Shirt — L",
        quantity: 2,
        price: 15000,
        imageUrl: null,
      },
    ],
    ...overrides,
  };
}

/** Routes `/me` and `/access/capabilities` (fired by AppProviders on hydrate)
 * plus the vendor groups endpoint. */
function routedFetch(opts: {
  groups?: unknown[];
  groupsStatus?: number;
}): ReturnType<typeof vi.fn> {
  const { groups = [group()], groupsStatus = 200 } = opts;
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(json(200, ME));
    if (url.endsWith("/access/capabilities")) return Promise.resolve(json(200, CAPS));
    if (url.endsWith("/vendor/order-groups")) {
      return Promise.resolve(
        groupsStatus === 200
          ? json(200, { data: groups })
          : json(500, { error: { code: "INTERNAL", statusCode: 500, message: "boom" } }),
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function renderPage(fetchMock: ReturnType<typeof vi.fn>): void {
  localStorage.setItem("cadeau.locale", "en");
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter initialEntries={["/vendor"]}>
      <AppProviders>
        <VendorDashboardPage />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe("VendorDashboardPage (Vendor Accounts, Phase 7)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders", async () => {
    // The page title is a Desktop-shell concern; on mobile the shell renders it.
    setViewport(true);
    renderPage(routedFetch({}));
    expect(await screen.findByText("Overview")).toBeInTheDocument();
  });

  it("shows the empty state when the vendor has no groups yet", async () => {
    renderPage(routedFetch({ groups: [] }));
    expect(await screen.findByText("No orders yet.")).toBeInTheDocument();
  });

  it("shows KPI counts by status, scoped to my own groups", async () => {
    renderPage(
      routedFetch({
        groups: [
          group({ id: "g1", orderNumber: 1, status: "new" }),
          group({ id: "g2", orderNumber: 2, status: "processing" }),
          group({ id: "g3", orderNumber: 3, status: "delivered" }),
        ],
      }),
    );
    expect(await screen.findByText("Total orders")).toBeInTheDocument();
    // 3 total, 1 each of new/processing/delivered, 0 ready.
    const kpiValues = screen
      .getAllByText(/^[0-9]+$/)
      .map((el) => el.textContent)
      .slice(0, 5);
    expect(kpiValues).toEqual(["3", "1", "1", "0", "1"]);
  });

  it("shows a recent-orders list, clicking a row links to its detail page", async () => {
    renderPage(routedFetch({}));
    const link = await screen.findByRole("link", { name: /Order #1042/ });
    expect(link).toHaveAttribute("href", "/vendor/orders/g1");
  });

  it("links to the full orders list", async () => {
    renderPage(routedFetch({}));
    const link = await screen.findByRole("link", { name: "View all orders" });
    expect(link).toHaveAttribute("href", "/vendor/orders");
  });

  it("shows an error state with retry on load failure", async () => {
    renderPage(routedFetch({ groupsStatus: 500 }));
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
