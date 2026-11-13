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
import { VendorWarehousesPage } from "./vendor-warehouses-page";

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
      <ToastProvider>{caps(features, permissions, <VendorWarehousesPage />)}</ToastProvider>
    </I18nProvider>,
  );
}

const MAIN = "33333333-3333-3333-3333-333333333333";

function warehouse(id: string, name: string, code: string | null = null) {
  return {
    id,
    name,
    code,
    address: null,
    isDefault: false,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// Deliberately out of order: the page must sort them itself.
const WAREHOUSES = {
  data: [
    warehouse("w-yasser", "ياسر"),
    warehouse(MAIN, "Main", "MAIN"),
    warehouse("w-ahmed", "أحمد"),
    warehouse("w-depot", "Depot"),
    warehouse("w-basma", "بسمة"),
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const NAMES = WAREHOUSES.data.map((w) => w.name);
// Arabic-first collation: Arabic names, then Latin ones, each alphabetical.
const ORDERED = ["أحمد", "بسمة", "ياسر", "Depot", "Main"];

/** Warehouse names in the order they render. */
function renderedNames(): string[] {
  return screen
    .queryAllByText((_, el) => el?.tagName === "SPAN" && NAMES.includes(el.textContent ?? ""))
    .map((el) => el.textContent ?? "");
}

describe("VendorWarehousesPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.match(/\/warehouses\/[^/]+$/) && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes("/warehouses") && method === "POST") {
        return Promise.resolve(json(201, warehouse("w-new", "Annex")));
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

  it("lists warehouses alphabetically by name", async () => {
    renderPage();
    await screen.findByText("Depot");
    expect(renderedNames()).toEqual(ORDERED);
  });

  it("filters warehouses as you type, Arabic spelling-insensitive", async () => {
    renderPage();
    await screen.findByText("Depot");
    const search = screen.getByRole("searchbox", { name: "Search warehouses" });

    await userEvent.type(search, "احمد");
    expect(renderedNames()).toEqual(["أحمد"]);

    await userEvent.clear(search);
    await userEvent.type(search, "main");
    expect(renderedNames()).toEqual(["Main"]);
  });

  it("says so when nothing matches the search", async () => {
    renderPage();
    await screen.findByText("Depot");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search warehouses" }), "zzz");
    expect(await screen.findByText("No warehouses match your search.")).toBeInTheDocument();
  });

  it("hides management actions without inventory.manage", async () => {
    renderPage(["inventory"], ["inventory.read"]);
    await screen.findByText("Depot");
    expect(screen.queryByRole("button", { name: "New warehouse" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("creates a warehouse", async () => {
    renderPage();
    await screen.findByText("Depot");
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
    await screen.findByText("Depot");
    // Sorted: Main is last.
    const archiveButtons = screen.getAllByRole("button", { name: "Archive" });
    await userEvent.click(archiveButtons[4] as HTMLElement);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            String(c[0]).includes(`/warehouses/${MAIN}`) &&
            (c[1] as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true);
    });
  });
});
