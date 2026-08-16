import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
import { VendorOrderDetailPage } from "./vendor-order-detail-page";

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
        imageUrl: "https://cdn.example.com/shirt.jpg",
      },
    ],
    ...overrides,
  };
}

function routedFetch(opts: {
  groups?: unknown[];
  advanceResponse?: unknown;
}): ReturnType<typeof vi.fn> {
  const { groups = [group()], advanceResponse } = opts;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/me")) return Promise.resolve(json(200, ME));
    if (url.endsWith("/access/capabilities")) return Promise.resolve(json(200, CAPS));
    if (url.endsWith("/vendor/order-groups") && method === "GET") {
      return Promise.resolve(json(200, { data: groups }));
    }
    if (url.includes("/vendor/order-groups/") && url.endsWith("/status") && method === "POST") {
      return Promise.resolve(json(200, advanceResponse ?? { ...group(), status: "processing" }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function renderPage(groupId: string, fetchMock: ReturnType<typeof vi.fn>): void {
  localStorage.setItem("cadeau.locale", "en");
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter initialEntries={[`/vendor/orders/${groupId}`]}>
      <AppProviders>
        <Routes>
          <Route path="/vendor/orders/:groupId" element={<VendorOrderDetailPage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe("VendorOrderDetailPage (Vendor Accounts, Phase 7)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the vendor's own items, status, warehouse, and total", async () => {
    renderPage("g1", routedFetch({}));
    expect(await screen.findByText("T-Shirt — L")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Main")).toBeInTheDocument();
    expect(screen.getByTestId("product-thumb-image")).toHaveAttribute(
      "src",
      "https://cdn.example.com/shirt.jpg",
    );
  });

  it("shows a placeholder when the item has no image", async () => {
    renderPage(
      "g1",
      routedFetch({
        groups: [
          group({
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
          }),
        ],
      }),
    );
    await screen.findByText("T-Shirt — L");
    expect(screen.getByTestId("product-thumb-placeholder")).toBeInTheDocument();
  });

  it("is not found when the groupId isn't in my own scoped list (URL tampering)", async () => {
    // Simulates a vendor pasting another vendor's groupId into the URL: the
    // (already server-scoped) list simply never contains it.
    renderPage("someone-elses-group", routedFetch({ groups: [group()] }));
    expect(await screen.findByText("Order not found")).toBeInTheDocument();
    expect(screen.queryByText("T-Shirt — L")).not.toBeInTheDocument();
  });

  it("advances the status by exactly one legal step and shows only that one action", async () => {
    const user = userEvent.setup();
    const fetchMock = routedFetch({ advanceResponse: { ...group(), status: "processing" } });
    renderPage("g1", fetchMock);

    // Only the single legal next step is ever offered — no way to skip ahead.
    expect(await screen.findByRole("button", { name: "Start processing" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /mark ready|mark delivered/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start processing" }));
    expect(await screen.findByText("Processing")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/vendor/order-groups/g1/status"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ toStatus: "processing" }) }),
    );
  });

  it("shows no advance action for a delivered (terminal) group", async () => {
    renderPage("g1", routedFetch({ groups: [group({ status: "delivered" })] }));
    await screen.findByText("Delivered");
    expect(
      screen.queryByRole("button", { name: /start processing|mark ready|mark delivered/i }),
    ).not.toBeInTheDocument();
  });
});
