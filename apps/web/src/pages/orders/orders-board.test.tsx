import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilitiesContext,
  type CapabilitiesContextValue,
  type CapabilityRequirement,
} from "@/features/access/capabilities-context";
import { ToastProvider } from "@/components/toast/toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { OrdersPage } from "./orders-page";

/**
 * The board's drag path, which `orders-page.test.tsx` cannot reach: jsdom
 * implements no drag-and-drop at all, so every event here is dispatched by
 * hand.
 *
 * What matters on this board and not on the vendor one is that a drop is
 * checked against the *full* transition graph rather than a simple "forward",
 * and that `cancelled` is diverted into the reason modal instead of being
 * sent — the server rejects a cancel that carries no reason, which is how
 * cancellation silently did nothing for months.
 */

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

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const ORDER_ROW = {
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
  itemCount: 2,
  subtotal: 30000,
  shippingFee: 5000,
  isGiftWrap: false,
  giftWrapFeeMinor: 0,
  discount: 0,
  total: 35000,
  collectedAmount: 0,
  paymentStatus: "unpaid",
  statusChangedAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const COUNTS = { counts: { new: 1 } };

let fetchMock: ReturnType<typeof vi.fn>;
/** Set per test to make the transition endpoint fail. */
let transitionStatus = 200;
/** Set per test to move the fixture order into another status. */
let orderStatus = "new";

beforeEach(() => {
  transitionStatus = 200;
  orderStatus = "new";
  localStorage.clear();
  localStorage.setItem("cadeau.locale", "en");
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  // The board is desktop-only and jsdom has no real viewport, so force the
  // >=1024px query to match. Assigned on `window` (not `stubGlobal`) because
  // that is what `useMediaQuery` reads.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/master-data/order-reasons")) {
      return Promise.resolve(json(200, { data: [{ id: "r1", name: "Changed mind" }], page: {} }));
    }
    if (url.includes("/master-data/")) return Promise.resolve(json(200, { data: [], page: {} }));
    if (url.includes("/orders/status-counts")) return Promise.resolve(json(200, COUNTS));
    if (url.match(/\/orders\/o1\/status$/) && method === "POST") {
      return transitionStatus === 200
        ? Promise.resolve(json(200, { ...ORDER_ROW, status: "processing", notes: null, items: [] }))
        : Promise.resolve(
            json(422, {
              error: {
                code: "UNPROCESSABLE_ENTITY",
                statusCode: 422,
                message: "Not enough stock.",
              },
            }),
          );
    }
    if (url.match(/\/orders\?/) !== null || url.match(/\/orders$/) !== null) {
      // Only the `new` column has anything in it; every other column asks for
      // its own status and gets nothing.
      const mine = url.includes(`status=${orderStatus}`);
      return Promise.resolve(
        json(200, {
          data: mine ? [{ ...ORDER_ROW, status: orderStatus }] : [],
          page: { limit: 20, nextCursor: null, hasMore: false },
        }),
      );
    }
    return Promise.resolve(json(200, { data: [], page: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage(permissions = ["orders.read", "orders.manage"]) {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>{caps(["orders"], permissions, <OrdersPage />)}</ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

/** A minimal `dataTransfer` — the handlers only set/read a payload and flags. */
function dataTransfer(): DataTransfer {
  return {
    setData: () => {},
    getData: () => "",
    effectAllowed: "",
    dropEffect: "",
  } as unknown as DataTransfer;
}

/**
 * Every event fires in the same tick on purpose: a drop must not depend on
 * React having committed the `dragstart` state update first (a ref carries the
 * dragged order), and this is the only way to assert that.
 */
function dragOnto(card: HTMLElement, target: HTMLElement): void {
  const dt = dataTransfer();
  fireEvent.dragStart(card, { dataTransfer: dt });
  fireEvent.dragEnter(target, { dataTransfer: dt });
  fireEvent.dragOver(target, { dataTransfer: dt });
  fireEvent.drop(target, { dataTransfer: dt });
}

const card = (): HTMLElement => screen.getByText("#1042").closest('[role="button"]') as HTMLElement;

const column = (name: string): HTMLElement => screen.getByRole("listitem", { name });

const transitionCalls = (): unknown[] =>
  fetchMock.mock.calls.filter(([u]) => String(u).match(/\/orders\/o1\/status$/) !== null);

describe("OrdersPage — desktop board", () => {
  it("renders a column per status and puts the order in its own", async () => {
    renderPage();
    await screen.findByText("#1042");
    expect(within(column("New")).getByText("#1042")).toBeInTheDocument();
    expect(within(column("Processing")).getByText("No orders")).toBeInTheDocument();
  });

  it("parks Incomplete last instead of fourth, without disturbing lifecycle order", async () => {
    renderPage();
    await screen.findByText("#1042");
    const labels = screen.getAllByRole("listitem").map((el) => el.getAttribute("aria-label"));
    expect(labels.at(-1)).toBe("Incomplete");
    // The rest still run in lifecycle order — only `incomplete` was lifted out.
    expect(labels.slice(0, 4)).toEqual(["New", "Confirming", "Processing", "Ready"]);
  });

  /**
   * Lost when the board replaced the data grid — the button had lived in the
   * grid's row actions — and only noticed because someone went looking for
   * it. Nothing on the desktop side had ever asserted it existed.
   */
  it("keeps the per-order WhatsApp button, on those statuses that get one", async () => {
    renderPage();
    await screen.findByText("#1042");
    // #1042 is `new`, which is not one of confirming/ready/shipped.
    expect(screen.queryByRole("button", { name: "Send WhatsApp message" })).not.toBeInTheDocument();

    cleanup();
    orderStatus = "shipped";
    renderPage();
    await screen.findByText("#1042");
    expect(screen.getByRole("button", { name: "Send WhatsApp message" })).toBeInTheDocument();
  });

  it("moves an order when dropped on a legal status", async () => {
    renderPage();
    await screen.findByText("#1042");
    dragOnto(card(), column("Processing"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/orders\/o1\/status$/),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("ignores a drop on a status the transition graph forbids", async () => {
    renderPage();
    await screen.findByText("#1042");
    // `new` may go to confirming/processing/cancelled/postponed — never
    // straight to delivered. Unlike the vendor board, "later" is not enough.
    dragOnto(card(), column("Delivered"));
    await Promise.resolve();
    expect(transitionCalls()).toHaveLength(0);
    expect(within(column("New")).getByText("#1042")).toBeInTheDocument();
  });

  it("diverts a drop on Cancelled into the reason modal instead of sending it", async () => {
    renderPage();
    await screen.findByText("#1042");
    dragOnto(card(), column("Cancelled"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(transitionCalls()).toHaveLength(0);
    // The card must not look cancelled while the modal is still open — the
    // user can still back out. Checked through the DOM rather than
    // `getByRole`: the open dialog `aria-hidden`s the rest of the page, so
    // the column is no longer in the accessibility tree.
    expect(screen.getByText("#1042").closest('[role="listitem"]')).toHaveAttribute(
      "aria-label",
      "New",
    );
  });

  it("rolls the card back to its old column when the server refuses the move", async () => {
    transitionStatus = 422;
    renderPage();
    await screen.findByText("#1042");
    dragOnto(card(), column("Processing"));
    await waitFor(() => expect(transitionCalls()).toHaveLength(1));
    // Optimistically moved, then put back exactly where it started.
    await waitFor(() => expect(within(column("New")).getByText("#1042")).toBeInTheDocument());
    expect(within(column("Processing")).getByText("No orders")).toBeInTheDocument();
  });

  it("is not draggable without orders.manage", async () => {
    renderPage(["orders.read"]);
    await screen.findByText("#1042");
    dragOnto(card(), column("Processing"));
    await Promise.resolve();
    expect(transitionCalls()).toHaveLength(0);
  });
});
