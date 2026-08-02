import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
import { CreateCompanyPage } from "./create-company-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CAPABILITIES = { features: [], permissions: [], isSuperAdmin: false };

const CREATE_RESPONSE = {
  company: {
    id: "c1",
    name: "Acme Gifts",
    slug: null,
    status: "active",
    phone: "+201234567890",
    monthlyOrdersRange: "100_500",
    country: null,
    facebookHandle: null,
    instagramHandle: null,
    websiteUrl: null,
    shippingCarrier: null,
    createdAt: new Date().toISOString(),
  },
  tokens: { accessToken: "a2", refreshToken: "r2", tokenType: "Bearer", expiresIn: 300 },
};

const ME_NO_COMPANY = {
  id: "u1",
  email: "founder@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: null,
  companies: [],
};

const ME_AFTER_CREATE = {
  id: "u1",
  email: "founder@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: "c1",
  companies: [{ id: "c1", name: "Acme Gifts", slug: null, role: "owner", status: "active" }],
};

/**
 * Routes each fetch call by URL/method rather than call order, since
 * {@link CapabilitiesProvider} fires an unrelated `GET /access/capabilities`
 * as soon as the session hydrates — a strict ordered mock queue would be
 * thrown off by it.
 */
function routedFetch(opts: {
  createStatus?: number;
  createBody?: unknown;
  meAfterCreate?: unknown;
}): ReturnType<typeof vi.fn> {
  const {
    createStatus = 201,
    createBody = CREATE_RESPONSE,
    meAfterCreate = ME_AFTER_CREATE,
  } = opts;
  let meCalls = 0;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/me")) {
      meCalls += 1;
      return Promise.resolve(json(200, meCalls === 1 ? ME_NO_COMPANY : meAfterCreate));
    }
    if (url.endsWith("/access/capabilities")) {
      return Promise.resolve(json(200, CAPABILITIES));
    }
    if (url.endsWith("/companies") && method === "POST") {
      return Promise.resolve(json(createStatus, createBody));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function renderCreate(): void {
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  render(
    <AppProviders>
      <MemoryRouter initialEntries={["/onboarding/create"]}>
        <Routes>
          <Route path="/onboarding/create" element={<CreateCompanyPage />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText("اسم الشركة"), "Acme Gifts");
  await user.type(screen.getByLabelText("رقم الجوال"), "+201234567890");
  await user.selectOptions(screen.getByLabelText("عدد الطلبات الشهرية"), "100_500");
}

describe("CreateCompanyPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates the company with the required fields and lands on the dashboard", async () => {
    const user = userEvent.setup();
    const fetchMock = routedFetch({});
    vi.stubGlobal("fetch", fetchMock);
    renderCreate();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "إنشاء شركة" }));

    expect(await screen.findByText("home page")).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).endsWith("/companies") && call[1]?.method === "POST",
    );
    const body = JSON.parse(String(createCall?.[1]?.body)) as Record<string, unknown>;
    expect(body["name"]).toBe("Acme Gifts");
    expect(body["phone"]).toBe("+201234567890");
    expect(body["monthlyOrdersRange"]).toBe("100_500");
  });

  it("reveals the Facebook handle field only once the checkbox is checked", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", routedFetch({}));
    renderCreate();

    expect(screen.queryByLabelText("رابط أو اسم صفحة الفيسبوك")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("هل لديك صفحة فيسبوك؟"));
    expect(screen.getByLabelText("رابط أو اسم صفحة الفيسبوك")).toBeInTheDocument();
  });

  it("shows an error message when company creation fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      routedFetch({
        createStatus: 500,
        createBody: { error: { code: "INTERNAL", statusCode: 500, message: "boom" } },
      }),
    );
    renderCreate();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "إنشاء شركة" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("حدث خطأ ما. حاول مرة أخرى.");
  });
});
