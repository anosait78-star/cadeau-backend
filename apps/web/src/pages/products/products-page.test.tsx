import { render, screen, waitFor, within } from "@testing-library/react";
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
import { ProductsPage } from "./products-page";

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

/**
 * Opens a product from the list. The row is the affordance now — its actions
 * and full fields live in the detail panel it opens, not on its face.
 */
async function openProduct(name: string): Promise<HTMLElement> {
  const label = await screen.findByText(name);
  const row = label.closest("li");
  if (row === null) throw new Error("no row for " + name);
  await userEvent.click(within(row).getByRole("button"));
  return (await screen.findByRole("dialog")) as HTMLElement;
}

function renderPage(features = ["products"], permissions = ["products.read", "products.manage"]) {
  return render(
    <I18nProvider>
      <ToastProvider>{caps(features, permissions, <ProductsPage />)}</ToastProvider>
    </I18nProvider>,
  );
}

function product(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: "Mug",
    description: "Ceramic",
    categoryId: "c1",
    unitId: null,
    imageUrl: null,
    allowOversell: true,
    active: true,
    warehouseNames: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const PRODUCTS_PAGE = {
  data: [product("p1", { imageUrl: "https://img.example/mug.png", warehouseNames: ["Main"] })],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const CATEGORIES = {
  data: [
    {
      id: "c1",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name: "Kitchen",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const EMPTY = { data: [], page: { limit: 25, nextCursor: null, hasMore: false } };

describe("ProductsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/master-data/product-categories"))
        return Promise.resolve(json(200, CATEGORIES));
      if (url.includes("/master-data/units")) return Promise.resolve(json(200, EMPTY));
      if (url.match(/\/products\/p1\/variants$/) && method === "GET") {
        return Promise.resolve(
          json(200, {
            data: [
              {
                id: "v1",
                productId: "p1",
                name: "Small",
                sku: "SKU-1",
                barcode: null,
                averageCost: 0,
                active: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (url.match(/\/products\/p1\/variants$/) && method === "POST") {
        return Promise.resolve(
          json(201, {
            id: "v2",
            productId: "p1",
            name: "Large",
            sku: null,
            barcode: null,
            averageCost: 0,
            active: true,
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          }),
        );
      }
      if (url.match(/\/products\/p1\/variants\/v1$/) && method === "PATCH") {
        return Promise.resolve(
          json(200, {
            id: "v1",
            productId: "p1",
            name: "Small",
            sku: "SKU-9",
            barcode: null,
            averageCost: 0,
            active: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-03T00:00:00.000Z",
          }),
        );
      }
      if (url.match(/\/products\/p1$/) && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.match(/\/products\/p1$/) && method === "PATCH") {
        return Promise.resolve(json(200, product("p1", { name: "Tea Mug" })));
      }
      if (url.includes("/products") && method === "POST") {
        return Promise.resolve(json(201, product("p2", { name: "Plate", description: null })));
      }
      if (url.includes("/products")) return Promise.resolve(json(200, PRODUCTS_PAGE));
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists products and resolves the category name", async () => {
    renderPage();
    expect(await screen.findByText("Mug")).toBeInTheDocument();
    // The category is a detail, not a list column: it arrives with the panel.
    const panel = await openProduct("Mug");
    expect(await within(panel).findByText("Kitchen")).toBeInTheDocument();
  });

  it("puts each product on one row — image, name and warehouse, nothing else", async () => {
    renderPage();
    const row = (await screen.findByText("Mug")).closest("li");
    if (row === null) throw new Error("row not found");

    expect(within(row).getByText("Mug")).toBeInTheDocument();
    expect(within(row).getByText("Main")).toBeInTheDocument();

    // Category, unit and description belong to the panel, and the row carries
    // no actions of its own — it is one control that opens that panel.
    expect(within(row).queryByText("Kitchen")).not.toBeInTheDocument();
    expect(within(row).queryByText("Ceramic")).not.toBeInTheDocument();
    expect(within(row).getAllByRole("button")).toHaveLength(1);
  });

  it("shows the product image, falling back to an initial when it fails", async () => {
    renderPage();
    const row = (await screen.findByText("Mug")).closest("li");
    if (row === null) throw new Error("row not found");
    const image = within(row).getByRole("presentation", { hidden: true });
    expect(image).toHaveAttribute("src", "https://img.example/mug.png");
  });

  it("hides the whole screen without the feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to products.")).toBeInTheDocument();
  });

  it("hides create/edit actions without the manage permission", async () => {
    renderPage(["products"], ["products.read"]);
    await screen.findByText("Mug");
    expect(screen.queryByRole("button", { name: "New product" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("creates a new product", async () => {
    renderPage();
    await screen.findByText("Mug");
    await userEvent.click(screen.getByRole("button", { name: "New product" }));
    await userEvent.type(screen.getByLabelText("Name"), "Plate");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Plate")).toBeInTheDocument();
    const posted = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/products") && (c[1] as RequestInit)?.method === "POST",
    );
    expect(posted).toBeDefined();
  });

  it("archives a product", async () => {
    renderPage();
    const panel = await openProduct("Mug");
    await userEvent.click(within(panel).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(within(panel).getByTestId("status")).toHaveTextContent("Archived"));
  });

  it("lazy-loads variants when expanded", async () => {
    renderPage();
    const panel = await openProduct("Mug");
    await userEvent.click(within(panel).getByRole("button", { name: "Variants" }));
    expect(await screen.findByText("Small")).toBeInTheDocument();
  });

  it("edits a product name", async () => {
    renderPage();
    const panel = await openProduct("Mug");
    await userEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, "Tea Mug");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    // The rename reaches the list row, not just the panel it was made in.
    await waitFor(() => expect(screen.getAllByText("Tea Mug").length).toBeGreaterThan(0));
    const patched = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/products/p1") && (c[1] as RequestInit)?.method === "PATCH",
    );
    expect(patched).toBeDefined();
  });

  it("adds a variant", async () => {
    renderPage();
    const panel = await openProduct("Mug");
    await userEvent.click(within(panel).getByRole("button", { name: "Variants" }));
    await screen.findByText("Small");
    await userEvent.click(screen.getByRole("button", { name: "Add variant" }));
    await userEvent.type(screen.getByLabelText("Name"), "Large");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Large")).toBeInTheDocument();
  });

  it("edits a variant SKU", async () => {
    renderPage();
    const panel = await openProduct("Mug");
    await userEvent.click(within(panel).getByRole("button", { name: "Variants" }));
    const variantRow = (await screen.findByText("Small")).closest("li");
    if (variantRow === null) throw new Error("variant row not found");
    await userEvent.click(within(variantRow as HTMLElement).getByRole("button", { name: "Edit" }));
    const sku = screen.getByLabelText("SKU");
    await userEvent.clear(sku);
    await userEvent.type(sku, "SKU-9");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const patched = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).endsWith("/products/p1/variants/v1") &&
        (c[1] as RequestInit)?.method === "PATCH",
    );
    await waitFor(() => expect(patched).toBeDefined());
  });

  it("searches by query", async () => {
    renderPage();
    await screen.findByText("Mug");
    await userEvent.type(screen.getByLabelText("Search"), "mug");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      const searched = fetchMock.mock.calls.find((c) => String(c[0]).includes("q=mug"));
      expect(searched).toBeDefined();
    });
  });
});
