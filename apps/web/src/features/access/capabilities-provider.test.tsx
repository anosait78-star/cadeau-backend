import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTokens, writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
import { useCapabilities } from "./use-capabilities";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ME = {
  id: "u1",
  email: "founder@acme.test",
  fullName: "Amina",
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: "c1",
  companies: [{ id: "c1", name: "Acme", slug: "acme", role: "owner", status: "active" }],
};

function Probe(): ReactNode {
  const { status, features, permissions, isSuperAdmin } = useCapabilities();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="features">{features.join(",")}</span>
      <span data-testid="perms">{permissions.join(",")}</span>
      <span data-testid="sa">{String(isSuperAdmin)}</span>
    </div>
  );
}

describe("CapabilitiesProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.includes("/access/capabilities")) {
        return Promise.resolve(
          json(200, {
            features: ["orders"],
            permissions: ["orders.read", "access.read"],
            isSuperAdmin: true,
            activeCompanyId: "c1",
          }),
        );
      }
      if (url.includes("/me")) return Promise.resolve(json(200, ME));
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it("is unauthenticated with no tokens and loads nothing", async () => {
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
    expect(screen.getByTestId("features")).toHaveTextContent("");
  });

  it("loads capabilities once the session is authenticated", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("features")).toHaveTextContent("orders");
    expect(screen.getByTestId("perms")).toHaveTextContent("orders.read,access.read");
    expect(screen.getByTestId("sa")).toHaveTextContent("true");
  });
});
