import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { ToastProvider } from "@/components/toast/toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { CustomersPage } from "./customers-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function caps(features: string[], permissions: string[], children: ReactNode): ReactNode {
  const value: CapabilitiesContextValue = {
    status: "ready",
    features,
    permissions,
    isSuperAdmin: false,
    has: (req: CapabilityRequirement) =>
      (req.feature === undefined || features.includes(req.feature)) &&
      (req.permission === undefined || permissions.includes(req.permission)),
    reload: () => Promise.resolve(),
  };
  return <CapabilitiesContext value={value}>{children}</CapabilitiesContext>;
}

/**
 * Opens a customer from the list. The row itself is the affordance now — its
 * actions and full fields live in the detail panel it opens, not on its face.
 */
async function openCustomer(name: string): Promise<void> {
  const label = await screen.findByText(name);
  const row = label.closest("li");
  if (row === null) throw new Error("no row for " + name);
  await userEvent.click(within(row).getByRole("button"));
}

function renderPage(
  features = ["customers"],
  permissions = ["customers.read", "customers.manage"],
) {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>{caps(features, permissions, <CustomersPage />)}</ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

const LIST_ROW = {
  id: "c1",
  name: "Sara",
  phoneMasked: "+2010•••4567",
  email: "sara@example.com",
  ordersCount: 3,
  totalSpent: 125000,
  lastOrderAt: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const DETAIL = {
  id: "c1",
  name: "Sara",
  phone: "+201001234567",
  email: "sara@example.com",
  notes: "VIP",
  ordersCount: 3,
  totalSpent: 125000,
  lastOrderAt: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  addresses: [
    {
      id: "a1",
      customerId: "c1",
      line: "12 Nile St",
      landmark: null,
      notes: null,
      governorateId: "g1",
      isDefault: true,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const GOVERNORATES = {
  data: [
    {
      id: "g1",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name: "Cairo",
    },
  ],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

const CUSTOMERS_PAGE = {
  data: [LIST_ROW],
  page: { limit: 25, nextCursor: null, hasMore: false },
};

function conflict(): Response {
  return json(409, {
    error: {
      code: "CONFLICT",
      message: "A customer with this phone already exists.",
      statusCode: 409,
    },
  });
}

describe("CustomersPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem("cadeau.locale", "en");
    fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/master-data/governorates"))
        return Promise.resolve(json(200, GOVERNORATES));
      if (url.match(/\/customers\/c1\/addresses$/) && method === "POST") {
        return Promise.resolve(
          json(201, {
            id: "a2",
            customerId: "c1",
            line: "5 Tahrir Sq",
            landmark: null,
            notes: null,
            governorateId: null,
            isDefault: false,
            active: true,
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          }),
        );
      }
      if (url.match(/\/customers\/c1\/orders/) && method === "GET") {
        return Promise.resolve(
          json(200, { data: [], page: { limit: 25, nextCursor: null, hasMore: false } }),
        );
      }
      if (url.match(/\/customers\/c1$/) && method === "GET")
        return Promise.resolve(json(200, DETAIL));
      if (url.match(/\/customers\/c1$/) && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.match(/\/customers\/c1$/) && method === "PATCH") {
        return Promise.resolve(json(200, { ...DETAIL, name: "Sara Ali" }));
      }
      if (url.includes("/customers") && method === "POST") {
        return Promise.resolve(json(201, { ...DETAIL, id: "c2", name: "Mona" }));
      }
      if (url.includes("/customers")) return Promise.resolve(json(200, CUSTOMERS_PAGE));
      return Promise.resolve(json(404, { error: { code: "NOT_FOUND", statusCode: 404 } }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists customers with a masked phone and the derived KPIs", async () => {
    renderPage();
    expect(await screen.findByText("Sara")).toBeInTheDocument();
    expect(screen.getByText("+2010•••4567")).toBeInTheDocument();
    expect(screen.getByText("1,250.00")).toBeInTheDocument();
    // The full number is not on the page until a detail read happens.
    expect(screen.queryByText("+201001234567")).not.toBeInTheDocument();
  });

  it("puts each customer on one row, with actions behind it rather than on it", async () => {
    renderPage();
    const row = (await screen.findByText("Sara")).closest("li");
    if (row === null) throw new Error("row not found");

    // Name, masked phone and money are all on the row itself…
    expect(within(row).getByText("Sara")).toBeInTheDocument();
    expect(within(row).getByText("+2010•••4567")).toBeInTheDocument();
    expect(within(row).getByText("1,250.00")).toBeInTheDocument();

    // …but its actions are not: the row is one control that opens the panel,
    // which is what keeps a list of customers scannable.
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    expect(within(row).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
  it("hides the whole screen without the feature", () => {
    renderPage([], []);
    expect(screen.getByText("You do not have access to customers.")).toBeInTheDocument();
  });

  it("hides create/edit actions without the manage permission", async () => {
    renderPage(["customers"], ["customers.read"]);
    await screen.findByText("Sara");
    expect(screen.queryByRole("button", { name: "New customer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("reveals the full phone and the addresses only on the detail read", async () => {
    renderPage();
    await openCustomer("Sara");
    await userEvent.click(await screen.findByRole("button", { name: "Details" }));

    expect(await screen.findByText("+201001234567")).toBeInTheDocument();
    expect(screen.getByText(/12 Nile St/)).toBeInTheDocument();
    expect(screen.getByText(/Cairo/)).toBeInTheDocument();
  });

  it("creates a customer", async () => {
    renderPage();
    await screen.findByText("Sara");
    await userEvent.click(screen.getByRole("button", { name: "New customer" }));
    await userEvent.type(screen.getByLabelText("Name"), "Mona");
    await userEvent.type(screen.getByLabelText("Phone"), "+201009998888");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Mona")).toBeInTheDocument();
    const posted = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/customers") && (c[1] as RequestInit)?.method === "POST",
    );
    expect(JSON.parse(String((posted?.[1] as RequestInit).body))).toMatchObject({
      name: "Mona",
      phone: "+201009998888",
    });
  });

  it("shows a duplicate-phone conflict as its own message", async () => {
    fetchMock.mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/master-data/governorates"))
        return Promise.resolve(json(200, GOVERNORATES));
      if (url.includes("/customers") && (init?.method ?? "GET") === "POST") {
        return Promise.resolve(conflict());
      }
      return Promise.resolve(json(200, CUSTOMERS_PAGE));
    });

    renderPage();
    await screen.findByText("Sara");
    await userEvent.click(screen.getByRole("button", { name: "New customer" }));
    await userEvent.type(screen.getByLabelText("Name"), "Mona");
    await userEvent.type(screen.getByLabelText("Phone"), "+201001234567");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("A customer with this phone number already exists."),
    ).toBeInTheDocument();
  });

  it("edits a customer without sending the phone when it is left blank", async () => {
    renderPage();
    await openCustomer("Sara");
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Sara Ali");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findAllByText("Sara Ali")).length).toBeGreaterThan(0);
    const patched = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/customers/c1") && (c[1] as RequestInit)?.method === "PATCH",
    );
    const body = JSON.parse(String((patched?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("phone");
  });

  it("keeps the list row masked after an edit returns the full phone", async () => {
    renderPage();
    await openCustomer("Sara");
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findAllByText("Sara Ali");
    expect(screen.getAllByText("+2010•••4567").length).toBeGreaterThan(0);
    expect(screen.queryByText("+201001234567")).not.toBeInTheDocument();
  });

  it("archives a customer", async () => {
    renderPage();
    const row = (await screen.findByText("Sara")).closest("li");
    if (row === null) throw new Error("row not found");
    await openCustomer("Sara");
    await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(within(row as HTMLElement).getByTestId("status")).toHaveTextContent("Archived"),
    );
  });

  it("adds an address to a customer", async () => {
    renderPage();
    await openCustomer("Sara");
    await userEvent.click(await screen.findByRole("button", { name: "Details" }));
    await screen.findByText("+201001234567");

    await userEvent.click(screen.getByRole("button", { name: "Add address" }));
    await userEvent.type(screen.getByLabelText("Address"), "5 Tahrir Sq");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/5 Tahrir Sq/)).toBeInTheDocument();
  });

  it("renders an error state and retries the list", async () => {
    fetchMock.mockImplementation((input: string | URL) =>
      String(input).includes("/master-data/governorates")
        ? Promise.resolve(json(200, GOVERNORATES))
        : Promise.resolve(json(500, { error: { code: "INTERNAL", statusCode: 500 } })),
    );

    renderPage();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });
});
