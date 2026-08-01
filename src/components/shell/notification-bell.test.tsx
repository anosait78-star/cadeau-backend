import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/i18n-provider";
import { NotificationBell } from "./notification-bell";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notification(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    type: "order.status_changed",
    title: `Order ${id} moved`,
    body: "processing → shipped",
    payload: {},
    readAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function renderBell(): void {
  render(
    <MemoryRouter>
      <I18nProvider>
        <NotificationBell />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("NotificationBell", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the unread indicator when there is at least one unread notification", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [notification("n1")],
        page: { limit: 1, nextCursor: null, hasMore: false },
      }),
    );
    renderBell();
    await waitFor(() => {
      const url = fetchMock.mock.calls[0]?.[0] as string;
      expect(url).toContain("read=false");
    });
    expect(document.querySelector(".bg-destructive")).not.toBeNull();
  });

  it("does not show the unread indicator when nothing is unread", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { data: [], page: { limit: 1, nextCursor: null, hasMore: false } }),
    );
    renderBell();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".bg-destructive")).toBeNull();
  });

  it("loads and shows the recent notifications when opened", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { data: [], page: { limit: 1, nextCursor: null, hasMore: false } }),
    );
    const user = userEvent.setup();
    renderBell();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [notification("n1")],
        page: { limit: 10, nextCursor: null, hasMore: false },
      }),
    );
    await user.click(screen.getByRole("button", { name: "الإشعارات" }));
    expect(await screen.findByText("Order n1 moved")).toBeInTheDocument();
  });

  it("shows an empty state when there are no recent notifications", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { data: [], page: { limit: 1, nextCursor: null, hasMore: false } }),
    );
    const user = userEvent.setup();
    renderBell();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockResolvedValueOnce(
      json(200, { data: [], page: { limit: 10, nextCursor: null, hasMore: false } }),
    );
    await user.click(screen.getByRole("button", { name: "الإشعارات" }));
    expect(await screen.findByText("لا توجد إشعارات بعد")).toBeInTheDocument();
  });

  it("marks a notification read on click", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { data: [], page: { limit: 1, nextCursor: null, hasMore: false } }),
    );
    const user = userEvent.setup();
    renderBell();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [notification("n1")],
        page: { limit: 10, nextCursor: null, hasMore: false },
      }),
    );
    await user.click(screen.getByRole("button", { name: "الإشعارات" }));
    const row = await screen.findByText("Order n1 moved");

    fetchMock.mockResolvedValueOnce(json(200, { updated: 1 }));
    fetchMock.mockResolvedValueOnce(
      json(200, { data: [], page: { limit: 1, nextCursor: null, hasMore: false } }),
    );
    await user.click(row);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        (c[0] as string).endsWith("/notifications/read"),
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({ ids: ["n1"] });
    });
  });

  it("marks every currently-loaded unread notification read on 'mark all read'", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [notification("n1")],
        page: { limit: 1, nextCursor: null, hasMore: false },
      }),
    );
    const user = userEvent.setup();
    renderBell();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(
      json(200, {
        data: [notification("n1"), notification("n2")],
        page: { limit: 10, nextCursor: null, hasMore: false },
      }),
    );
    await user.click(screen.getByRole("button", { name: "الإشعارات" }));
    await screen.findByText("Order n1 moved");

    fetchMock.mockResolvedValueOnce(json(200, { updated: 2 }));
    fetchMock.mockResolvedValueOnce(
      json(200, { data: [], page: { limit: 1, nextCursor: null, hasMore: false } }),
    );
    await user.click(screen.getByText("تعليم الكل كمقروء"));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        (c[0] as string).endsWith("/notifications/read"),
      );
      const init = call?.[1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({ ids: ["n1", "n2"] });
    });
  });
});
