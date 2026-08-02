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
import { MasterDataPage } from "./master-data-page";

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
  features = ["master-data"],
  permissions = ["master-data.read", "master-data.manage"],
) {
  return render(
    <I18nProvider>
      <ToastProvider>{caps(features, permissions, <MasterDataPage />)}</ToastProvider>
    </I18nProvider>,
  );
}

const UNITS_PAGE = {
  data: [
    {
      id: "u1",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name: "Piece",
      code: "pc",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

describe("MasterDataPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/master-data/units") && method === "GET") {
        return Promise.resolve(json(200, UNITS_PAGE));
      }
      if (url.includes("/master-data/units") && method === "POST") {
        return Promise.resolve(
          json(201, {
            id: "u2",
            active: true,
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            name: "Box",
            code: null,
          }),
        );
      }
      if (url.match(/\/master-data\/units\/u1$/) && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes("/master-data/")) {
        return Promise.resolve(
          json(200, { data: [], page: { limit: 25, nextCursor: null, hasMore: false } }),
        );
      }
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists rows for the default resource", async () => {
    renderPage();
    expect(await screen.findByText("Piece")).toBeInTheDocument();
  });

  it("hides the whole screen without the feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to master data.")).toBeInTheDocument();
  });

  it("shows read-only notice for a system resource and no create button", async () => {
    renderPage();
    await screen.findByText("Piece");
    await userEvent.click(screen.getByRole("button", { name: "Currencies" }));
    expect(await screen.findByText(/system-managed and read-only/i)).toBeInTheDocument();
  });

  it("hides create/edit actions without the manage permission", async () => {
    renderPage(["master-data"], ["master-data.read"]);
    await screen.findByText("Piece");
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("creates a new row", async () => {
    renderPage();
    await screen.findByText("Piece");
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    await userEvent.type(screen.getByLabelText(/Name/), "Box");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Box")).toBeInTheDocument();
    const posted = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("/master-data/units") && (c[1] as RequestInit)?.method === "POST",
    );
    expect(posted).toBeDefined();
  });

  it("deactivates a row", async () => {
    renderPage();
    const piece = await screen.findByText("Piece");
    const card = piece.closest("li");
    if (card === null) throw new Error("card not found");
    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: "Deactivate" }));
    await waitFor(() =>
      expect(within(card as HTMLElement).getByTestId("status")).toHaveTextContent("Inactive"),
    );
  });
});
