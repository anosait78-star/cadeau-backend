import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { AppProviders } from "@/providers/app-providers";
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

const ME_VENDOR = {
  ...ME,
  companies: [{ id: "c1", name: "Acme", slug: "acme", role: "vendor", status: "active" }],
};

const CAPS = {
  features: [],
  permissions: [],
  isSuperAdmin: false,
  activeCompanyId: "c1",
};

/** Stubs `/me` and `/access/capabilities` — the two calls `RequireAuth` waits on. */
function stubFetch(me: unknown, caps: Partial<typeof CAPS> = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string | URL) => {
    const url = String(input);
    if (url.includes("/access/capabilities")) {
      return Promise.resolve(json(200, { ...CAPS, ...caps }));
    }
    if (url.includes("/me")) return Promise.resolve(json(200, me));
    return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderGuarded(initialEntry = "/"): void {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route index element={<p>protected content</p>} />
            <Route path="onboarding" element={<p>onboarding screen</p>} />
            <Route path="admin" element={<p>admin screen</p>} />
            <Route path="vendor" element={<p>vendor dashboard</p>} />
          </Route>
          <Route path="/login" element={<p>login screen</p>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("RequireAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to /login when unauthenticated", async () => {
    stubFetch(ME);
    renderGuarded();
    await waitFor(() => expect(screen.getByText("login screen")).toBeInTheDocument());
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("renders the protected route when authenticated", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    stubFetch(ME);
    renderGuarded();
    expect(await screen.findByText("protected content")).toBeInTheDocument();
  });

  it("redirects to /onboarding when the caller has no company", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    stubFetch(ME_NO_COMPANY);
    renderGuarded();
    await waitFor(() => expect(screen.getByText("onboarding screen")).toBeInTheDocument());
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("does not redirect away from /onboarding for a zero-company caller", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    stubFetch(ME_NO_COMPANY);
    renderGuarded("/onboarding");
    expect(await screen.findByText("onboarding screen")).toBeInTheDocument();
  });

  it("sends a zero-company Super-Admin to /admin instead of /onboarding", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    stubFetch(ME_NO_COMPANY, { isSuperAdmin: true });
    renderGuarded();
    await waitFor(() => expect(screen.getByText("admin screen")).toBeInTheDocument());
    expect(screen.queryByText("onboarding screen")).not.toBeInTheDocument();
  });

  it("leaves a zero-company Super-Admin on /admin", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    stubFetch(ME_NO_COMPANY, { isSuperAdmin: true });
    renderGuarded("/admin");
    expect(await screen.findByText("admin screen")).toBeInTheDocument();
  });

  it("redirects a vendor to /vendor instead of the regular shell (Vendor Accounts, Phase 4)", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    stubFetch(ME_VENDOR);
    renderGuarded();
    await waitFor(() => expect(screen.getByText("vendor dashboard")).toBeInTheDocument());
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("does not redirect away from /vendor for a vendor caller", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    stubFetch(ME_VENDOR);
    renderGuarded("/vendor");
    expect(await screen.findByText("vendor dashboard")).toBeInTheDocument();
  });

  it("does not redirect a non-vendor (owner) away from the regular shell", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    stubFetch(ME);
    renderGuarded();
    expect(await screen.findByText("protected content")).toBeInTheDocument();
  });
});
