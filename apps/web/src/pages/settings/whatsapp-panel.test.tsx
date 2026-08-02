import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/auth/auth-provider";
import { writeTokens } from "@/auth/auth-storage";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { I18nProvider } from "@/i18n/i18n-provider";
import { WhatsappPanel } from "./whatsapp-panel";

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ME = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  email: "founder@acme.test",
  fullName: null,
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: "c1",
  companies: [
    {
      id: "c1",
      name: "Acme",
      slug: "acme",
      role: "owner",
      status: "active",
      whatsappCountryCode: null,
    },
  ],
  ...over,
});

function renderPanel(): void {
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  const caps: CapabilitiesContextValue = {
    status: "ready",
    features: ["master-data"],
    permissions: ["master-data.manage"],
    isSuperAdmin: false,
    has: (req: CapabilityRequirement) =>
      (req.feature === undefined || caps.features.includes(req.feature)) &&
      (req.permission === undefined || caps.permissions.includes(req.permission)),
    reload: () => Promise.resolve(),
  };
  render(
    <I18nProvider>
      <AuthProvider>
        <CapabilitiesContext value={caps}>
          <WhatsappPanel />
        </CapabilitiesContext>
      </AuthProvider>
    </I18nProvider>,
  );
}

describe("WhatsappPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads templates and saves the country prefix", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(json(200, ME()));
      if (url.includes("/master-data/whatsapp-templates")) {
        return Promise.resolve(json(200, { data: [] }));
      }
      if (url.includes("/whatsapp-settings")) {
        return Promise.resolve(json(200, { id: "c1", whatsappCountryCode: "20" }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPanel();

    await screen.findByText("لا توجد قوالب بعد.");

    await user.type(screen.getByLabelText("بادئة الدولة"), "20");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        (c[0] as string).includes("/companies/c1/whatsapp-settings"),
      );
      expect(call).toBeDefined();
    });
    expect(await screen.findByText("تم الحفظ")).toBeInTheDocument();
  });

  it("adds a template", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(json(200, ME()));
      if (url.includes("/master-data/whatsapp-templates")) {
        return Promise.resolve(json(200, { data: [] }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderPanel();
    await screen.findByText("لا توجد قوالب بعد.");

    await user.click(screen.getByRole("button", { name: "إضافة قالب" }));
    await user.type(screen.getByLabelText("الاسم"), "تأكيد الطلب");
    await user.type(screen.getByLabelText("نص القالب"), "شكرًا لطلبك!");

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        json(201, {
          id: "t1",
          active: true,
          createdAt: "",
          updatedAt: "",
          name: "تأكيد الطلب",
          body: "شكرًا لطلبك!",
        }),
      ),
    );
    const saveButtons = screen.getAllByRole("button", { name: "حفظ" });
    await user.click(saveButtons[saveButtons.length - 1]!);

    expect(await screen.findByText("تأكيد الطلب")).toBeInTheDocument();
    expect(screen.getByText("شكرًا لطلبك!")).toBeInTheDocument();
  });
});
