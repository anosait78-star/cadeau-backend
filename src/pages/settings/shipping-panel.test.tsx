import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { I18nProvider } from "@/i18n/i18n-provider";
import { ShippingPanel } from "./shipping-panel";

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPanel() {
  const value: CapabilitiesContextValue = {
    status: "ready",
    features: ["master-data"],
    permissions: ["master-data.manage"],
    isSuperAdmin: false,
    has: (req: CapabilityRequirement) =>
      (req.feature === undefined || value.features.includes(req.feature)) &&
      (req.permission === undefined || value.permissions.includes(req.permission)),
    reload: () => Promise.resolve(),
  };
  return render(
    <I18nProvider>
      <CapabilitiesContext value={value}>
        <ShippingPanel />
      </CapabilitiesContext>
    </I18nProvider>,
  );
}

describe("ShippingPanel carriers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubList(carriers: unknown[]) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/shipping/carriers") && !url.includes("connect")) {
        return Promise.resolve(json(200, { data: carriers }));
      }
      return Promise.resolve(json(200, { data: [] }));
    });
  }

  it("shows manual as always connected and bosta as not connected", async () => {
    stubList([
      { key: "manual", connected: true, pickupLocationWarning: false, connectedAt: null },
      { key: "bosta", connected: false, pickupLocationWarning: false, connectedAt: null },
    ]);
    renderPanel();

    await screen.findByText("manual");
    expect(screen.getByText("bosta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ربط" })).toBeInTheDocument();
  });

  it("connects bosta with an API key and shows the connected state", async () => {
    stubList([
      { key: "manual", connected: true, pickupLocationWarning: false, connectedAt: null },
      { key: "bosta", connected: false, pickupLocationWarning: false, connectedAt: null },
    ]);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("bosta");

    await user.click(screen.getByRole("button", { name: "ربط" }));
    await user.type(screen.getByLabelText("مفتاح API"), "real-key");

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        json(200, {
          key: "bosta",
          connected: true,
          pickupLocationWarning: true,
          connectedAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "ربط" }));

    expect(
      await screen.findByText("متصل، لكن لا يوجد موقع استلام مُعدّ في حساب بوسطة بعد."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "فصل" })).toBeInTheDocument();
  });

  it("shows an error when the key is rejected", async () => {
    stubList([
      { key: "manual", connected: true, pickupLocationWarning: false, connectedAt: null },
      { key: "bosta", connected: false, pickupLocationWarning: false, connectedAt: null },
    ]);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("bosta");

    await user.click(screen.getByRole("button", { name: "ربط" }));
    await user.type(screen.getByLabelText("مفتاح API"), "bad-key");

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        json(422, { error: { code: "UNPROCESSABLE_ENTITY", statusCode: 422, message: "nope" } }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "ربط" }));

    expect(
      await screen.findByText("تم رفض مفتاح API هذا. تحقق منه وحاول مرة أخرى."),
    ).toBeInTheDocument();
  });

  it("disconnects a connected carrier", async () => {
    stubList([
      { key: "manual", connected: true, pickupLocationWarning: false, connectedAt: null },
      {
        key: "bosta",
        connected: true,
        pickupLocationWarning: false,
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("bosta");

    fetchMock.mockImplementationOnce(() => Promise.resolve(json(204, null)));
    await user.click(screen.getByRole("button", { name: "فصل" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/shipping/carriers/bosta/connect"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(await screen.findByText("غير متصل")).toBeInTheDocument();
  });
});
