import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
import { VendorProductsPage } from "./vendor-products-page";

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

function vendorProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p1",
    name: "Classic Mug",
    imageUrl: null,
    priceMinor: 15000,
    availableQuantity: 12,
    ...overrides,
  };
}

/** Routes `/me` and `/access/capabilities` (fired by AppProviders on hydrate)
 * plus the vendor products endpoint. */
function routedFetch(opts: {
  products?: unknown[];
  productsStatus?: number;
}): ReturnType<typeof vi.fn> {
  const { products = [vendorProduct()], productsStatus = 200 } = opts;
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(json(200, ME));
    if (url.endsWith("/access/capabilities")) return Promise.resolve(json(200, CAPS));
    if (url.endsWith("/vendor/products")) {
      return Promise.resolve(
        productsStatus === 200
          ? json(200, { data: products })
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
    <MemoryRouter initialEntries={["/vendor/products"]}>
      <AppProviders>
        <VendorProductsPage />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe("VendorProductsPage (Vendor Accounts)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders my warehouse's products, name/price/available quantity", async () => {
    renderPage(routedFetch({}));
    expect(await screen.findByText("Classic Mug")).toBeInTheDocument();
    expect(screen.getByText("150.00")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows the empty state when the warehouse has no stocked products yet", async () => {
    renderPage(routedFetch({ products: [] }));
    expect(await screen.findByText("No products in your warehouse yet.")).toBeInTheDocument();
  });

  it("shows an error state with retry on load failure", async () => {
    renderPage(routedFetch({ productsStatus: 500 }));
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("renders no add/edit/delete controls — read-only by construction", async () => {
    renderPage(routedFetch({}));
    await screen.findByText("Classic Mug");
    expect(screen.queryByRole("button", { name: /add product/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});
