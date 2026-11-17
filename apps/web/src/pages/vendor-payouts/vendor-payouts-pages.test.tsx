import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
import { VendorAccountPage } from "../vendor/vendor-account-page";
import { VendorPayoutDetailPage } from "./vendor-payout-detail-page";
import { VendorPayoutsPage } from "./vendor-payouts-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const PAYOUT = "44444444-4444-4444-4444-444444444444";

function me(role: string): Record<string, unknown> {
  return {
    id: "u1",
    email: "u@test.dev",
    fullName: "Me",
    phone: null,
    twoFactorEnabled: false,
    activeCompanyId: "c1",
    companies: [{ id: "c1", name: "Acme", slug: "acme", role, status: "active" }],
  };
}

const CAPS = {
  features: ["vendor_payouts"],
  permissions: ["vendor_payouts.read", "vendor_payouts.manage"],
  isSuperAdmin: false,
};

function balance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    warehouseId: WAREHOUSE,
    warehouseName: "Mugs Warehouse",
    vendorName: "Ali",
    owedMinor: 18000,
    pendingMinor: 0,
    paidMinor: 5000,
    needsPricingCount: 0,
    pendingPayoutId: null,
    ...overrides,
  };
}

const ENTRY = {
  id: "e1",
  kind: "accrual",
  orderId: "o1",
  orderNumber: 1042,
  variantId: "v1",
  nameSnapshot: "Classic Mug — Red",
  quantity: 2,
  unitCostMinor: 9000,
  amountMinor: 18000,
  needsPricing: false,
  payoutId: null,
  state: "open",
  note: null,
  createdAt: "2026-11-17T10:00:00.000Z",
};

function payout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PAYOUT,
    warehouseId: WAREHOUSE,
    warehouseName: "Mugs Warehouse",
    amountMinor: 18000,
    method: "instapay",
    reference: "TX-9",
    notes: null,
    status: "pending",
    confirmationKind: null,
    forceReason: null,
    confirmedAt: null,
    cancelledAt: null,
    entryCount: 1,
    createdAt: "2026-11-17T10:00:00.000Z",
    ...overrides,
  };
}

const page = (data: unknown[]) => ({
  data,
  page: { limit: 25, nextCursor: null, hasMore: false },
});

type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;

function routedFetch(role: string, handler: Handler): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(json(200, me(role)));
    if (url.endsWith("/access/capabilities")) return Promise.resolve(json(200, CAPS));
    const answer = handler(url, init);
    return Promise.resolve(answer ?? new Response(null, { status: 404 }));
  });
}

function renderAt(path: string, fetchMock: ReturnType<typeof vi.fn>): void {
  localStorage.setItem("cadeau.locale", "en");
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders>
        <Routes>
          <Route path="/vendor/account" element={<VendorAccountPage />} />
          <Route path="/vendor-payouts" element={<VendorPayoutsPage />} />
          <Route path="/vendor-payouts/:warehouseId" element={<VendorPayoutDetailPage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, fragment: string, method = "POST") {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).includes(fragment) &&
      ((init as RequestInit | undefined)?.method ?? "GET") === method,
  );
}

describe("VendorAccountPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the balance, statement and pending payout, and confirms receipt in two steps", async () => {
    let confirmed = false;
    const fetchMock = routedFetch("vendor", (url, init) => {
      if (url.endsWith("/vendor/account")) {
        return json(200, balance({ pendingMinor: confirmed ? 0 : 18000, owedMinor: 0 }));
      }
      if (url.includes("/vendor/account/ledger")) return json(200, page([ENTRY]));
      if (url.includes("/vendor/account/payouts/") && init?.method === "POST") {
        confirmed = true;
        return json(200, payout({ status: "confirmed", confirmationKind: "vendor" }));
      }
      if (url.includes("/vendor/account/payouts")) {
        return json(200, page([payout(confirmed ? { status: "confirmed" } : {})]));
      }
      return undefined;
    });
    renderAt("/vendor/account", fetchMock);

    expect(await screen.findByText("A payout is waiting for you")).toBeInTheDocument();
    expect(screen.getByText("Classic Mug — Red")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "I received the money" }));
    // Nothing is sent until the confirmation dialog is accepted.
    expect(callsTo(fetchMock, "/confirm")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/180\.00/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Yes, I received it" }));

    await waitFor(() =>
      expect(callsTo(fetchMock, `/vendor/account/payouts/${PAYOUT}/confirm`)).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.queryByText("A payout is waiting for you")).not.toBeInTheDocument(),
    );
  });

  it("shows an error state when the account cannot load", async () => {
    renderAt(
      "/vendor/account",
      routedFetch("vendor", (url) =>
        url.includes("/vendor/account")
          ? json(500, { error: { code: "INTERNAL", statusCode: 500, message: "boom" } })
          : undefined,
      ),
    );
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("VendorPayoutsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists vendors with what they are owed and what needs attention", async () => {
    renderAt(
      "/vendor-payouts",
      routedFetch("owner", (url) =>
        url.endsWith("/vendor-payouts/vendors")
          ? json(200, {
              data: [
                balance({ pendingPayoutId: PAYOUT, needsPricingCount: 2 }),
                balance({
                  warehouseId: "w2",
                  warehouseName: "Plates",
                  vendorName: null,
                  owedMinor: 500,
                }),
              ],
            })
          : undefined,
      ),
    );
    expect(await screen.findByText("Mugs Warehouse")).toBeInTheDocument();
    expect(screen.getByText("Awaiting vendor")).toBeInTheDocument();
    expect(screen.getByText("2 unpriced")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mugs Warehouse/ })).toHaveAttribute(
      "href",
      `/vendor-payouts/${WAREHOUSE}`,
    );

    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Search vendors" }), "plates");
    expect(screen.queryByText("Mugs Warehouse")).not.toBeInTheDocument();
    expect(screen.getByText("Plates")).toBeInTheDocument();
  });

  it("shows the empty state when there are no vendor warehouses", async () => {
    renderAt(
      "/vendor-payouts",
      routedFetch("owner", (url) =>
        url.endsWith("/vendor-payouts/vendors") ? json(200, { data: [] }) : undefined,
      ),
    );
    expect(await screen.findByText("No vendor warehouses yet.")).toBeInTheDocument();
  });
});

describe("VendorPayoutDetailPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  function detailFetch(overrides: { pending?: boolean } = {}): ReturnType<typeof vi.fn> {
    return routedFetch("owner", (url, init) => {
      if (url.endsWith(`/vendor-payouts/vendors/${WAREHOUSE}`)) {
        return json(200, balance(overrides.pending === true ? { pendingPayoutId: PAYOUT } : {}));
      }
      if (url.includes(`/vendors/${WAREHOUSE}/ledger`)) return json(200, page([ENTRY]));
      if (url.includes(`/vendors/${WAREHOUSE}/payouts`) && init?.method === "POST") {
        return json(201, payout());
      }
      if (url.includes(`/vendors/${WAREHOUSE}/adjustments`)) {
        return json(201, { ...ENTRY, id: "adj", kind: "adjustment", amountMinor: -2550 });
      }
      if (url.includes("/force-confirm")) return json(200, payout({ status: "confirmed" }));
      if (url.includes("/cancel")) return json(200, payout({ status: "cancelled" }));
      if (url.includes("/vendor-payouts/payouts")) {
        return json(200, page(overrides.pending === true ? [payout()] : []));
      }
      return undefined;
    });
  }

  it("requests a payout of everything owed with an Idempotency-Key", async () => {
    const fetchMock = detailFetch();
    renderAt(`/vendor-payouts/${WAREHOUSE}`, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Request payout" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Payment method/), "bank_transfer");
    await user.type(within(dialog).getByLabelText(/Transfer reference/), "TX-77");
    await user.click(within(dialog).getByRole("button", { name: "Send payout" }));

    await waitFor(() =>
      expect(callsTo(fetchMock, `/vendors/${WAREHOUSE}/payouts`)).toHaveLength(1),
    );
    const [, init] = callsTo(fetchMock, `/vendors/${WAREHOUSE}/payouts`)[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      method: "bank_transfer",
      reference: "TX-77",
    });
  });

  it("posts a deduction as a negative adjustment in minor units", async () => {
    const fetchMock = detailFetch();
    renderAt(`/vendor-payouts/${WAREHOUSE}`, fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add adjustment" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Direction/), "deduct");
    await user.type(within(dialog).getByLabelText(/Amount/), "25.50");
    await user.type(within(dialog).getByLabelText(/Reason/), "exchange");
    await user.click(within(dialog).getByRole("button", { name: "Add adjustment" }));

    await waitFor(() => expect(callsTo(fetchMock, "/adjustments")).toHaveLength(1));
    const [, init] = callsTo(fetchMock, "/adjustments")[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      amountMinor: -2550,
      note: "exchange",
    });
  });

  it("confirms a pending payout on the vendor's behalf with a reason, or cancels it", async () => {
    const fetchMock = detailFetch({ pending: true });
    renderAt(`/vendor-payouts/${WAREHOUSE}`, fetchMock);
    const user = userEvent.setup();

    // A payout is already pending, so a second one cannot be requested.
    expect(await screen.findByRole("button", { name: "Request payout" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Confirm on vendor's behalf" }));
    let dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Confirm on vendor's behalf" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), "confirmed by phone");
    await user.click(submit);
    await waitFor(() => expect(callsTo(fetchMock, "/force-confirm")).toHaveLength(1));
    const [, init] = callsTo(fetchMock, "/force-confirm")[0]!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      reason: "confirmed by phone",
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(await screen.findByRole("button", { name: "Cancel payout" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel payout" }));
    await waitFor(() => expect(callsTo(fetchMock, `/payouts/${PAYOUT}/cancel`)).toHaveLength(1));
  });
});
