import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { AdminPage } from "./admin-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const COMPANIES = {
  data: [
    {
      id: "c1",
      name: "Acme Gifts",
      slug: "acme",
      status: "active",
      planCode: "free",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const FEATURES = {
  data: [{ key: "analytics", name: "Analytics", category: "insights", enabled: false }],
};

function renderPage() {
  return render(
    <I18nProvider>
      <AdminPage />
    </I18nProvider>,
  );
}

describe("AdminPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.includes("/admin/companies")) return Promise.resolve(json(200, COMPANIES));
      if (url.includes("/access/features")) return Promise.resolve(json(200, FEATURES));
      if (url.includes("/features/analytics")) {
        return Promise.resolve(json(200, { featureKey: "analytics", enabled: true }));
      }
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists companies with their features", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Acme Gifts")).toBeInTheDocument());
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("toggles a feature for a company", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("Analytics")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "تفعيل" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("/features/analytics")),
      ).toBe(true),
    );
  });
});
