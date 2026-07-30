import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AuthProvider } from "./auth-provider";
import { readTokens, writeTokens } from "./auth-storage";
import { useAuth } from "./use-auth";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ME = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  email: "founder@acme.test",
  fullName: "Amina",
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: "c1",
  companies: [{ id: "c1", name: "Acme", slug: "acme", role: "owner", status: "active" }],
  ...over,
});

/** A tiny probe that surfaces auth state + actions for assertions. */
function Probe(): ReactNode {
  const { status, user, login, logout, switchCompany } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="email">{user?.email ?? "-"}</span>
      <span data-testid="active">{user?.activeCompanyId ?? "-"}</span>
      <button onClick={() => void login({ email: "a@b.co", password: "pw" })}>login</button>
      <button onClick={() => void logout()}>logout</button>
      <button onClick={() => void switchCompany("c2")}>switch</button>
    </div>
  );
}

function renderAuth(): void {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves to unauthenticated when there are no stored tokens", async () => {
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hydrates the session from stored tokens via GET /me", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    fetchMock.mockResolvedValueOnce(json(200, ME()));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(screen.getByTestId("email")).toHaveTextContent("founder@acme.test");
  });

  it("clears the session when the stored token is rejected", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    // /me → 401, then refresh → 401 (unrecoverable).
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: "UNAUTHORIZED", statusCode: 401 } }))
      .mockResolvedValueOnce(json(401, { error: { code: "UNAUTHORIZED", statusCode: 401 } }));
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(readTokens()).toBeNull();
  });

  it("logs in: stores tokens and loads the profile", async () => {
    const user = userEvent.setup();
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));

    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          accessToken: "a",
          refreshToken: "r",
          tokenType: "Bearer",
          expiresIn: 300,
          user: { id: "u1", email: "founder@acme.test", fullName: "Amina" },
        }),
      )
      .mockResolvedValueOnce(json(200, ME()));

    await user.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    expect(readTokens()?.accessToken).toBe("a");
  });

  it("switches the active company and re-issues tokens", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    fetchMock.mockResolvedValueOnce(json(200, ME()));
    const user = userEvent.setup();
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("c1"));

    fetchMock
      .mockResolvedValueOnce(
        json(200, { accessToken: "a2", refreshToken: "r2", tokenType: "Bearer", expiresIn: 300 }),
      )
      .mockResolvedValueOnce(
        json(
          200,
          ME({
            activeCompanyId: "c2",
            companies: [
              { id: "c1", name: "Acme", slug: "acme", role: "owner", status: "active" },
              { id: "c2", name: "Beta", slug: "beta", role: "member", status: "active" },
            ],
          }),
        ),
      );

    await user.click(screen.getByText("switch"));
    await waitFor(() => expect(screen.getByTestId("active")).toHaveTextContent("c2"));
    expect(readTokens()?.accessToken).toBe("a2");
  });

  it("logs out: revokes and clears the session", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    fetchMock.mockResolvedValueOnce(json(200, ME()));
    const user = userEvent.setup();
    renderAuth();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await user.click(screen.getByText("logout"));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(readTokens()).toBeNull();
  });
});
