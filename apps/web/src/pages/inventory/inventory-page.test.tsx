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
import { InventoryPage } from "./inventory-page";

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
  features = ["inventory"],
  permissions = ["inventory.read", "inventory.manage"],
) {
  return render(
    <I18nProvider>
      <ToastProvider>{caps(features, permissions, <InventoryPage />)}</ToastProvider>
    </I18nProvider>,
  );
}

const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";
const VARIANT = "55555555-5555-5555-5555-555555555555";

const WAREHOUSES = {
  data: [
    {
      id: WAREHOUSE,
      name: "Main",
      code: "MAIN",
      address: "Cairo",
      isDefault: true,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: OTHER,
      name: "Depot",
      code: null,
      address: null,
      isDefault: false,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const STOCK = {
  data: [
    {
      id: "s1",
      warehouseId: WAREHOUSE,
      variantId: VARIANT,
      variantName: "Small",
      productId: "p1",
      productName: "Mug",
      sku: "SKU-1",
      imageUrl: "https://cdn.example.com/mug.png",
      onHand: 10,
      committed: 2,
      available: 8,
      reorderPoint: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const LOW_STOCK = {
  data: [{ ...STOCK.data[0], id: "s2", onHand: 3, committed: 0, available: 3, reorderPoint: 5 }],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

/** The label the variant pickers build from a stock row. */
const VARIANT_LABEL = "Mug — Small (SKU-1)";

describe("InventoryPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/inventory/stock")) {
        return Promise.resolve(json(200, url.includes("belowReorder") ? LOW_STOCK : STOCK));
      }
      if (url.includes("/inventory/reorder-points") && method === "PUT") {
        return Promise.resolve(json(200, { ...STOCK.data[0], reorderPoint: 5 }));
      }
      if (url.includes("/inventory/adjustments") && method === "POST") {
        return Promise.resolve(
          json(201, {
            id: "a1",
            warehouseId: WAREHOUSE,
            variantId: VARIANT,
            quantityDelta: -3,
            reason: "damage",
            note: null,
            createdAt: "2026-01-02T00:00:00.000Z",
          }),
        );
      }
      if (url.includes("/inventory/transfers") && method === "POST") {
        return Promise.resolve(
          json(201, {
            id: "t1",
            fromWarehouseId: WAREHOUSE,
            toWarehouseId: OTHER,
            variantId: VARIANT,
            quantity: 3,
            note: null,
            createdAt: "2026-01-02T00:00:00.000Z",
          }),
        );
      }
      if (url.match(/\/warehouses\/[^/]+$/) && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes("/warehouses") && method === "POST") {
        return Promise.resolve(
          json(201, { ...WAREHOUSES.data[1], id: "w3", name: "Annex", isDefault: false }),
        );
      }
      if (url.includes("/warehouses")) return Promise.resolve(json(200, WAREHOUSES));
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides the whole screen without the feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to inventory.")).toBeInTheDocument();
  });

  it("names stock levels from the row itself, without a catalog call", async () => {
    renderPage();
    expect(await screen.findByText("Mug")).toBeInTheDocument();
    expect(screen.getByText("Small")).toBeInTheDocument();
    // The warehouse name comes off the row itself. (Its other appearance, in
    // the warehouse filter's options, is behind the filter sheet on mobile.)
    await waitFor(() => expect(screen.getAllByText("Main").length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText("8")).toBeInTheDocument(); // available
    // The uuid must never surface, and the catalog is never paged for names.
    expect(screen.queryByText(VARIANT)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/products"))).toBe(false);
  });

  it("hides every write action without the manage permission", async () => {
    renderPage(["inventory"], ["inventory.read"]);
    await screen.findByText("Mug");
    expect(screen.queryByRole("button", { name: "Adjust stock" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transfer stock" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set reorder point" })).not.toBeInTheDocument();
  });

  it("flags a level that is at or below its reorder point", async () => {
    renderPage();
    await screen.findByText("Mug");
    // Filters sit behind a sheet at this (mobile) viewport.
    await userEvent.click(screen.getByRole("button", { name: /Filters/ }));
    await userEvent.click(await screen.findByLabelText("Low stock only"));
    expect(await screen.findByTestId("low-badge")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("belowReorder=true"))).toBe(
        true,
      );
    });
  });

  it("offers no variants until a warehouse is chosen, then scopes them to it", async () => {
    renderPage();
    await screen.findByText("Mug");
    await userEvent.click(screen.getByRole("button", { name: "Adjust stock" }));

    // Nothing to choose from, and the picker says why rather than sitting blank.
    expect(screen.getByLabelText("Variant")).not.toHaveValue(VARIANT);
    expect(screen.getByTestId("adjust-variant-hint")).toHaveTextContent("Choose a warehouse first");

    await userEvent.selectOptions(
      screen.getByLabelText("Warehouse", { selector: "#adjust-warehouse" }),
      WAREHOUSE,
    );
    expect(await screen.findByRole("option", { name: VARIANT_LABEL })).toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => {
          const url = String(c[0]);
          return url.includes("/inventory/stock") && url.includes(`warehouseId=${WAREHOUSE}`);
        }),
      ).toBe(true);
    });
  });

  it("clears a chosen variant when the warehouse changes under it", async () => {
    renderPage();
    await screen.findByText("Mug");
    await userEvent.click(screen.getByRole("button", { name: "Adjust stock" }));
    const warehouse = screen.getByLabelText("Warehouse", { selector: "#adjust-warehouse" });
    await userEvent.selectOptions(warehouse, WAREHOUSE);
    await screen.findByRole("option", { name: VARIANT_LABEL });
    await userEvent.selectOptions(screen.getByLabelText("Variant"), VARIANT);
    expect(screen.getByLabelText("Variant")).toHaveValue(VARIANT);

    await userEvent.selectOptions(warehouse, OTHER);
    expect(screen.getByLabelText("Variant")).not.toHaveValue(VARIANT);
  });

  it("adjusts stock with a reason", async () => {
    renderPage();
    await screen.findByText("Mug");
    await userEvent.click(screen.getByRole("button", { name: "Adjust stock" }));
    await userEvent.selectOptions(
      screen.getByLabelText("Warehouse", { selector: "#adjust-warehouse" }),
      WAREHOUSE,
    );
    await screen.findByRole("option", { name: VARIANT_LABEL });
    await userEvent.selectOptions(screen.getByLabelText("Variant"), VARIANT);
    await userEvent.type(screen.getByLabelText("Change (+/−)"), "-3");
    await userEvent.selectOptions(screen.getByLabelText("Reason"), "damage");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/inventory/adjustments"),
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        warehouseId: WAREHOUSE,
        variantId: VARIANT,
        quantityDelta: -3,
        reason: "damage",
      });
    });
  });

  it("refuses a transfer between the same two warehouses", async () => {
    renderPage();
    await screen.findByText("Mug");
    await userEvent.click(screen.getByRole("button", { name: "Transfer stock" }));
    await userEvent.selectOptions(screen.getByLabelText("From warehouse"), WAREHOUSE);
    await screen.findByRole("option", { name: VARIANT_LABEL });
    await userEvent.selectOptions(screen.getByLabelText("To warehouse"), WAREHOUSE);
    await userEvent.selectOptions(screen.getByLabelText("Variant"), VARIANT);
    await userEvent.type(screen.getByLabelText("Quantity"), "3");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("scopes the transfer's variants to the source warehouse", async () => {
    renderPage();
    await screen.findByText("Mug");
    await userEvent.click(screen.getByRole("button", { name: "Transfer stock" }));
    // The destination alone must not populate the picker — only the source holds stock.
    await userEvent.selectOptions(screen.getByLabelText("To warehouse"), OTHER);
    expect(screen.getByTestId("transfer-variant-hint")).toHaveTextContent(
      "Choose a warehouse first",
    );
    await userEvent.selectOptions(screen.getByLabelText("From warehouse"), WAREHOUSE);
    expect(await screen.findByRole("option", { name: VARIANT_LABEL })).toBeInTheDocument();
  });

  it("transfers stock between two warehouses", async () => {
    renderPage();
    await screen.findByText("Mug");
    await userEvent.click(screen.getByRole("button", { name: "Transfer stock" }));
    await userEvent.selectOptions(screen.getByLabelText("From warehouse"), WAREHOUSE);
    await screen.findByRole("option", { name: VARIANT_LABEL });
    await userEvent.selectOptions(screen.getByLabelText("To warehouse"), OTHER);
    await userEvent.selectOptions(screen.getByLabelText("Variant"), VARIANT);
    await userEvent.type(screen.getByLabelText("Quantity"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/inventory/transfers"));
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: OTHER,
        quantity: 3,
      });
    });
  });

  it("sets a reorder point on a level", async () => {
    renderPage();
    await screen.findByText("Mug");
    await userEvent.click(screen.getByRole("button", { name: "Set reorder point" }));
    const input = screen.getByLabelText("Reorder point");
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/inventory/reorder-points"),
      );
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({
        reorderPoint: 5,
      });
    });
  });

  it("lists and creates warehouses on the warehouses tab", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Warehouses" }));
    expect(await screen.findByText("Depot")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New warehouse" }));
    await userEvent.type(screen.getByLabelText("Name"), "Annex");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]).includes("/warehouses") && (c[1] as RequestInit)?.method === "POST",
      );
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toMatchObject({ name: "Annex" });
    });
  });

  it("archives a warehouse", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Warehouses" }));
    await screen.findByText("Depot");
    const archiveButtons = screen.getAllByRole("button", { name: "Archive" });
    await userEvent.click(archiveButtons[0] as HTMLElement);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            String(c[0]).includes(`/warehouses/${WAREHOUSE}`) &&
            (c[1] as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true);
    });
  });
});
