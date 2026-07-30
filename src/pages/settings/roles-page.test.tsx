import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { RolesPage } from "./roles-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <RolesPage />
    </I18nProvider>,
  );
}

describe("RolesPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the permission templates with their permissions", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [
          {
            key: "owner",
            name: "Owner",
            description: "All access",
            permissions: ["orders.read", "orders.manage"],
          },
        ],
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("Owner")).toBeInTheDocument());
    expect(screen.getByText("orders.manage")).toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: { code: "INTERNAL", statusCode: 500 } }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
