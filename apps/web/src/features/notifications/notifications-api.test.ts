import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNotificationPreferences,
  listNotifications,
  markNotificationsRead,
  updateNotificationPreferences,
} from "./notifications-api";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("notifications-api", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(json(200, {}));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listNotifications requests with no query string when no options are given", async () => {
    await listNotifications();
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url.endsWith("/notifications")).toBe(true);
  });

  it("listNotifications builds a query string from limit/cursor/type/read", async () => {
    await listNotifications({ limit: 5, cursor: "abc", type: "order.status_changed", read: false });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("limit=5");
    expect(url).toContain("cursor=abc");
    expect(url).toContain("type=order.status_changed");
    expect(url).toContain("read=false");
  });

  it("markNotificationsRead posts the ids", async () => {
    await markNotificationsRead(["n1", "n2"]);
    const call = fetchMock.mock.calls[0]!;
    expect((call[0] as string).endsWith("/notifications/read")).toBe(true);
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ ids: ["n1", "n2"] });
  });

  it("getNotificationPreferences calls the preferences endpoint", async () => {
    await getNotificationPreferences();
    expect((fetchMock.mock.calls[0]![0] as string).endsWith("/notifications/preferences")).toBe(
      true,
    );
  });

  it("updateNotificationPreferences PUTs the preference list", async () => {
    const preferences = [
      { type: "order.status_changed" as const, inAppEnabled: true, webPushEnabled: false },
    ];
    await updateNotificationPreferences(preferences);
    const call = fetchMock.mock.calls[0]!;
    expect((call[0] as string).endsWith("/notifications/preferences")).toBe(true);
    const init = call[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ preferences });
  });
});
