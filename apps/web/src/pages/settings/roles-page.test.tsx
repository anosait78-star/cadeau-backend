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
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders every template and permission in Arabic, not the seed's English or raw keys", async () => {
    localStorage.setItem("cadeau.locale", "ar");
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [
          {
            key: "owner",
            name: "Owner",
            description: "Full access to everything in the company.",
            permissions: ["orders.read", "orders.manage", "orders.vendor_groups.override"],
          },
        ],
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("مالك")).toBeInTheDocument());
    expect(screen.getByText("صلاحية كاملة على كل شيء في الشركة.")).toBeInTheDocument();
    expect(screen.getByText("عرض الطلبات")).toBeInTheDocument();
    expect(screen.getByText("إدارة الطلبات")).toBeInTheDocument();
    expect(screen.getByText("تجاوز حالة التاجر")).toBeInTheDocument();
    // The English and technical text the API sends must not leak through.
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
    expect(screen.queryByText("orders.manage")).not.toBeInTheDocument();
    expect(screen.queryByText("orders.vendor_groups.override")).not.toBeInTheDocument();
  });

  it("follows the language switch", async () => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [{ key: "owner", name: "Owner", description: null, permissions: ["orders.manage"] }],
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("Owner")).toBeInTheDocument());
    expect(screen.getByText("Manage Orders")).toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: { code: "INTERNAL", statusCode: 500 } }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
