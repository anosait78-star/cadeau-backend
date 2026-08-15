import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
import { JoinCompanyPage } from "./join-company-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CAPABILITIES = { features: [], permissions: [], isSuperAdmin: false };

const ME_NO_COMPANY = {
  id: "u1",
  email: "member@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: null,
  companies: [],
};

const ME_AFTER_JOIN = {
  id: "u1",
  email: "member@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: "c1",
  companies: [{ id: "c1", name: "Acme", slug: "acme", role: "member", status: "active" }],
};

/**
 * Routes each fetch call by URL/method rather than call order, since
 * {@link CapabilitiesProvider} fires an unrelated `GET /access/capabilities`
 * as soon as the session hydrates — a strict ordered mock queue would be
 * thrown off by it.
 */
function routedFetch(opts: {
  acceptStatus?: number;
  acceptBody?: unknown;
  warehouseAcceptStatus?: number;
  warehouseAcceptBody?: unknown;
}): ReturnType<typeof vi.fn> {
  const {
    acceptStatus = 200,
    acceptBody = { companyId: "c1", role: "member", alreadyMember: false },
    warehouseAcceptStatus = 200,
    warehouseAcceptBody = {
      companyId: "c1",
      role: "vendor",
      warehouseId: "w1",
      alreadyMember: false,
    },
  } = opts;
  let meCalls = 0;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/me")) {
      meCalls += 1;
      return Promise.resolve(json(200, meCalls === 1 ? ME_NO_COMPANY : ME_AFTER_JOIN));
    }
    if (url.endsWith("/access/capabilities")) {
      return Promise.resolve(json(200, CAPABILITIES));
    }
    if (url.endsWith("/invitations/accept") && method === "POST") {
      return Promise.resolve(json(acceptStatus, acceptBody));
    }
    if (url.endsWith("/warehouse-join-codes/accept") && method === "POST") {
      return Promise.resolve(json(warehouseAcceptStatus, warehouseAcceptBody));
    }
    if (url.endsWith("/companies/c1/switch") && method === "POST") {
      return Promise.resolve(json(200, { accessToken: "a2", refreshToken: "r2", expiresIn: 300 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function renderJoin(): void {
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  render(
    <AppProviders>
      <MemoryRouter initialEntries={["/onboarding/join"]}>
        <Routes>
          <Route path="/onboarding/join" element={<JoinCompanyPage />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("JoinCompanyPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins the company by invite code and lands on the dashboard", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", routedFetch({}));
    renderJoin();

    await user.type(screen.getByLabelText("رمز الدعوة"), "a-valid-invite-code");
    await user.click(screen.getByRole("button", { name: "الانضمام" }));

    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("shows an invalid-invitation message on a 404", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      routedFetch({
        acceptStatus: 404,
        acceptBody: { error: { code: "NOT_FOUND", statusCode: 404, message: "not found" } },
      }),
    );
    renderJoin();

    await user.type(screen.getByLabelText("رمز الدعوة"), "a-bad-invite-code");
    await user.click(screen.getByRole("button", { name: "الانضمام" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "رمز الدعوة غير صالح أو منتهي الصلاحية.",
    );
  });

  it("joins as a vendor by warehouse code (Vendor Accounts, Phase 1)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", routedFetch({}));
    renderJoin();

    await user.click(screen.getByRole("radio", { name: "كود تاجر / مستودع" }));
    await user.type(screen.getByLabelText("كود دعوة المستودع"), "a-warehouse-join-code");
    await user.click(screen.getByRole("button", { name: "الانضمام" }));

    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("shows an invalid-warehouse-code message on a 404", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      routedFetch({
        warehouseAcceptStatus: 404,
        warehouseAcceptBody: {
          error: { code: "NOT_FOUND", statusCode: 404, message: "not found" },
        },
      }),
    );
    renderJoin();

    await user.click(screen.getByRole("radio", { name: "كود تاجر / مستودع" }));
    await user.type(screen.getByLabelText("كود دعوة المستودع"), "a-bad-warehouse-code");
    await user.click(screen.getByRole("button", { name: "الانضمام" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "كود دعوة المستودع غير صالح أو تم إلغاؤه.",
    );
  });
});
