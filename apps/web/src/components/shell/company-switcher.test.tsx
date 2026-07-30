import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/auth/auth-provider";
import { writeTokens } from "@/auth/auth-storage";
import { I18nProvider } from "@/i18n/i18n-provider";
import { CompanySwitcher } from "./company-switcher";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ME = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  email: "founder@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: "c1",
  companies: [
    { id: "c1", name: "Acme", slug: "acme", role: "owner", status: "active" },
    { id: "c2", name: "Beta", slug: "beta", role: "member", status: "active" },
  ],
  ...over,
});

function renderSwitcher(): void {
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  render(
    <I18nProvider>
      <AuthProvider>
        <CompanySwitcher />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe("CompanySwitcher", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the active company and switches on selection", async () => {
    fetchMock.mockResolvedValueOnce(json(200, ME())); // hydrate
    const user = userEvent.setup();
    renderSwitcher();

    expect(await screen.findByText("Acme")).toBeInTheDocument();

    // Switch → re-issue tokens then reload /me with the new active company.
    fetchMock
      .mockResolvedValueOnce(
        json(200, { accessToken: "a2", refreshToken: "r2", tokenType: "Bearer", expiresIn: 300 }),
      )
      .mockResolvedValueOnce(json(200, ME({ activeCompanyId: "c2" })));

    await user.click(screen.getByRole("button", { name: /Acme/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Beta/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Beta/ })).toBeInTheDocument());
  });

  it("renders a disabled placeholder when the user has no companies", async () => {
    fetchMock.mockResolvedValueOnce(json(200, ME({ activeCompanyId: null, companies: [] })));
    renderSwitcher();
    expect(await screen.findByText("لا توجد شركة بعد")).toBeInTheDocument();
  });
});
