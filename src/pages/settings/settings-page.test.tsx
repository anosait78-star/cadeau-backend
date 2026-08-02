import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { ToastProvider } from "@/components/toast/toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { SettingsPage } from "./settings-page";

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

function renderSettings(initialPath = "/settings") {
  return render(
    <I18nProvider>
      <ToastProvider>
        {caps(
          ["master-data", "notifications", "products", "orders"],
          ["master-data.manage", "products.manage", "orders.manage"],
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/:tab" element={<SettingsPage />} />
            </Routes>
          </MemoryRouter>,
        )}
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("SettingsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(json(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to the general tab with the language switcher and a subscription placeholder", () => {
    renderSettings();
    expect(screen.getByRole("link", { name: "عام" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("اللغة")).toBeInTheDocument();
    expect(screen.getByText("تفاصيل الاشتراك والفوترة غير متاحة بعد.")).toBeInTheDocument();
  });

  it("switches to the security tab and renders the change-password form", () => {
    renderSettings("/settings/security");
    expect(screen.getByText("تغيير كلمة المرور")).toBeInTheDocument();
    expect(screen.getByText("حذف الحساب")).toBeInTheDocument();
  });

  it("switches to the data-import tab and renders both importers", () => {
    renderSettings("/settings/data-import");
    expect(screen.getByText("استيراد المنتجات")).toBeInTheDocument();
    expect(screen.getByText("استيراد الطلبات")).toBeInTheDocument();
  });

  it("switches the app language from the general tab without touching the header toggle", async () => {
    const user = userEvent.setup();
    renderSettings();
    expect(screen.getByRole("button", { name: "العربية" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(await screen.findByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches to the reasons tab and loads cancellation/return reasons", async () => {
    renderSettings("/settings/reasons");
    expect(await screen.findByText("أسباب الإلغاء")).toBeInTheDocument();
    expect(screen.getByText("أسباب الإرجاع")).toBeInTheDocument();
  });

  it("adds a cancellation reason from the reasons tab", async () => {
    const user = userEvent.setup();
    renderSettings("/settings/reasons");
    await screen.findByText("أسباب الإلغاء");

    fetchMock.mockResolvedValueOnce(
      json(201, {
        id: "r1",
        active: true,
        createdAt: "",
        updatedAt: "",
        name: "متكرر",
        kind: "cancellation",
      }),
    );
    const inputs = screen.getAllByPlaceholderText("أدخل سببًا...");
    await user.type(inputs[0]!, "متكرر");
    await user.click(screen.getAllByRole("button", { name: "إضافة" })[0]!);

    await waitFor(() => expect(screen.getByText("متكرر")).toBeInTheDocument());
  });

  it("switches to the shipping tab and loads zones and carriers", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/shipping/carriers"))
        return Promise.resolve(json(200, { data: [{ key: "manual" }] }));
      return Promise.resolve(json(200, { data: [] }));
    });
    renderSettings("/settings/shipping");
    expect(await screen.findByText("مناطق الشحن")).toBeInTheDocument();
    expect(await screen.findByText("manual")).toBeInTheDocument();
  });

  it("embeds the notifications preferences screen on the notifications tab", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: [] }));
    renderSettings("/settings/notifications");
    expect(await screen.findByText("تفضيلات الإشعارات")).toBeInTheDocument();
  });
});
