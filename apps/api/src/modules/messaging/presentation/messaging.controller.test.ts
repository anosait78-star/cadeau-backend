import { describe, expect, it, vi } from "vitest";
import { REQUIRE_CAPABILITY_KEY } from "../../../shared/access/require-capability.decorator";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type { MessagingService } from "../application/messaging.service";
import type { MessageThreadView, MessageView } from "../domain/message.entity";
import { OpenThreadDto, SendMessageDto } from "./dto/messaging.dto";
import { MessagingController } from "./messaging.controller";

const principal: RequestPrincipal = {
  userId: "22222222-2222-2222-2222-222222222222",
  sessionId: "s",
  companyId: "11111111-1111-1111-1111-111111111111",
};

const WAREHOUSE = "33333333-3333-3333-3333-333333333333";
const THREAD = "55555555-5555-5555-5555-555555555555";

function threadView(extra: Partial<MessageThreadView> = {}): MessageThreadView {
  return {
    id: THREAD,
    warehouseId: WAREHOUSE,
    warehouseName: "Cairo vendor",
    vendorMemberId: "m-a",
    status: "open",
    lastMessageAt: "2026-01-02T03:04:05.000Z",
    lastMessagePreview: "hello",
    unreadCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function messageView(extra: Partial<MessageView> = {}): MessageView {
  return {
    id: "msg-1",
    threadId: THREAD,
    senderProfileId: principal.userId,
    senderName: "Sara",
    senderKind: "staff",
    body: "hello",
    deletedAt: null,
    createdAt: "2026-01-02T03:04:05.000Z",
    ...extra,
  };
}

function makeController() {
  const service = {
    listThreads: vi.fn(),
    getOwnThread: vi.fn(),
    listVendorWarehouses: vi.fn(),
    openThread: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    markRead: vi.fn(),
  };
  const controller = new MessagingController(service as unknown as MessagingService);
  return { controller, service };
}

function capabilityOf(handler: unknown): unknown {
  return Reflect.getMetadata(REQUIRE_CAPABILITY_KEY, handler as object);
}

describe("MessagingController — access gating", () => {
  // The guard metadata *is* the gate; a missing or wrong permission here would
  // hand a vendor the whole company's conversation list.
  it("gates reading on messaging.read", () => {
    expect(capabilityOf(MessagingController.prototype.listThreads)).toEqual({
      feature: "messaging",
      permission: "messaging.read",
    });
    expect(capabilityOf(MessagingController.prototype.listMessages)).toEqual({
      feature: "messaging",
      permission: "messaging.read",
    });
  });

  it("gates posting on messaging.send", () => {
    expect(capabilityOf(MessagingController.prototype.sendMessage)).toEqual({
      feature: "messaging",
      permission: "messaging.send",
    });
  });

  it("gates the staff-only routes on messaging.manage, which no vendor holds", () => {
    expect(capabilityOf(MessagingController.prototype.listVendors)).toEqual({
      feature: "messaging",
      permission: "messaging.manage",
    });
    expect(capabilityOf(MessagingController.prototype.openThread)).toEqual({
      feature: "messaging",
      permission: "messaging.manage",
    });
  });
});

describe("MessagingController — threads", () => {
  it("maps a thread page to DTOs", async () => {
    const { controller, service } = makeController();
    service.listThreads.mockResolvedValue({
      data: [threadView()],
      page: { limit: 25, nextCursor: null, hasMore: false },
    });

    const dto = await controller.listThreads(principal, {});

    expect(dto.data[0]).toMatchObject({
      id: THREAD,
      warehouseName: "Cairo vendor",
      unreadCount: 3,
    });
    expect(dto.page).toMatchObject({ limit: 25, hasMore: false });
  });

  it("passes limit and cursor through as a parsed query", async () => {
    const { controller, service } = makeController();
    service.listThreads.mockResolvedValue({
      data: [],
      page: { limit: 10, nextCursor: null, hasMore: false },
    });

    await controller.listThreads(principal, { limit: "10", cursor: "abc" });

    expect(service.listThreads).toHaveBeenCalledWith(principal, { limit: 10, cursor: "abc" });
  });

  it("omits absent query params instead of sending undefined", async () => {
    const { controller, service } = makeController();
    service.listThreads.mockResolvedValue({
      data: [],
      page: { limit: 25, nextCursor: null, hasMore: false },
    });

    await controller.listThreads(principal, {});

    expect(service.listThreads).toHaveBeenCalledWith(principal, {});
  });

  it("opens a conversation by warehouse", async () => {
    const { controller, service } = makeController();
    service.openThread.mockResolvedValue(threadView());

    const dto = new OpenThreadDto();
    dto.warehouseId = WAREHOUSE;
    await controller.openThread(principal, dto);

    expect(service.openThread).toHaveBeenCalledWith(principal, WAREHOUSE);
  });

  it("returns the caller's own thread", async () => {
    const { controller, service } = makeController();
    service.getOwnThread.mockResolvedValue(threadView());

    const dto = await controller.getOwnThread(principal);

    expect(dto.id).toBe(THREAD);
  });
});

describe("MessagingController — messages", () => {
  it("maps a message page to DTOs", async () => {
    const { controller, service } = makeController();
    service.listMessages.mockResolvedValue({
      data: [messageView()],
      page: { limit: 25, nextCursor: null, hasMore: false },
    });

    const dto = await controller.listMessages(principal, THREAD, {});

    expect(dto.data[0]).toMatchObject({ id: "msg-1", senderKind: "staff", body: "hello" });
  });

  it("hides the text of a deleted message", async () => {
    const { controller, service } = makeController();
    service.listMessages.mockResolvedValue({
      data: [messageView({ body: null, deletedAt: "2026-01-03T00:00:00.000Z" })],
      page: { limit: 25, nextCursor: null, hasMore: false },
    });

    const dto = await controller.listMessages(principal, THREAD, {});

    expect(dto.data[0]?.body).toBeNull();
    expect(dto.data[0]?.deletedAt).toBe("2026-01-03T00:00:00.000Z");
  });

  it("posts a message and returns it", async () => {
    const { controller, service } = makeController();
    service.sendMessage.mockResolvedValue(messageView());

    const dto = new SendMessageDto();
    dto.body = "hello";
    const result = await controller.sendMessage(principal, THREAD, dto);

    expect(service.sendMessage).toHaveBeenCalledWith(principal, THREAD, { body: "hello" });
    expect(result.id).toBe("msg-1");
  });

  it("returns the caller's new read cursor", async () => {
    const { controller, service } = makeController();
    service.markRead.mockResolvedValue({ lastReadAt: "2026-01-02T03:04:05.000Z" });

    const dto = await controller.markRead(principal, THREAD);

    expect(dto.lastReadAt).toBe("2026-01-02T03:04:05.000Z");
  });
});
