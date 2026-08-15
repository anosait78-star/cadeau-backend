import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
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

const GROUP_NEW = {
  id: "g1",
  orderId: "o1",
  orderNumber: 1042,
  warehouseId: "w1",
  warehouseName: "Main",
  warehouseCode: null,
  vendorMemberId: "m1",
  vendorName: "Me",
  status: "new",
  items: [{ id: "i1", variantId: "v1", nameSnapshot: "T-Shirt — L", quantity: 2, price: 15000 }],
};

/** Routes `/me` and `/access/capabilities` (fired by AppProviders on hydrate)
 * plus the vendor endpoints, by URL/method rather than call order. */
function routedFetch(opts: {
  groups?: unknown[];
  groupsStatus?: number;
  advanceResponse?: unknown;
}): ReturnType<typeof vi.fn> {
  const { groups = [GROUP_NEW], groupsStatus = 200, advanceResponse } = opts;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/me")) return Promise.resolve(json(200, ME));
    if (url.endsWith("/access/capabilities")) return Promise.resolve(json(200, CAPS));
    if (url.endsWith("/vendor/order-groups") && method === "GET") {
      return Promise.resolve(
        groupsStatus === 200
          ? json(200, { data: groups })
          : json(500, { error: { code: "INTERNAL", statusCode: 500, message: "boom" } }),
      );
    }
    if (url.includes("/vendor/order-groups/") && url.endsWith("/status") && method === "POST") {
      return Promise.resolve(json(200, advanceResponse ?? { ...GROUP_NEW, status: "processing" }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function renderPage(fetchMock: ReturnType<typeof vi.fn>): void {
  localStorage.setItem("cadeau.locale", "en");
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AppProviders>
      <VendorDashboardPage />
    </AppProviders>,
  );
}

describe("VendorDashboardPage (Vendor Accounts, Phase 4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the empty state when the vendor has no groups yet", async () => {
    renderPage(routedFetch({ groups: [] }));
    expect(await screen.findByText("No orders yet.")).toBeInTheDocument();
  });

  it("shows only my own items and the correct status badge", async () => {
    renderPage(routedFetch({}));
    expect(await screen.findByText("T-Shirt — L × 2")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Order #1042")).toBeInTheDocument();
  });

  it("advances the group's status by exactly one step on click", async () => {
    const user = userEvent.setup();
    const fetchMock = routedFetch({ advanceResponse: { ...GROUP_NEW, status: "processing" } });
    renderPage(fetchMock);

    const button = await screen.findByRole("button", { name: "Start processing" });
    await user.click(button);

    expect(await screen.findByText("Processing")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/vendor/order-groups/g1/status"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ toStatus: "processing" }),
      }),
    );
  });

  it("shows no advance button for a delivered (terminal) group", async () => {
    renderPage(routedFetch({ groups: [{ ...GROUP_NEW, status: "delivered" }] }));
    await screen.findByText("Delivered");
    expect(
      screen.queryByRole("button", { name: /start processing|mark ready|mark delivered/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an error state with retry on load failure", async () => {
    renderPage(routedFetch({ groupsStatus: 500 }));
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
