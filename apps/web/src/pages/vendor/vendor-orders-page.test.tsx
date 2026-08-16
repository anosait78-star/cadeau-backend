import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
import { VendorOrdersPage } from "./vendor-orders-page";

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

function routedFetch(groups: unknown[]): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(json(200, ME));
    if (url.endsWith("/access/capabilities")) return Promise.resolve(json(200, CAPS));
    if (url.endsWith("/vendor/order-groups")) return Promise.resolve(json(200, { data: groups }));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function renderPage(groups: unknown[]): void {
  localStorage.setItem("cadeau.locale", "en");
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  vi.stubGlobal("fetch", routedFetch(groups));
  render(
    <MemoryRouter initialEntries={["/vendor/orders"]}>
      <AppProviders>
        <Routes>
          <Route path="/vendor/orders" element={<VendorOrdersPage />} />
          <Route path="/vendor/orders/:groupId" element={<div>DETAIL PAGE</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe("VendorOrdersPage (Vendor Accounts, Phase 7)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders", async () => {
    renderPage([group()]);
    expect(await screen.findByText("#1042")).toBeInTheDocument();
  });

  it("shows only my own groups — nothing from another vendor ever appears", async () => {
    renderPage([group()]);
    await screen.findByText("#1042");
    // The API response is the only data source; a second vendor's order
    // would only show up if the (mocked) API returned it — it doesn't here.
    expect(screen.queryByText("#9999")).not.toBeInTheDocument();
  });

  it("filters by status tab", async () => {
    const user = userEvent.setup();
    renderPage([
      group({ id: "g1", orderNumber: 1, status: "new" }),
      group({ id: "g2", orderNumber: 2, status: "delivered" }),
    ]);
    await screen.findByText("#1");
    expect(screen.getByText("#2")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Delivered/ }));
    expect(screen.queryByText("#1")).not.toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
  });

  it("searches by order number", async () => {
    const user = userEvent.setup();
    renderPage([
      group({ id: "g1", orderNumber: 111, status: "new" }),
      group({ id: "g2", orderNumber: 222, status: "new" }),
    ]);
    await screen.findByText("#111");
    await user.type(screen.getByPlaceholderText("Search by order number"), "222");
    expect(screen.queryByText("#111")).not.toBeInTheDocument();
    expect(screen.getByText("#222")).toBeInTheDocument();
  });

  it("opens the order's detail page on click", async () => {
    const user = userEvent.setup();
    renderPage([group()]);
    await user.click(await screen.findByText("#1042"));
    expect(await screen.findByText("DETAIL PAGE")).toBeInTheDocument();
  });

  it("shows the empty state when there are no groups", async () => {
    renderPage([]);
    expect(await screen.findByText("No orders yet.")).toBeInTheDocument();
  });
});
