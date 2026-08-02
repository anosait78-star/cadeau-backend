import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { ToastProvider } from "@/components/toast/toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { NotificationsPage } from "./notifications-page";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function caps(features: string[], children: ReactNode): ReactNode {
  const value: CapabilitiesContextValue = {
    status: "ready",
    features,
    permissions: [],
    isSuperAdmin: false,
    has: (req: CapabilityRequirement) =>
      req.feature === undefined || features.includes(req.feature),
    reload: () => Promise.resolve(),
  };
  return <CapabilitiesContext value={value}>{children}</CapabilitiesContext>;
}

function renderPage(features = ["notifications"]) {
  return render(
    <I18nProvider>
      <ToastProvider>{caps(features, <NotificationsPage />)}</ToastProvider>
    </I18nProvider>,
  );
}

describe("NotificationsPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the fallback when the notifications feature is off", () => {
    renderPage([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads and renders every preference row", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [
          { type: "order.status_changed", inAppEnabled: true, webPushEnabled: true },
          { type: "payment.collected", inAppEnabled: false, webPushEnabled: true },
        ],
      }),
    );
    renderPage();
    expect(await screen.findByText("حالة الطلب")).toBeInTheDocument();
    expect(screen.getByText("تحصيل الدفع")).toBeInTheDocument();
  });

  it("shows an error state when the load fails", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: { code: "INTERNAL", statusCode: 500 } }));
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("toggles a preference and saves it", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [{ type: "order.status_changed", inAppEnabled: true, webPushEnabled: true }],
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("حالة الطلب");

    const webPushCheckbox = screen.getByRole("checkbox", { name: "إشعارات الدفع" });
    await user.click(webPushCheckbox);
    expect(webPushCheckbox).not.toBeChecked();

    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [{ type: "order.status_changed", inAppEnabled: true, webPushEnabled: false }],
      }),
    );
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          (c[0] as string).endsWith("/notifications/preferences") &&
          (c[1] as RequestInit | undefined)?.method === "PUT",
      );
      expect(call).toBeDefined();
    });
    expect(await screen.findByText("تم حفظ التفضيلات.")).toBeInTheDocument();
  });

  it("shows a failure message when saving fails", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [{ type: "order.status_changed", inAppEnabled: true, webPushEnabled: true }],
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("حالة الطلب");

    fetchMock.mockResolvedValueOnce(json(500, { error: { code: "INTERNAL", statusCode: 500 } }));
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("تعذّر حفظ التفضيلات. حاول مرة أخرى.")).toBeInTheDocument();
  });
});
