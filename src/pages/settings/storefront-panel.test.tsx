import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { ToastProvider } from "@/components/toast/toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { StorefrontPanel } from "./storefront-panel";

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPanel(
  features: string[] = ["storefront_integration"],
  permissions: string[] = ["integrations.manage"],
) {
  const value: CapabilitiesContextValue = {
    status: "ready",
    features,
    permissions,
    isSuperAdmin: false,
    has: (req: CapabilityRequirement) =>
      (req.feature === undefined || value.features.includes(req.feature)) &&
      (req.permission === undefined || value.permissions.includes(req.permission)),
    reload: () => Promise.resolve(),
  };
  return render(
    <I18nProvider>
      <ToastProvider>
        <CapabilitiesContext value={value}>
          <StorefrontPanel />
        </CapabilitiesContext>
      </ToastProvider>
    </I18nProvider>,
  );
}

const CONNECTION = {
  id: "conn-1",
  label: "متجري الرئيسي",
  platform: "generic",
  apiKeyPrefix: "sfk_a1b2",
  defaultWarehouseId: null,
  status: "active",
  lastEventAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("StorefrontPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubBasics(connections: unknown[] = []) {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/integrations/storefront/connections") && !url.includes("events")) {
        return Promise.resolve(
          json(200, { data: connections, page: { limit: 25, nextCursor: null, hasMore: false } }),
        );
      }
      if (url.includes("/warehouses")) {
        return Promise.resolve(
          json(200, { data: [], page: { limit: 25, nextCursor: null, hasMore: false } }),
        );
      }
      return Promise.resolve(json(200, { data: [] }));
    });
  }

  it("renders the forbidden fallback without the feature", async () => {
    renderPanel([], []);
    expect(
      await screen.findByText("ليس لديك صلاحية الوصول إلى تكامل المتجر الإلكتروني."),
    ).toBeInTheDocument();
  });

  it("lists connections with masked key and status", async () => {
    stubBasics([CONNECTION]);
    renderPanel();

    expect(await screen.findByText("متجري الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("sfk_a1b2••••")).toBeInTheDocument();
    expect(screen.getByText("نشط")).toBeInTheDocument();
  });

  it("shows the empty state with no connections", async () => {
    stubBasics([]);
    renderPanel();
    expect(await screen.findByText("لا توجد اتصالات متجر إلكتروني حتى الآن.")).toBeInTheDocument();
  });

  it("creates a connection and reveals the plaintext key once", async () => {
    stubBasics([]);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("لا توجد اتصالات متجر إلكتروني حتى الآن.");

    await user.click(screen.getByRole("button", { name: "اتصال جديد" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("الاسم"), "متجر تجريبي");

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        json(201, {
          ...CONNECTION,
          id: "conn-2",
          label: "متجر تجريبي",
          apiKey: "sfk_plaintext_secret_value",
        }),
      ),
    );
    await user.click(within(dialog).getByRole("button", { name: "اتصال جديد" }));

    expect(await screen.findByText("sfk_plaintext_secret_value")).toBeInTheDocument();
    // Close button stays disabled until the copy is acknowledged.
    const closeButton = screen.getByRole("button", { name: "إغلاق" });
    expect(closeButton).toBeDisabled();

    await user.click(screen.getByLabelText("لقد نسخت هذا المفتاح"));
    expect(closeButton).toBeEnabled();
    await user.click(closeButton);

    await waitFor(() =>
      expect(screen.queryByText("sfk_plaintext_secret_value")).not.toBeInTheDocument(),
    );
  });

  it("shows the webhook secret field only after selecting the WooCommerce platform", async () => {
    stubBasics([]);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("لا توجد اتصالات متجر إلكتروني حتى الآن.");

    await user.click(screen.getByRole("button", { name: "اتصال جديد" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByLabelText("سر Webhook")).not.toBeInTheDocument();

    const platformCombobox = within(dialog).getByLabelText("المنصّة");
    await user.click(platformCombobox);
    await user.click(await screen.findByText("WooCommerce"));

    expect(await within(dialog).findByLabelText("سر Webhook")).toBeInTheDocument();
  });

  it("revokes a connection after confirmation", async () => {
    stubBasics([CONNECTION]);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("متجري الرئيسي");

    const row = screen.getByText("متجري الرئيسي").closest("li");
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole("button", { name: "إلغاء" }));

    await screen.findByText("إلغاء هذا الاتصال؟");
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(json(200, { ...CONNECTION, status: "revoked" })),
    );
    await user.click(screen.getByRole("button", { name: "نعم، إلغاء الاتصال" }));

    await waitFor(() => expect(screen.getByText("ملغى")).toBeInTheDocument());
  });

  it("opens the events panel and reprocesses a failed event", async () => {
    stubBasics([CONNECTION]);
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("متجري الرئيسي");

    fetchMock.mockImplementationOnce((input: RequestInfo | URL) => {
      expect(String(input)).toContain("/integrations/storefront/connections/conn-1/events");
      return Promise.resolve(
        json(200, {
          data: [
            {
              id: "evt-1",
              eventType: "order",
              externalId: "store-order-1",
              status: "failed",
              error: "unknown sku",
              internalEntityId: null,
              attemptCount: 1,
              receivedAt: "2026-08-01T00:00:00.000Z",
              processedAt: null,
            },
          ],
          page: { limit: 25, nextCursor: null, hasMore: false },
        }),
      );
    });
    await user.click(screen.getByRole("button", { name: "عرض الأحداث" }));

    expect(await screen.findByText("store-order-1")).toBeInTheDocument();
    expect(screen.getByText("unknown sku")).toBeInTheDocument();

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(json(200, { entityId: "order-1", status: "created" })),
    );
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        json(200, { data: [], page: { limit: 25, nextCursor: null, hasMore: false } }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "إعادة المعالجة" }));

    expect(await screen.findByText("تمت إعادة معالجة الحدث.")).toBeInTheDocument();
  });

  it("lists, adds, and removes vendor -> warehouse mappings from the connection's detail panel", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/vendor-warehouses")) {
        // Handled per-call below via mockImplementationOnce; this default
        // only covers the final reload after the delete.
        return Promise.resolve(
          json(200, { data: [], page: { limit: 25, nextCursor: null, hasMore: false } }),
        );
      }
      if (url.includes("/integrations/storefront/connections") && !url.includes("events")) {
        return Promise.resolve(
          json(200, { data: [CONNECTION], page: { limit: 25, nextCursor: null, hasMore: false } }),
        );
      }
      if (url.includes("/warehouses")) {
        return Promise.resolve(
          json(200, {
            data: [{ id: "wh-1", name: "Main" }],
            page: { limit: 25, nextCursor: null, hasMore: false },
          }),
        );
      }
      return Promise.resolve(json(200, { data: [] }));
    });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText("متجري الرئيسي");

    // Opening the panel defaults to the Events tab; the vendor-warehouses tab
    // mounts (and fetches) only once selected.
    await user.click(screen.getByRole("button", { name: "عرض الأحداث" }));

    fetchMock.mockImplementationOnce((input: RequestInfo | URL) => {
      expect(String(input)).toContain(
        "/integrations/storefront/connections/conn-1/vendor-warehouses",
      );
      return Promise.resolve(
        json(200, {
          data: [
            {
              id: "map-1",
              connectionId: "conn-1",
              externalVendorId: "1527",
              warehouseId: "wh-1",
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
          page: { limit: 25, nextCursor: null, hasMore: false },
        }),
      );
    });
    await user.click(screen.getByRole("tab", { name: "مستودعات التجار" }));

    expect(await screen.findByText("1527")).toBeInTheDocument();

    // Add a new mapping.
    await user.type(screen.getByLabelText("معرّف التاجر"), "1223");
    await user.click(screen.getByLabelText("المستودع"));
    await user.click(await screen.findByRole("option", { name: "Main" }));
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        json(201, {
          id: "map-2",
          connectionId: "conn-1",
          externalVendorId: "1223",
          warehouseId: "wh-2",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        }),
      ),
    );
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        json(200, {
          data: [
            {
              id: "map-1",
              connectionId: "conn-1",
              externalVendorId: "1527",
              warehouseId: "wh-1",
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
            {
              id: "map-2",
              connectionId: "conn-1",
              externalVendorId: "1223",
              warehouseId: "wh-2",
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
          page: { limit: 25, nextCursor: null, hasMore: false },
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "إضافة ربط" }));
    expect(await screen.findByText("1223")).toBeInTheDocument();

    // Remove the first mapping, with confirmation.
    const row = screen.getByText("1527").closest("li");
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole("button", { name: "إزالة" }));
    await screen.findByText("إزالة ربط هذا التاجر؟");
    fetchMock.mockImplementationOnce(() => Promise.resolve(json(204, null)));
    await user.click(screen.getByRole("button", { name: "نعم، إزالة الربط" }));

    expect(await screen.findByText("تمت إزالة الربط.")).toBeInTheDocument();
  });
});
