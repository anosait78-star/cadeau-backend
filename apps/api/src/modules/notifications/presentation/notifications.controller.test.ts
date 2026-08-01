import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { NotificationsService } from "../application/notifications.service";
import { NotificationsController } from "./notifications.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

const NOTIFICATION = "33333333-3333-3333-3333-333333333333";

function notification() {
  return {
    id: NOTIFICATION,
    type: "order.status_changed" as const,
    title: "t",
    body: "b",
    payload: null,
    readAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

interface Harness {
  controller: NotificationsController;
  service: { [K in keyof NotificationsService]: ReturnType<typeof vi.fn> };
}

function makeHarness(): Harness {
  const service = {
    list: vi.fn().mockResolvedValue({
      data: [notification()],
      page: { limit: 25, nextCursor: null, hasMore: false },
    }),
    markRead: vi.fn().mockResolvedValue({ updated: 1 }),
    getPreferences: vi
      .fn()
      .mockResolvedValue([
        { type: "order.status_changed", inAppEnabled: true, webPushEnabled: true },
      ]),
    updatePreferences: vi
      .fn()
      .mockResolvedValue([
        { type: "order.status_changed", inAppEnabled: false, webPushEnabled: true },
      ]),
    registerSubscription: vi.fn().mockResolvedValue({
      id: "sub1",
      endpoint: "https://push.example/ep",
      userAgent: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    removeSubscription: vi.fn().mockResolvedValue(undefined),
  } as unknown as Harness["service"];
  const controller = new NotificationsController(service as unknown as NotificationsService);
  return { controller, service };
}

describe("NotificationsController", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("list returns the mapped keyset page", async () => {
    const result = await h.controller.list(principal, {});
    expect(h.service.list).toHaveBeenCalledWith(principal, {});
    expect(result.data[0]?.id).toBe(NOTIFICATION);
    expect(result.page.hasMore).toBe(false);
  });

  it("markRead delegates and maps the result", async () => {
    const result = await h.controller.markRead(principal, { ids: [NOTIFICATION] });
    expect(h.service.markRead).toHaveBeenCalledWith(principal, [NOTIFICATION]);
    expect(result.updated).toBe(1);
  });

  it("getPreferences returns the mapped list", async () => {
    const result = await h.controller.getPreferences(principal);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.type).toBe("order.status_changed");
  });

  it("updatePreferences delegates the requested updates", async () => {
    const result = await h.controller.updatePreferences(principal, {
      preferences: [{ type: "order.status_changed", inAppEnabled: false, webPushEnabled: true }],
    });
    expect(h.service.updatePreferences).toHaveBeenCalledWith(principal, [
      { type: "order.status_changed", inAppEnabled: false, webPushEnabled: true },
    ]);
    expect(result.data[0]?.inAppEnabled).toBe(false);
  });

  it("registerSubscription maps the W3C keys shape into the service input", async () => {
    const result = await h.controller.registerSubscription(principal, {
      endpoint: "https://push.example/ep",
      keys: { p256dh: "p", auth: "a" },
      userAgent: "test-agent",
    });
    expect(h.service.registerSubscription).toHaveBeenCalledWith(principal, {
      endpoint: "https://push.example/ep",
      p256dh: "p",
      auth: "a",
      userAgent: "test-agent",
    });
    expect(result.id).toBe("sub1");
  });

  it("registerSubscription omits userAgent when absent", async () => {
    await h.controller.registerSubscription(principal, {
      endpoint: "https://push.example/ep",
      keys: { p256dh: "p", auth: "a" },
    });
    const call = h.service.registerSubscription.mock.calls[0]?.[1] as Record<string, unknown>;
    expect("userAgent" in call).toBe(false);
  });

  it("removeSubscription delegates to the service", async () => {
    await h.controller.removeSubscription(principal, "sub1");
    expect(h.service.removeSubscription).toHaveBeenCalledWith(principal, "sub1");
  });
});
