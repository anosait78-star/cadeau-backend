import { InvalidCursorError, type PrismaClient } from "@cadeau/database";
import { describe, expect, it, vi } from "vitest";
import { NotificationsRepository } from "./notifications.repository";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const PROFILE = "22222222-2222-2222-2222-222222222222";

function row(extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: "n1",
    type: "order.status_changed",
    title: "Order status changed",
    body: "Order 1 moved from processing to shipped.",
    payload: { orderId: "o1" },
    readAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...extra,
  };
}

function makeRepo() {
  const notification = {
    findMany: vi.fn().mockResolvedValue([row()]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue(row()),
  };
  const notificationPreference = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
  };
  const pushSubscription = {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({
      id: "sub1",
      endpoint: "https://push.example/ep",
      userAgent: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const txHost = { $queryRaw: vi.fn(), notification, notificationPreference, pushSubscription };
  const prisma = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(txHost)) };
  const repo = new NotificationsRepository(prisma as unknown as PrismaClient);
  return { repo, notification, notificationPreference, pushSubscription };
}

describe("NotificationsRepository — list", () => {
  it("scopes by company and profile, applying type/read/date filters", async () => {
    const { repo, notification } = makeRepo();
    await repo.list(COMPANY, PROFILE, {
      type: "order.status_changed",
      read: false,
      createdAtFrom: "2026-01-01T00:00:00.000Z",
    });
    const call = notification.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where["companyId"]).toBe(COMPANY);
    expect(call.where["profileId"]).toBe(PROFILE);
    expect(call.where["type"]).toBe("order.status_changed");
    expect(call.where["readAt"]).toBeNull();
    expect(call.where["createdAt"]).toEqual({ gte: new Date("2026-01-01T00:00:00.000Z") });
  });

  it("returns a keyset page with hasMore when an extra row comes back", async () => {
    const { repo, notification } = makeRepo();
    notification.findMany.mockResolvedValueOnce([row({ id: "a" }), row({ id: "b" })]);
    const page = await repo.list(COMPANY, PROFILE, { limit: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).not.toBeNull();
  });

  it("applies a valid cursor as a keyset predicate", async () => {
    const { repo, notification } = makeRepo();
    const cursor = Buffer.from(
      JSON.stringify({ p: "2026-01-01T00:00:00.000Z", t: "n0" }),
      "utf8",
    ).toString("base64url");
    await repo.list(COMPANY, PROFILE, { cursor });
    const call = notification.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where["AND"]).toBeDefined();
  });

  it("throws InvalidCursorError on a malformed cursor", async () => {
    const { repo } = makeRepo();
    await expect(repo.list(COMPANY, PROFILE, { cursor: "%%%not-base64%%%" })).rejects.toThrow(
      InvalidCursorError,
    );
  });
});

describe("NotificationsRepository — markRead", () => {
  it("returns updated: 0 without a query when ids is empty", async () => {
    const { repo, notification } = makeRepo();
    const result = await repo.markRead(COMPANY, PROFILE, []);
    expect(result).toEqual({ updated: 0 });
    expect(notification.updateMany).not.toHaveBeenCalled();
  });

  it("marks only the caller's own unread ids", async () => {
    const { repo, notification } = makeRepo();
    const result = await repo.markRead(COMPANY, PROFILE, ["n1", "n2"]);
    expect(result).toEqual({ updated: 1 });
    const call = notification.updateMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({
      companyId: COMPANY,
      profileId: PROFILE,
      id: { in: ["n1", "n2"] },
      readAt: null,
    });
  });
});

describe("NotificationsRepository — create", () => {
  it("stamps company/profile and stores the payload", async () => {
    const { repo, notification } = makeRepo();
    await repo.create(COMPANY, PROFILE, {
      type: "payment.collected",
      title: "Payment collected",
      body: "…",
      payload: { orderId: "o1", amountMinor: 500 },
    });
    const call = notification.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data["companyId"]).toBe(COMPANY);
    expect(call.data["profileId"]).toBe(PROFILE);
    expect(call.data["payload"]).toEqual({ orderId: "o1", amountMinor: 500 });
  });
});

describe("NotificationsRepository — preferences", () => {
  it("fills defaults for every notification type when no rows exist", async () => {
    const { repo } = makeRepo();
    const prefs = await repo.getPreferences(COMPANY, PROFILE);
    expect(prefs).toEqual([
      { type: "order.status_changed", inAppEnabled: true, webPushEnabled: true },
      { type: "payment.collected", inAppEnabled: true, webPushEnabled: true },
      { type: "order_vendor_group.assigned", inAppEnabled: true, webPushEnabled: true },
    ]);
  });

  it("uses a stored row's values when present", async () => {
    const { repo, notificationPreference } = makeRepo();
    notificationPreference.findMany.mockResolvedValueOnce([
      { type: "order.status_changed", inAppEnabled: false, webPushEnabled: true },
    ]);
    const prefs = await repo.getPreferences(COMPANY, PROFILE);
    expect(prefs[0]).toEqual({
      type: "order.status_changed",
      inAppEnabled: false,
      webPushEnabled: true,
    });
  });

  it("isChannelEnabled defaults to true with no row", async () => {
    const { repo } = makeRepo();
    expect(await repo.isChannelEnabled(COMPANY, PROFILE, "order.status_changed", "webPush")).toBe(
      true,
    );
  });

  it("isChannelEnabled reads the stored value", async () => {
    const { repo, notificationPreference } = makeRepo();
    notificationPreference.findFirst.mockResolvedValueOnce({
      inAppEnabled: true,
      webPushEnabled: false,
    });
    expect(await repo.isChannelEnabled(COMPANY, PROFILE, "order.status_changed", "webPush")).toBe(
      false,
    );
  });

  it("upsertPreferences upserts each update by the compound key", async () => {
    const { repo, notificationPreference } = makeRepo();
    await repo.upsertPreferences(COMPANY, PROFILE, [
      { type: "order.status_changed", inAppEnabled: false, webPushEnabled: false },
    ]);
    expect(notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_profileId_type: {
            companyId: COMPANY,
            profileId: PROFILE,
            type: "order.status_changed",
          },
        },
      }),
    );
  });
});

describe("NotificationsRepository — push subscriptions", () => {
  it("lists active subscriptions scoped to the caller", async () => {
    const { repo, pushSubscription } = makeRepo();
    await repo.listActiveSubscriptions(COMPANY, PROFILE);
    const call = pushSubscription.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where).toEqual({ companyId: COMPANY, profileId: PROFILE });
  });

  it("registers (upserts by endpoint) a subscription", async () => {
    const { repo } = makeRepo();
    const view = await repo.registerSubscription(COMPANY, PROFILE, {
      endpoint: "https://push.example/ep",
      p256dh: "p",
      auth: "a",
    });
    expect(view.id).toBe("sub1");
    expect(view.endpoint).toBe("https://push.example/ep");
  });

  it("deleteSubscription reports whether the caller owned the row", async () => {
    const { repo, pushSubscription } = makeRepo();
    pushSubscription.deleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.deleteSubscription(COMPANY, PROFILE, "missing")).toBe(false);
  });

  it("deleteSubscriptionById deletes regardless of owner", async () => {
    const { repo, pushSubscription } = makeRepo();
    await repo.deleteSubscriptionById(COMPANY, "sub1");
    const call = pushSubscription.deleteMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toEqual({ companyId: COMPANY, id: "sub1" });
  });
});
