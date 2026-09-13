import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/toast";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { I18nProvider } from "@/i18n/i18n-provider";
import { TeamPage } from "./team-page";

/**
 * The merged Team page: role cards (formerly the Roles page), member cards
 * with their effective permissions, and the manage-only invitations section.
 */

const auth = vi.hoisted(() => ({
  user: {
    id: "u1",
    email: "owner@example.com",
    name: "Owner",
    activeCompanyId: "c1",
    companies: [{ id: "c1", name: "Cadeau", role: "owner", status: "active" }],
  },
}));

vi.mock("@/auth/use-auth", () => ({ useAuth: () => auth }));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TEMPLATES = [
  {
    key: "owner",
    name: "Owner",
    description: "Full access to everything in the company.",
    permissions: ["orders.read", "orders.manage", "orders.vendor_groups.override"],
  },
  {
    key: "store_manager",
    name: "Store Manager",
    description: null,
    permissions: [
      "orders.read",
      "orders.manage",
      "customers.read",
      "customers.manage",
      "products.read",
      "products.manage",
    ],
  },
];

const MEMBERS = [
  {
    id: "m1",
    name: "Sara Ali",
    email: "sara@example.com",
    role: "store_manager",
    status: "active",
    joinedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "m2",
    name: "Omar",
    email: "omar@example.com",
    role: "store_manager",
    status: "active",
    joinedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "m3",
    name: "Mona",
    email: "mona@example.com",
    role: "custom",
    status: "active",
    joinedAt: "2026-01-03T00:00:00.000Z",
  },
];

let fetchMock: ReturnType<typeof vi.fn>;
let memberPermissionsStatus = 200;

beforeEach(() => {
  memberPermissionsStatus = 200;
  localStorage.clear();
  localStorage.setItem("cadeau.locale", "en");
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  fetchMock = vi.fn((input: string | URL) => {
    const url = String(input);
    if (url.includes("/access/permission-templates")) {
      return Promise.resolve(json(200, { data: TEMPLATES }));
    }
    if (url.includes("/access/members/permissions")) {
      return memberPermissionsStatus === 200
        ? Promise.resolve(
            json(200, {
              data: [
                { memberId: "m1", role: "store_manager", permissions: ["orders.read"] },
                { memberId: "m2", role: "store_manager", permissions: [] },
                { memberId: "m3", role: "custom", permissions: ["customers.manage"] },
              ],
            }),
          )
        : Promise.resolve(json(500, { error: { code: "INTERNAL", statusCode: 500 } }));
    }
    if (url.includes("/access/available-permissions")) {
      return Promise.resolve(
        json(200, {
          data: [{ key: "orders.read", description: null, featureKey: "orders", available: true }],
        }),
      );
    }
    if (url.includes("/companies/c1/members")) return Promise.resolve(json(200, { data: MEMBERS }));
    if (url.includes("/companies/c1/invitations")) {
      return Promise.resolve(
        json(200, {
          data: [
            {
              id: "i1",
              role: "finance",
              permissionKeys: [],
              status: "pending",
              expiresAt: "2999-01-01T00:00:00.000Z",
            },
          ],
        }),
      );
    }
    return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function caps(permissions: string[], children: ReactNode): ReactNode {
  const value: CapabilitiesContextValue = {
    status: "ready",
    features: [],
    permissions,
    isSuperAdmin: false,
    has: (req: CapabilityRequirement) =>
      req.permission === undefined || permissions.includes(req.permission),
    reload: () => Promise.resolve(),
  };
  return <CapabilitiesContext value={value}>{children}</CapabilitiesContext>;
}

function renderPage(permissions = ["access.read", "access.manage"]) {
  return render(
    <I18nProvider>
      <ToastProvider>{caps(permissions, <TeamPage />)}</ToastProvider>
    </I18nProvider>,
  );
}

describe("TeamPage", () => {
  it("renders role cards in Arabic, never the seed's English or raw keys", async () => {
    localStorage.setItem("cadeau.locale", "ar");
    renderPage();
    const owner = await screen.findByTestId("role-card-owner");
    expect(within(owner).getByText("مالك")).toBeInTheDocument();
    expect(within(owner).getByText("صلاحية كاملة على كل شيء في الشركة.")).toBeInTheDocument();
    expect(within(owner).getByText("عرض الطلبات")).toBeInTheDocument();
    expect(within(owner).getByText("إدارة الطلبات")).toBeInTheDocument();
    expect(within(owner).getByText("تجاوز حالة التاجر")).toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
    expect(screen.queryByText("orders.manage")).not.toBeInTheDocument();
    expect(screen.queryByText("orders.vendor_groups.override")).not.toBeInTheDocument();
  });

  it("counts each role's members and collapses the extra permissions into +N more", async () => {
    renderPage();
    const card = await screen.findByTestId("role-card-store_manager");
    await waitFor(() => expect(within(card).getByText("2 users")).toBeInTheDocument());
    expect(within(card).getByText("6 permissions")).toBeInTheDocument();
    expect(within(card).getByText("+2 more")).toBeInTheDocument();
    expect(within(screen.getByTestId("role-card-owner")).getByText("0 users")).toBeInTheDocument();
  });

  it("shows each member's effective permissions, including a custom member's", async () => {
    renderPage();
    const custom = await screen.findByTestId("member-card-m3");
    expect(within(custom).getByText("Custom")).toBeInTheDocument();
    await waitFor(() => expect(within(custom).getByText("Manage Customers")).toBeInTheDocument());
    expect(
      within(screen.getByTestId("member-card-m2")).getByText("No permissions assigned."),
    ).toBeInTheDocument();
  });

  it("still shows members when their permissions fail to load", async () => {
    memberPermissionsStatus = 500;
    renderPage();
    const card = await screen.findByTestId("member-card-m1");
    expect(within(card).getByText("Sara Ali")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(card).getByText("Permissions could not be loaded.")).toBeInTheDocument(),
    );
  });

  it("filters roles by their translated name", async () => {
    localStorage.setItem("cadeau.locale", "ar");
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("role-card-store_manager");
    await user.type(screen.getByRole("searchbox"), "مالك");
    expect(screen.getByTestId("role-card-owner")).toBeInTheDocument();
    expect(screen.queryByTestId("role-card-store_manager")).not.toBeInTheDocument();
  });

  it("does not pretend to save a role, and sends nothing", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("role-card-owner");
    await user.click(screen.getByRole("button", { name: "Add new role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Role name"), "Packer");
    await user.click(within(dialog).getByRole("button", { name: "Save role" }));
    expect(
      await within(dialog).findByText("Saving roles will be available in the next phase."),
    ).toBeInTheDocument();
    const writes = fetchMock.mock.calls.filter(
      ([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") !== "GET",
    );
    expect(writes).toHaveLength(0);
  });

  it("shows invitations and the manage buttons only with access.manage", async () => {
    renderPage();
    expect(await screen.findByText("Pending invitations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite member" })).toBeInTheDocument();
  });

  it("hides invitations and never asks for them without access.manage", async () => {
    renderPage(["access.read"]);
    await screen.findByTestId("role-card-owner");
    expect(screen.queryByText("Pending invitations")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add new role" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/invitations"))).toBe(false);
  });
});
