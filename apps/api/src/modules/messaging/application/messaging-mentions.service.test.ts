import { describe, expect, it, vi } from "vitest";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { MAX_ORDER_REFS_PER_MESSAGE, MENTION_SEARCH_LIMIT } from "../domain/mention-rules";
import type {
  MentionableOrderView,
  MessageRecord,
  MessageThreadView,
  Participant,
} from "../domain/message.entity";
import type { MessagingRepositoryPort } from "../domain/messaging-repository.port";
import { MessagingService } from "./messaging.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const WAREHOUSE_A = "33333333-3333-3333-3333-333333333333";
const THREAD = "55555555-5555-5555-5555-555555555555";
const ORDER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORDER_OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const principal: RequestPrincipal = { userId: USER, sessionId: "s1", companyId: COMPANY };
const staff: Participant = { memberId: "m-staff", warehouseId: null };
const vendorA: Participant = { memberId: "m-a", warehouseId: WAREHOUSE_A };

function threadView(extra: Partial<MessageThreadView> = {}): MessageThreadView {
  return {
    id: THREAD,
    warehouseId: WAREHOUSE_A,
    warehouseName: "Cairo vendor",
    vendorMemberId: "m-a",
    status: "open",
    lastMessageAt: null,
    lastMessagePreview: null,
    unreadCount: 0,
    createdAt: "2026-01-02T03:04:05.000Z",
    ...extra,
  };
}

function mentionable(extra: Partial<MentionableOrderView> = {}): MentionableOrderView {
  return {
    orderId: ORDER_A,
    orderNumber: "1023",
    status: "processing",
    createdAt: "2026-01-02T03:04:05.000Z",
    ...extra,
  };
}

function messageRecord(extra: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: "msg-1",
    threadId: THREAD,
    senderProfileId: USER,
    senderName: "Sara",
    senderKind: "staff",
    body: "check this",
    attachments: [],
    orderRefs: [],
    deletedAt: null,
    createdAt: "2026-01-02T03:04:05.000Z",
    ...extra,
  };
}

function makeService(participant: Participant = staff) {
  const repo: { [K in keyof MessagingRepositoryPort]: ReturnType<typeof vi.fn> } = {
    findParticipant: vi.fn().mockResolvedValue(participant),
    listVendorWarehouses: vi.fn().mockResolvedValue([]),
    listThreads: vi.fn(),
    findThreadById: vi.fn().mockResolvedValue(threadView()),
    findThreadByWarehouse: vi.fn().mockResolvedValue(threadView()),
    createThread: vi.fn(),
    listMessages: vi.fn(),
    createMessage: vi.fn().mockResolvedValue(messageRecord()),
    markRead: vi.fn(),
    createAttachment: vi.fn(),
    findUnclaimedAttachments: vi.fn().mockResolvedValue([]),
    findOrphanedAttachments: vi.fn().mockResolvedValue([]),
    deleteAttachments: vi.fn().mockResolvedValue(0),
    searchMentionableOrders: vi.fn().mockResolvedValue([mentionable()]),
    findMentionableOrdersByIds: vi.fn().mockResolvedValue([]),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const storage = {
    put: vi.fn(),
    getSignedUrl: vi.fn().mockResolvedValue("https://bucket.example/signed"),
    delete: vi.fn(),
  };
  const images = { toStorableImage: vi.fn() };
  const events = { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() };
  const clock = { now: () => 1_700_000_000_000 };
  const service = new MessagingService(
    repo as unknown as MessagingRepositoryPort,
    audit,
    storage,
    images,
    events,
    clock,
  );
  return { service, repo, audit };
}

describe("MessagingService — the @ picker", () => {
  // The scope that makes a mention safe: only orders this thread's warehouse
  // has a group in, for staff exactly as for vendors.
  it("searches only within the thread's own warehouse", async () => {
    const { service, repo } = makeService(staff);

    await service.searchMentionableOrders(principal, THREAD, "1023");

    expect(repo.searchMentionableOrders).toHaveBeenCalledWith(
      COMPANY,
      WAREHOUSE_A,
      { kind: "number", orderNumber: "1023" },
      MENTION_SEARCH_LIMIT,
      true,
    );
  });

  it("applies the same warehouse scope when a vendor searches", async () => {
    const { service, repo } = makeService(vendorA);

    await service.searchMentionableOrders(principal, THREAD, "");

    expect(repo.searchMentionableOrders).toHaveBeenCalledWith(
      COMPANY,
      WAREHOUSE_A,
      { kind: "all" },
      MENTION_SEARCH_LIMIT,
      // A vendor reaches these orders but not who placed them.
      false,
    );
  });

  it("refuses to search a conversation the caller cannot see", async () => {
    const { service, repo } = makeService(vendorA);
    repo.findThreadById.mockResolvedValue(
      threadView({ warehouseId: "99999999-9999-9999-9999-999999999999" }),
    );

    await expect(service.searchMentionableOrders(principal, THREAD, "")).rejects.toMatchObject({
      status: 404,
    });
    expect(repo.searchMentionableOrders).not.toHaveBeenCalled();
  });
});

describe("MessagingService — writing an @ mention", () => {
  it("stores the reference with the order number as a snapshot", async () => {
    const { service, repo } = makeService(staff);
    repo.findMentionableOrdersByIds.mockResolvedValue([mentionable()]);

    await service.sendMessage(principal, THREAD, {
      body: "this one is late",
      attachmentIds: [],
      orderIds: [ORDER_A],
    });

    expect(repo.createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderRefs: [{ orderId: ORDER_A, orderNumber: "1023" }] }),
    );
  });

  // The whole point of M17.4's server-side check: the client sends ids, and an
  // id from outside this warehouse must never be written into the thread.
  it("refuses an order that is not mentionable in this conversation", async () => {
    const { service, repo } = makeService(staff);
    repo.findMentionableOrdersByIds.mockResolvedValue([]);

    await expect(
      service.sendMessage(principal, THREAD, {
        body: "look",
        attachmentIds: [],
        orderIds: [ORDER_OTHER],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.createMessage).not.toHaveBeenCalled();
  });

  it("checks the ids against the thread's warehouse, not the caller's", async () => {
    const { service, repo } = makeService(staff);
    repo.findMentionableOrdersByIds.mockResolvedValue([mentionable()]);

    await service.sendMessage(principal, THREAD, {
      body: "x",
      attachmentIds: [],
      orderIds: [ORDER_A],
    });

    expect(repo.findMentionableOrdersByIds).toHaveBeenCalledWith(COMPANY, WAREHOUSE_A, [ORDER_A]);
  });

  it("refuses the whole message when only some ids are mentionable", async () => {
    const { service, repo } = makeService(staff);
    repo.findMentionableOrdersByIds.mockResolvedValue([mentionable()]);

    await expect(
      service.sendMessage(principal, THREAD, {
        body: "x",
        attachmentIds: [],
        orderIds: [ORDER_A, ORDER_OTHER],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  // Naming the rejected id would confirm to a vendor that it exists.
  it("does not say which order was rejected", async () => {
    const { service, repo } = makeService(vendorA);
    repo.findMentionableOrdersByIds.mockResolvedValue([]);

    const error = await service
      .sendMessage(principal, THREAD, { body: "x", attachmentIds: [], orderIds: [ORDER_OTHER] })
      .catch((e: unknown) => e);

    expect(JSON.stringify(error)).not.toContain(ORDER_OTHER);
  });

  it("collapses a repeated mention instead of writing it twice", async () => {
    const { service, repo } = makeService(staff);
    repo.findMentionableOrdersByIds.mockResolvedValue([mentionable()]);

    await service.sendMessage(principal, THREAD, {
      body: "x",
      attachmentIds: [],
      orderIds: [ORDER_A, ORDER_A],
    });

    expect(repo.findMentionableOrdersByIds).toHaveBeenCalledWith(COMPANY, WAREHOUSE_A, [ORDER_A]);
  });

  it("caps how many orders one message can reference", async () => {
    const { service, repo } = makeService(staff);
    const ids = Array.from(
      { length: MAX_ORDER_REFS_PER_MESSAGE + 1 },
      (_, i) => `0000000${i}-0000-0000-0000-00000000000${i}`,
    );

    await expect(
      service.sendMessage(principal, THREAD, { body: "x", attachmentIds: [], orderIds: ids }),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.findMentionableOrdersByIds).not.toHaveBeenCalled();
  });

  // A mention says which order, not what about it.
  it("still requires text or an image alongside a mention", async () => {
    const { service, repo } = makeService(staff);
    repo.findMentionableOrdersByIds.mockResolvedValue([mentionable()]);

    await expect(
      service.sendMessage(principal, THREAD, {
        body: "",
        attachmentIds: [],
        orderIds: [ORDER_A],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("skips the lookup entirely when nothing was mentioned", async () => {
    const { service, repo } = makeService(staff);

    await service.sendMessage(principal, THREAD, { body: "x", attachmentIds: [], orderIds: [] });

    expect(repo.findMentionableOrdersByIds).not.toHaveBeenCalled();
    expect(repo.createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderRefs: [] }),
    );
  });

  it("records the mentioned order ids in the audit trail", async () => {
    const { service, repo, audit } = makeService(staff);
    repo.findMentionableOrdersByIds.mockResolvedValue([mentionable()]);

    await service.sendMessage(principal, THREAD, {
      body: "x",
      attachmentIds: [],
      orderIds: [ORDER_A],
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ changes: expect.objectContaining({ orderIds: [ORDER_A] }) }),
    );
  });
});
