import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOrderDetailSections, useOrderDetailData } from "./orders-detail-sections";
import type { OrderDetail } from "@/features/orders/orders-api";
import type { TranslationKey } from "@/i18n/dictionaries";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ORDER_DETAIL: OrderDetail = {
  id: "o1",
  orderNumber: 1042,
  customerId: "c1",
  customerName: "Sara",
  assigneeId: null,
  status: "new",
  followUpState: "none",
  labelId: null,
  reasonId: null,
  governorateId: null,
  warehouseId: null,
  itemCount: 1,
  subtotal: 15000,
  shippingFee: 0,
  discount: 0,
  total: 15000,
  collectedAmount: 0,
  paymentStatus: "unpaid",
  statusChangedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  notes: "Handle with care",
  items: [
    {
      id: "i1",
      variantId: "v1",
      nameSnapshot: "T — L",
      quantity: 1,
      price: 15000,
      costSnapshot: 8000,
    },
  ],
};

const CUSTOMER_DETAIL = {
  id: "c1",
  name: "Sara",
  phone: "+201001234567",
  email: null,
  notes: null,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ordersCount: 1,
  totalSpent: 15000,
  lastOrderAt: null,
  addresses: [],
};

const t = (key: TranslationKey): string => key;

describe("useOrderDetailData", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.match(/\/orders\/o1\/activity/))
        return Promise.resolve(json(200, { data: [], page: {} }));
      if (url.match(/\/orders\/o1\/vendor-groups/))
        return Promise.resolve(json(200, { data: [], aggregateStatus: null }));
      if (url.match(/\/orders\/o1$/)) return Promise.resolve(json(200, ORDER_DETAIL));
      return Promise.resolve(json(404, {}));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fetches detail + activity + vendor groups in parallel when given an orderId", async () => {
    const { result } = renderHook(() => useOrderDetailData("o1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    expect(result.current.detail?.orderNumber).toBe(1042);
    expect(result.current.vendorGroups).toEqual([]);
    expect(result.current.vendorAggregateStatus).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it("surfaces the aggregate vendor status alongside the groups (Phase 8)", async () => {
    fetchMock.mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.match(/\/orders\/o1\/activity/))
        return Promise.resolve(json(200, { data: [], page: {} }));
      if (url.match(/\/orders\/o1\/vendor-groups/))
        return Promise.resolve(json(200, { data: [], aggregateStatus: "processing" }));
      if (url.match(/\/orders\/o1$/)) return Promise.resolve(json(200, ORDER_DETAIL));
      return Promise.resolve(json(404, {}));
    });
    const { result } = renderHook(() => useOrderDetailData("o1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    expect(result.current.vendorAggregateStatus).toBe("processing");
  });

  it("does not fail the whole panel when the vendor-groups fetch errors", async () => {
    fetchMock.mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.match(/\/orders\/o1\/activity/))
        return Promise.resolve(json(200, { data: [], page: {} }));
      if (url.match(/\/orders\/o1\/vendor-groups/)) return Promise.resolve(json(500, {}));
      if (url.match(/\/orders\/o1$/)) return Promise.resolve(json(200, ORDER_DETAIL));
      return Promise.resolve(json(404, {}));
    });
    const { result } = renderHook(() => useOrderDetailData("o1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    expect(result.current.vendorGroups).toEqual([]);
    expect(result.current.error).toBe(false);
  });

  it("does nothing when orderId is null", () => {
    const { result } = renderHook(() => useOrderDetailData(null));
    expect(result.current.detail).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildOrderDetailSections", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.match(/\/customers\/c1$/)) return Promise.resolve(json(200, CUSTOMER_DETAIL));
      return Promise.resolve(json(404, {}));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("builds all 8 sections, with the customer folded into the summary", () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      vendorGroups: [],
      t,
      locale: "en",
      companyId: "co1",
      onNotify: () => {},
      onPatch: () => {},
    });
    expect(sections.map((s) => s.key)).toEqual([
      "summary",
      "items",
      "assignee",
      "shipping",
      "review",
      "payments",
      "activities",
      "notes",
    ]);
  });

  it("notes section shows the order's notes", () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      vendorGroups: [],
      t,
      locale: "en",
      companyId: "co1",
      onNotify: () => {},
      onPatch: () => {},
    });
    const notes = sections.find((s) => s.key === "notes");
    render(<div>{notes?.content}</div>);
    expect(screen.getByText("Handle with care")).toBeInTheDocument();
  });

  it("summary lazily reveals the real phone once fetched, with both contact actions", async () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      vendorGroups: [],
      t,
      locale: "en",
      companyId: "co1",
      onNotify: () => {},
      onPatch: () => {},
    });
    const summary = sections.find((s) => s.key === "summary");
    render(<div>{summary?.content}</div>);
    expect(screen.getByText("orders.detail.loadingPhone")).toBeInTheDocument();
    expect(await screen.findByText("+201001234567")).toBeInTheDocument();
    // The call/WhatsApp targets are the ones the customer tab used to render.
    expect(screen.getByText("orders.detail.call").closest("a")).toHaveAttribute(
      "href",
      "tel:+201001234567",
    );
    expect(screen.getByText("orders.detail.whatsapp").closest("a")).toHaveAttribute(
      "href",
      "https://wa.me/201001234567",
    );
  });

  it("summary shows the real product image when the order is vendor-routed", async () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      vendorGroups: [
        {
          id: "g1",
          orderId: "o1",
          orderNumber: 1042,
          warehouseId: "w1",
          warehouseName: "Store A",
          warehouseCode: null,
          vendorMemberId: null,
          vendorName: null,
          status: "new",
          updatedAt: "2026-01-01T00:00:00.000Z",
          items: [
            {
              id: "gi1",
              variantId: "v1",
              nameSnapshot: "T — L",
              quantity: 1,
              price: 15000,
              imageUrl: "https://cdn.example.test/v1.jpg",
            },
          ],
        },
      ],
      t,
      locale: "en",
      companyId: "co1",
      onNotify: () => {},
      onPatch: () => {},
    });
    const summary = sections.find((s) => s.key === "summary");
    const { container } = render(<div>{summary?.content}</div>);
    await waitFor(() =>
      expect(container.querySelector('img[src="https://cdn.example.test/v1.jpg"]')).not.toBeNull(),
    );
  });

  it("omits the vendor tracking tab for a non-multi-vendor order (backward compatible)", () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      vendorGroups: [],
      t,
      locale: "en",
      companyId: "co1",
      onNotify: () => {},
      onPatch: () => {},
    });
    expect(sections.some((s) => s.key === "vendorTracking")).toBe(false);
  });

  it("shows the vendor tracking tab, reflecting each vendor's real status, when groups exist", () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      vendorGroups: [
        {
          id: "g1",
          orderId: "o1",
          orderNumber: 1042,
          warehouseId: "w1",
          warehouseName: "Store A",
          warehouseCode: null,
          vendorMemberId: "m1",
          vendorName: "Vendor A",
          status: "delivered",
          updatedAt: "2026-01-02T00:00:00.000Z",
          items: [
            {
              id: "i1",
              variantId: "v1",
              nameSnapshot: "T — L",
              quantity: 1,
              price: 15000,
              imageUrl: null,
            },
          ],
        },
        {
          id: "g2",
          orderId: "o1",
          orderNumber: 1042,
          warehouseId: "w2",
          warehouseName: "Store B",
          warehouseCode: null,
          vendorMemberId: null,
          vendorName: null,
          status: "new",
          updatedAt: "2026-01-01T00:00:00.000Z",
          items: [],
        },
      ],
      vendorAggregateStatus: "new", // the slowest group (Store B) is the bottleneck
      t,
      locale: "en",
      companyId: "co1",
      onNotify: () => {},
      onPatch: () => {},
    });
    const tracking = sections.find((s) => s.key === "vendorTracking");
    expect(tracking).toBeDefined();
    render(<div>{tracking?.content}</div>);
    expect(screen.getByText("orders.detail.vendorTracking.overallStatus")).toBeInTheDocument();
    expect(screen.getByText("Store A")).toBeInTheDocument();
    expect(screen.getByText("Vendor A")).toBeInTheDocument();
    expect(screen.getByText("Store B")).toBeInTheDocument();
    expect(screen.getByText("orders.detail.vendorTracking.noVendor")).toBeInTheDocument();
    // The overall badge reflects the bottleneck ("new", Store B), independent
    // of each vendor's own current-status badge.
    expect(screen.getByTestId("vendor-overall-status")).toHaveTextContent(
      "vendor.group.status.new",
    );
    expect(screen.getByTestId("vendor-group-status-g1")).toHaveTextContent(
      "vendor.group.status.delivered",
    );
    expect(screen.getByTestId("vendor-group-status-g2")).toHaveTextContent(
      "vendor.group.status.new",
    );
  });

  it("omits the overall-status summary when there is no aggregate (defensive)", () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      vendorGroups: [
        {
          id: "g1",
          orderId: "o1",
          orderNumber: 1042,
          warehouseId: "w1",
          warehouseName: "Store A",
          warehouseCode: null,
          vendorMemberId: null,
          vendorName: null,
          status: "new",
          updatedAt: "2026-01-01T00:00:00.000Z",
          items: [],
        },
      ],
      vendorAggregateStatus: null,
      t,
      locale: "en",
      companyId: "co1",
      onNotify: () => {},
      onPatch: () => {},
    });
    const tracking = sections.find((s) => s.key === "vendorTracking");
    render(<div>{tracking?.content}</div>);
    expect(
      screen.queryByText("orders.detail.vendorTracking.overallStatus"),
    ).not.toBeInTheDocument();
  });
});
