import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeTokens } from "@/auth/auth-storage";
import { AppProviders } from "@/providers/app-providers";
import { setViewport } from "@/test/setup";
import { VendorOrdersPage } from "./vendor-orders-page";

/** jsdom implements no IntersectionObserver; the grid's infinite scroll needs one. */
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
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ME = {
  id: "u1",
  email: "vendor@test.dev",
  fullName: "Me",
  phone: null,
  twoFactorEnabled: false,
  activeCompanyId: "c1",
  companies: [{ id: "c1", name: "Acme", slug: "acme", role: "vendor", status: "active" }],
};
const CAPS = { features: [], permissions: [], isSuperAdmin: false };

function group(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "g1",
    orderId: "o1",
    orderNumber: 1042,
    warehouseId: "w1",
    warehouseName: "Main",
    warehouseCode: null,
    vendorMemberId: "m1",
    vendorName: "Me",
    status: "new",
    updatedAt: "2026-01-01T00:00:00.000Z",
    items: [
      {
        id: "i1",
        variantId: "v1",
        nameSnapshot: "T-Shirt — L",
        quantity: 2,
        price: 15000,
        imageUrl: null,
      },
    ],
    ...overrides,
  };
}

/** Records every `POST /vendor/order-groups/:id/status` the screen fires. */
interface Harness {
  readonly moves: { groupId: string; toStatus: string }[];
  readonly fetch: ReturnType<typeof vi.fn>;
}

function harness(groups: unknown[], statusResponse?: () => Response): Harness {
  const moves: { groupId: string; toStatus: string }[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(json(200, ME));
    if (url.endsWith("/access/capabilities")) return Promise.resolve(json(200, CAPS));
    if (/\/vendor\/order-groups\/[^/]+\/status$/.test(url)) {
      const groupId = url.split("/vendor/order-groups/")[1]?.split("/")[0] ?? "";
      const toStatus = (JSON.parse(String(init?.body ?? "{}")) as { toStatus: string }).toStatus;
      moves.push({ groupId, toStatus });
      if (statusResponse !== undefined) return Promise.resolve(statusResponse());
      return Promise.resolve(json(200, group({ id: groupId, status: toStatus })));
    }
    if (url.endsWith("/vendor/order-groups")) return Promise.resolve(json(200, { data: groups }));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  return { moves, fetch: fetchMock };
}

function renderBoard(h: Harness): void {
  localStorage.setItem("cadeau.locale", "en");
  writeTokens({ accessToken: "a", refreshToken: "r", expiresIn: 300 });
  vi.stubGlobal("fetch", h.fetch);
  render(
    <MemoryRouter initialEntries={["/vendor/orders"]}>
      <AppProviders>
        <Routes>
          <Route path="/vendor/orders" element={<VendorOrdersPage />} />
          <Route path="/vendor/orders/:groupId" element={<div>DETAIL PAGE</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

/** One status column — a labelled group of order cards, not a filter tab. */
const column = (name: RegExp): HTMLElement => screen.getByRole("group", { name });

/**
 * jsdom implements no drag-and-drop, so the events are dispatched by hand with
 * a minimal `dataTransfer` — enough for the handlers under test, which only
 * ever call `setData`/`preventDefault` and read the dragged group from state.
 */
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
 * React having committed the `dragstart` state update first (it is a ref that
 * carries the dragged group), and this is the only way to assert that.
 */
function dragOnto(card: HTMLElement, target: HTMLElement): void {
  const dt = dataTransfer();
  fireEvent.dragStart(card, { dataTransfer: dt });
  fireEvent.dragEnter(target, { dataTransfer: dt });
  fireEvent.dragOver(target, { dataTransfer: dt });
  fireEvent.drop(target, { dataTransfer: dt });
}

const orderCard = (): HTMLElement =>
  screen.getByText("#1042").closest('[role="button"]') as HTMLElement;

describe("VendorOrdersPage — desktop board (per-status cards + drag to move)", () => {
  beforeEach(() => {
    setViewport(true);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  });
  afterEach(() => {
    setViewport(false);
    vi.unstubAllGlobals();
  });

  it("renders one card per status, each holding its own orders", async () => {
    const h = harness([group()]);
    renderBoard(h);
    await screen.findByText("#1042");

    expect(within(column(/^New/)).getByText("#1042")).toBeInTheDocument();
    expect(within(column(/Processing/)).getByText("0")).toBeInTheDocument();
    expect(within(column(/Ready/)).getByText("0")).toBeInTheDocument();
    expect(within(column(/Delivered/)).getByText("0")).toBeInTheDocument();
  });

  it("opens the order in a side panel instead of navigating away", async () => {
    const user = userEvent.setup();
    const h = harness([group()]);
    renderBoard(h);

    await user.click(await screen.findByText("#1042"));

    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("T-Shirt — L")).toBeInTheDocument();
    // The board is still there behind the panel — that is the whole point.
    expect(screen.queryByText("DETAIL PAGE")).not.toBeInTheDocument();
  });

  it("advances the order from the panel's own button", async () => {
    const user = userEvent.setup();
    const h = harness([group()]);
    renderBoard(h);

    await user.click(await screen.findByText("#1042"));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Start processing" }));

    await waitFor(() => expect(h.moves).toEqual([{ groupId: "g1", toStatus: "processing" }]));
  });

  it("offers every later status from the panel, not just the next step", async () => {
    const user = userEvent.setup();
    const h = harness([group()]);
    renderBoard(h);

    await user.click(await screen.findByText("#1042"));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Move to a later status" }));

    await user.click(await screen.findByRole("menuitem", { name: "Mark delivered" }));
    await waitFor(() => expect(h.moves).toEqual([{ groupId: "g1", toStatus: "delivered" }]));
  });

  it("moves an order to any forward status it is dropped on, skipping states", async () => {
    const h = harness([group()]);
    renderBoard(h);
    await screen.findByText("#1042");

    dragOnto(orderCard(), column(/Delivered/));

    await waitFor(() => expect(h.moves).toEqual([{ groupId: "g1", toStatus: "delivered" }]));
  });

  it("ignores a drop on a backward status — only a manager may undo a vendor", async () => {
    const h = harness([group({ status: "ready" })]);
    renderBoard(h);
    await screen.findByText("#1042");

    dragOnto(orderCard(), column(/Processing/));

    await waitFor(() => expect(screen.getByText("#1042")).toBeInTheDocument());
    expect(h.moves).toEqual([]);
  });

  it("ignores a drop on the status the order already holds", async () => {
    const h = harness([group({ status: "processing" })]);
    renderBoard(h);
    await screen.findByText("#1042");

    dragOnto(orderCard(), column(/Processing/));

    await waitFor(() => expect(screen.getByText("#1042")).toBeInTheDocument());
    expect(h.moves).toEqual([]);
  });

  it("closes the panel when a drag starts, so the two never fight for the pointer", async () => {
    const user = userEvent.setup();
    const h = harness([group()]);
    renderBoard(h);

    await user.click(await screen.findByText("#1042"));
    await screen.findByRole("dialog");

    fireEvent.dragStart(orderCard(), { dataTransfer: dataTransfer() });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("rolls the order back to its old status when the move fails", async () => {
    const h = harness([group()], () => new Response(null, { status: 422 }));
    renderBoard(h);
    await screen.findByText("#1042");
    // "New" holds the only order to begin with.
    expect(within(column(/^New/)).getByText("#1042")).toBeInTheDocument();

    dragOnto(orderCard(), column(/Ready/));

    // The optimistic move is undone: the order returns to the New column.
    await waitFor(() => expect(within(column(/^New/)).getByText("#1042")).toBeInTheDocument());
    expect(within(column(/Ready/)).getByText("0")).toBeInTheDocument();
  });
});

describe("VendorOrdersPage — mobile keeps the full-page route", () => {
  beforeEach(() => {
    setViewport(false);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("navigates instead of opening a panel", async () => {
    const user = userEvent.setup();
    const h = harness([group()]);
    renderBoard(h);

    await user.click(await screen.findByText("#1042"));

    expect(await screen.findByText("DETAIL PAGE")).toBeInTheDocument();
  });
});
