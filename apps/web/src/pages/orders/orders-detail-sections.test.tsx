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
      if (url.match(/\/orders\/o1$/)) return Promise.resolve(json(200, ORDER_DETAIL));
      return Promise.resolve(json(404, {}));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fetches detail + activity in parallel when given an orderId", async () => {
    const { result } = renderHook(() => useOrderDetailData("o1"));
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    expect(result.current.detail?.orderNumber).toBe(1042);
    expect(result.current.loading).toBe(false);
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

  it("builds all 8 sections", () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      t,
      locale: "en",
      onNotify: () => {},
      onPatch: () => {},
    });
    expect(sections.map((s) => s.key)).toEqual([
      "summary",
      "customer",
      "items",
      "shipping",
      "payments",
      "activities",
      "timeline",
      "notes",
    ]);
  });

  it("notes section shows the order's notes", () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      t,
      locale: "en",
      onNotify: () => {},
      onPatch: () => {},
    });
    const notes = sections.find((s) => s.key === "notes");
    render(<div>{notes?.content}</div>);
    expect(screen.getByText("Handle with care")).toBeInTheDocument();
  });

  it("customer section lazily reveals the real phone once fetched", async () => {
    const sections = buildOrderDetailSections({
      detail: ORDER_DETAIL,
      activity: [],
      t,
      locale: "en",
      onNotify: () => {},
      onPatch: () => {},
    });
    const customer = sections.find((s) => s.key === "customer");
    render(<div>{customer?.content}</div>);
    expect(screen.getByText("orders.detail.loadingPhone")).toBeInTheDocument();
    expect(await screen.findByText("+201001234567")).toBeInTheDocument();
  });
});
