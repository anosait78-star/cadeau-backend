import { InvalidCursorError } from "@cadeau/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppException } from "../../../shared/errors/app-exception";
import type { NotificationsRepositoryPort } from "../domain/notifications-repository.port";
import { NotificationsService } from "./notifications.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

function principal(companyId: string | null = COMPANY): RequestPrincipal {
  return { userId: USER, sessionId: "s1", companyId };
}

function makeRepo() {
  return {
    list: vi
      .fn()
      .mockResolvedValue({ data: [], page: { limit: 25, nextCursor: null, hasMore: false } }),
    markRead: vi.fn().mockResolvedValue({ updated: 1 }),
    create: vi.fn(),
    getPreferences: vi.fn().mockResolvedValue([]),
    isChannelEnabled: vi.fn(),
    upsertPreferences: vi.fn().mockResolvedValue([]),
    listActiveSubscriptions: vi.fn(),
    registerSubscription: vi.fn().mockResolvedValue({
      id: "sub1",
      endpoint: "https://push.example/ep",
      userAgent: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    deleteSubscription: vi.fn().mockResolvedValue(true),
    deleteSubscriptionById: vi.fn(),
  };
}

describe("NotificationsService", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: NotificationsService;

  beforeEach(() => {
    repo = makeRepo();
    service = new NotificationsService(repo as unknown as NotificationsRepositoryPort);
  });

  describe("tenant guard", () => {
    it("rejects every method when there is no active company", async () => {
      const noTenant = principal(null);
      await expect(service.list(noTenant, {})).rejects.toBeInstanceOf(AppException);
      await expect(service.markRead(noTenant, ["n1"])).rejects.toBeInstanceOf(AppException);
      await expect(service.getPreferences(noTenant)).rejects.toBeInstanceOf(AppException);
    });
  });

  describe("list", () => {
    it("scopes to the caller's own userId as the recipient", async () => {
      await service.list(principal(), {});
      expect(repo.list).toHaveBeenCalledWith(COMPANY, USER, {});
    });

    it("rejects an invalid query with a validation error", async () => {
      await expect(service.list(principal(), { type: "bogus" })).rejects.toBeInstanceOf(
        AppException,
      );
      expect(repo.list).not.toHaveBeenCalled();
    });

    it("maps an InvalidCursorError to a 400", async () => {
      repo.list.mockRejectedValueOnce(new InvalidCursorError());
      await expect(service.list(principal(), {})).rejects.toBeInstanceOf(AppException);
    });

    it("rethrows an unrelated repository error", async () => {
      repo.list.mockRejectedValueOnce(new Error("db down"));
      await expect(service.list(principal(), {})).rejects.toThrow("db down");
    });
  });

  describe("markRead", () => {
    it("delegates to the repository with the caller's userId", async () => {
      const result = await service.markRead(principal(), ["n1", "n2"]);
      expect(repo.markRead).toHaveBeenCalledWith(COMPANY, USER, ["n1", "n2"]);
      expect(result).toEqual({ updated: 1 });
    });
  });

  describe("preferences", () => {
    it("getPreferences delegates to the repository", async () => {
      await service.getPreferences(principal());
      expect(repo.getPreferences).toHaveBeenCalledWith(COMPANY, USER);
    });

    it("updatePreferences rejects an unknown type", async () => {
      await expect(
        service.updatePreferences(principal(), [
          { type: "bogus", inAppEnabled: true, webPushEnabled: true },
        ]),
      ).rejects.toBeInstanceOf(AppException);
      expect(repo.upsertPreferences).not.toHaveBeenCalled();
    });

    it("updatePreferences delegates valid updates to the repository", async () => {
      await service.updatePreferences(principal(), [
        { type: "order.status_changed", inAppEnabled: false, webPushEnabled: true },
      ]);
      expect(repo.upsertPreferences).toHaveBeenCalledWith(COMPANY, USER, [
        { type: "order.status_changed", inAppEnabled: false, webPushEnabled: true },
      ]);
    });
  });

  describe("push subscriptions", () => {
    it("registerSubscription delegates to the repository", async () => {
      const view = await service.registerSubscription(principal(), {
        endpoint: "https://push.example/ep",
        p256dh: "p",
        auth: "a",
      });
      expect(repo.registerSubscription).toHaveBeenCalledWith(COMPANY, USER, {
        endpoint: "https://push.example/ep",
        p256dh: "p",
        auth: "a",
      });
      expect(view.id).toBe("sub1");
    });

    it("removeSubscription succeeds when the repository deletes a row", async () => {
      await expect(service.removeSubscription(principal(), "sub1")).resolves.toBeUndefined();
    });

    it("removeSubscription 404s when nothing was deleted", async () => {
      repo.deleteSubscription.mockResolvedValueOnce(false);
      await expect(service.removeSubscription(principal(), "missing")).rejects.toBeInstanceOf(
        AppException,
      );
    });
  });
});
