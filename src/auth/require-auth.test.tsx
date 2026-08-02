import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { I18nProvider } from "@/i18n/i18n-provider";
import { AuthProvider } from "./auth-provider";
import { writeTokens } from "./auth-storage";
import { RequireAuth } from "./require-auth";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ME = {
  id: "u1",
  email: "founder@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: "c1",
  companies: [{ id: "c1", name: "Acme", slug: "acme", role: "owner", status: "active" }],
};

const ME_NO_COMPANY = {
  ...ME,
  activeCompanyId: null,
  companies: [],
};

function renderGuarded(initialEntry = "/"): void {
  render(
    <I18nProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route index element={<p>protected content</p>} />
              <Route path="onboarding" element={<p>onboarding screen</p>} />
            </Route>
            <Route path="/login" element={<p>login screen</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

describe("RequireAuth", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to /login when unauthenticated", async () => {
    renderGuarded();
    await waitFor(() => expect(screen.getByText("login screen")).toBeInTheDocument());
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("renders the protected route when authenticated", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    fetchMock.mockResolvedValueOnce(json(200, ME));
    renderGuarded();
    expect(await screen.findByText("protected content")).toBeInTheDocument();
  });

  it("redirects to /onboarding when the caller has no company", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    fetchMock.mockResolvedValueOnce(json(200, ME_NO_COMPANY));
    renderGuarded();
    await waitFor(() => expect(screen.getByText("onboarding screen")).toBeInTheDocument());
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("does not redirect away from /onboarding for a zero-company caller", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    fetchMock.mockResolvedValueOnce(json(200, ME_NO_COMPANY));
    renderGuarded("/onboarding");
    expect(await screen.findByText("onboarding screen")).toBeInTheDocument();
  });
});
