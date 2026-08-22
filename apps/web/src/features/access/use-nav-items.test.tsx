import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/auth/auth-provider";
import { writeTokens } from "@/auth/auth-storage";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilitiesStatus,
  type CapabilityRequirement,
} from "./capabilities-context";
import { useNavItems } from "./use-nav-items";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** No stored tokens ⇒ `AuthProvider` resolves to unauthenticated synchronously (no vendor role). */
function wrapper(
  status: CapabilitiesStatus,
  features: string[],
  permissions: string[],
  isSuperAdmin: boolean,
) {
  const value: CapabilitiesContextValue = {
    status,
    features,
    permissions,
    isSuperAdmin,
    has: (req: CapabilityRequirement) =>
      (req.feature === undefined || features.includes(req.feature)) &&
      (req.permission === undefined || permissions.includes(req.permission)),
    reload: () => Promise.resolve(),
  };
  return ({ children }: { children: ReactNode }): ReactNode => (
    <AuthProvider>
      <CapabilitiesContext value={value}>{children}</CapabilitiesContext>
    </AuthProvider>
  );
}

describe("useNavItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives a vendor member the short vendor-only list instead of the filtered company list", async () => {
    writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          json(200, {
            id: "u1",
            email: "v@acme.test",
            fullName: null,
            phone: null,
            twoFactorEnabled: false,
            activeCompanyId: "c1",
            companies: [{ id: "c1", name: "Acme", slug: "acme", role: "vendor", status: "active" }],
          }),
        ),
      ),
    );
    const { result } = renderHook(() => useNavItems(), {
      wrapper: wrapper("ready", [], [], false),
    });
    await waitFor(() =>
      expect(result.current.map((i) => i.to)).toEqual(["/vendor", "/vendor/orders"]),
    );
  });

  it("returns the full list when capabilities are not ready (no flicker)", () => {
    const { result } = renderHook(() => useNavItems(), {
      wrapper: wrapper("loading", [], [], false),
    });
    expect(result.current.some((i) => i.to === "/orders")).toBe(true);
    expect(result.current.some((i) => i.to === "/admin")).toBe(true);
  });

  it("hides feature- and permission-gated items that are not satisfied", () => {
    const { result } = renderHook(() => useNavItems(), {
      wrapper: wrapper("ready", ["orders"], [], false),
    });
    const paths = result.current.map((i) => i.to);
    expect(paths).toContain("/"); // ungated
    expect(paths).toContain("/orders"); // feature satisfied
    expect(paths).not.toContain("/customers"); // feature missing
    expect(paths).not.toContain("/settings/roles"); // access.read missing
    expect(paths).not.toContain("/admin"); // not a super-admin
  });

  it("shows the admin item only to super-admins and roles with access.read", () => {
    const { result } = renderHook(() => useNavItems(), {
      wrapper: wrapper("ready", [], ["access.read"], true),
    });
    const paths = result.current.map((i) => i.to);
    expect(paths).toContain("/admin");
    expect(paths).toContain("/settings/roles");
  });
});
