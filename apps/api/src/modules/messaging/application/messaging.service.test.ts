import { describe, expect, it, vi } from "vitest";
import { InvalidCursorError } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import type {
  AttachmentRecord,
  MessageRecord,
  MessageThreadView,
  Participant,
} from "../domain/message.entity";
import type {
  MessagingRepositoryPort,
  VendorWarehouseView,
} from "../domain/messaging-repository.port";
import { ThreadAlreadyExistsError } from "../domain/messaging.errors";
import { MessagingService } from "./messaging.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const WAREHOUSE_A = "33333333-3333-3333-3333-333333333333";
const WAREHOUSE_B = "44444444-4444-4444-4444-444444444444";
const THREAD_A = "55555555-5555-5555-5555-555555555555";
const THREAD_B = "66666666-6666-6666-6666-666666666666";
const ATTACHMENT = "77777777-7777-7777-7777-777777777777";

const principal: RequestPrincipal = { userId: USER, sessionId: "s1", companyId: COMPANY };

const staff: Participant = { memberId: "m-staff", warehouseId: null };
const vendorA: Participant = { memberId: "m-a", warehouseId: WAREHOUSE_A };

function threadView(extra: Partial<MessageThreadView> = {}): MessageThreadView {
  return {
    id: THREAD_A,
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

function messageView(extra: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: "msg-1",
    threadId: THREAD_A,
    senderProfileId: USER,
    senderName: "Sara",
    senderKind: "staff",
    body: "hello",
    attachments: [],
    orderRefs: [],
    deletedAt: null,
    createdAt: "2026-01-02T03:04:05.000Z",
    ...extra,
  };
}

function vendorWarehouse(extra: Partial<VendorWarehouseView> = {}): VendorWarehouseView {
  return {
    warehouseId: WAREHOUSE_A,
    warehouseName: "Cairo vendor",
    vendorMemberId: "m-a",
    threadId: null,
    ...extra,
  };
}

function attachmentRecord(extra: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id: ATTACHMENT,
    storageKey: `companies/${COMPANY}/messages/${ATTACHMENT}.webp`,
    mimeType: "image/webp",
    sizeBytes: 1024,
    width: 800,
    height: 600,
    ...extra,
  };
}

function makeService(participant: Participant = staff) {
  const repo: { [K in keyof MessagingRepositoryPort]: ReturnType<typeof vi.fn> } = {
    findParticipant: vi.fn().mockResolvedValue(participant),
    listVendorWarehouses: vi.fn().mockResolvedValue([vendorWarehouse()]),
    listThreads: vi.fn().mockResolvedValue({
      data: [threadView()],
      page: { limit: 25, nextCursor: null, hasMore: false },
    }),
    findThreadById: vi.fn().mockResolvedValue(threadView()),
    findThreadByWarehouse: vi.fn().mockResolvedValue(threadView()),
    createThread: vi.fn().mockResolvedValue(threadView()),
    listMessages: vi.fn().mockResolvedValue({
      data: [messageView()],
      page: { limit: 25, nextCursor: null, hasMore: false },
    }),
    createMessage: vi.fn().mockResolvedValue(messageView()),
    markRead: vi.fn().mockResolvedValue({ lastReadAt: "2026-01-02T03:04:05.000Z" }),
    createAttachment: vi.fn().mockResolvedValue(attachmentRecord()),
    findUnclaimedAttachments: vi.fn().mockResolvedValue([]),
    findOrphanedAttachments: vi.fn().mockResolvedValue([]),
    deleteAttachments: vi.fn().mockResolvedValue(0),
    searchMentionableOrders: vi.fn().mockResolvedValue([]),
    findMentionableOrdersByIds: vi.fn().mockResolvedValue([]),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const storage = {
    put: vi.fn().mockResolvedValue(undefined),
    getSignedUrl: vi.fn().mockResolvedValue("https://bucket.example/signed"),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const images = {
    toStorableImage: vi.fn().mockResolvedValue({
      body: Buffer.from("webp-bytes"),
      contentType: "image/webp",
      width: 800,
      height: 600,
    }),
  };
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
  return { service, repo, audit, storage, images, events };
}

describe("MessagingService — tenant and membership", () => {
  it("rejects a caller with no active company", async () => {
    const { service } = makeService();
    await expect(service.listThreads({ ...principal, companyId: null }, {})).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects a caller who is not a member of the company", async () => {
    const { service, repo } = makeService();
    repo.findParticipant.mockResolvedValue(null);
    await expect(service.listThreads(principal, {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("MessagingService — vendor isolation", () => {
  // The whole point of the module: one vendor must not learn that another
  // vendor's conversation exists, let alone read it.
  it("reports another vendor's thread as not found, not as forbidden", async () => {
    const { service, repo } = makeService(vendorA);
    repo.findThreadById.mockResolvedValue(threadView({ id: THREAD_B, warehouseId: WAREHOUSE_B }));

    await expect(service.listMessages(principal, THREAD_B, {})).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses to post into another vendor's thread", async () => {
    const { service, repo } = makeService(vendorA);
    repo.findThreadById.mockResolvedValue(threadView({ id: THREAD_B, warehouseId: WAREHOUSE_B }));

    await expect(
      service.sendMessage(principal, THREAD_B, { body: "hi", attachmentIds: [], orderIds: [] }),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(repo.createMessage).not.toHaveBeenCalled();
  });

  it("lets staff into any thread in the company", async () => {
    const { service, repo } = makeService(staff);
    repo.findThreadById.mockResolvedValue(threadView({ id: THREAD_B, warehouseId: WAREHOUSE_B }));

    await expect(service.listMessages(principal, THREAD_B, {})).resolves.toMatchObject({
      data: [expect.objectContaining({ id: "msg-1" })],
    });
  });

  it("serves a vendor their own thread from the list route, without paginating", async () => {
    const { service, repo } = makeService(vendorA);

    const page = await service.listThreads(principal, {});

    expect(repo.listThreads).not.toHaveBeenCalled();
    expect(repo.findThreadByWarehouse).toHaveBeenCalledWith(COMPANY, USER, WAREHOUSE_A);
    expect(page.data).toHaveLength(1);
    expect(page.page).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it("gives a vendor with no conversation yet an empty list, not an error", async () => {
    const { service, repo } = makeService(vendorA);
    repo.findThreadByWarehouse.mockResolvedValue(null);

    await expect(service.listThreads(principal, {})).resolves.toMatchObject({ data: [] });
  });

  it("keeps the vendor directory away from vendors", async () => {
    const { service } = makeService(vendorA);
    await expect(service.listVendorWarehouses(principal)).rejects.toMatchObject({ status: 403 });
  });

  it("stops a vendor opening a conversation for someone else", async () => {
    const { service, repo } = makeService(vendorA);
    await expect(service.openThread(principal, WAREHOUSE_B)).rejects.toMatchObject({ status: 403 });
    expect(repo.createThread).not.toHaveBeenCalled();
  });
});

describe("MessagingService — opening a conversation", () => {
  it("creates the vendor's own thread on first open", async () => {
    const { service, repo, audit } = makeService(vendorA);
    repo.findThreadByWarehouse.mockResolvedValue(null);

    await service.getOwnThread(principal);

    expect(repo.createThread).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: USER },
      { warehouseId: WAREHOUSE_A, vendorMemberId: "m-a" },
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "message_thread.created" }),
    );
  });

  it("reuses the existing thread instead of creating a second one", async () => {
    const { service, repo } = makeService(vendorA);

    await service.getOwnThread(principal);

    expect(repo.createThread).not.toHaveBeenCalled();
  });

  // Two people opening the same conversation at once is ordinary use, not an
  // error the caller should ever see.
  it("resolves a creation race by reading the winner's thread", async () => {
    const { service, repo } = makeService(vendorA);
    repo.findThreadByWarehouse
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(threadView({ id: THREAD_A }));
    repo.createThread.mockRejectedValue(new ThreadAlreadyExistsError(WAREHOUSE_A));

    await expect(service.getOwnThread(principal)).resolves.toMatchObject({ id: THREAD_A });
  });

  it("tells a staff member they have no conversation of their own", async () => {
    const { service } = makeService(staff);
    await expect(service.getOwnThread(principal)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to open a conversation for a warehouse with no vendor account", async () => {
    const { service, repo } = makeService(staff);
    repo.listVendorWarehouses.mockResolvedValue([]);

    await expect(service.openThread(principal, WAREHOUSE_A)).rejects.toMatchObject({ status: 404 });
  });
});

describe("MessagingService — posting", () => {
  it("stamps the sender kind from the caller's own scope, not the payload", async () => {
    const { service, repo } = makeService(vendorA);

    await service.sendMessage(principal, THREAD_A, {
      body: "the order is ready",
      attachmentIds: [],
      orderIds: [],
    });

    expect(repo.createMessage).toHaveBeenCalledWith(
      { companyId: COMPANY, actorId: USER },
      expect.objectContaining({ senderKind: "vendor", body: "the order is ready" }),
    );
  });

  it("trims the body and stores a preview alongside it", async () => {
    const { service, repo } = makeService(staff);

    await service.sendMessage(principal, THREAD_A, {
      body: "  hello\n\nthere  ",
      attachmentIds: [],
      orderIds: [],
    });

    expect(repo.createMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: "hello\n\nthere", preview: "hello there" }),
    );
  });

  it("rejects a body that is only whitespace", async () => {
    const { service, repo } = makeService(staff);

    await expect(
      service.sendMessage(principal, THREAD_A, { body: "   ", attachmentIds: [], orderIds: [] }),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(repo.createMessage).not.toHaveBeenCalled();
  });

  it("refuses to post into an archived conversation", async () => {
    const { service, repo } = makeService(staff);
    repo.findThreadById.mockResolvedValue(threadView({ status: "archived" }));

    await expect(
      service.sendMessage(principal, THREAD_A, { body: "hi", attachmentIds: [], orderIds: [] }),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it("publishes message.created with the preview, never the raw body", async () => {
    const { service, events } = makeService(vendorA);

    await service.sendMessage(principal, THREAD_A, {
      body: "  hello\n\nthere  ",
      attachmentIds: [],
      orderIds: [],
    });

    expect(events.publish).toHaveBeenCalledWith({
      type: "message.created",
      companyId: COMPANY,
      actorId: USER,
      occurredAt: 1_700_000_000_000,
      payload: {
        threadId: THREAD_A,
        warehouseId: WAREHOUSE_A,
        senderKind: "vendor",
        preview: "hello there",
      },
    });
  });

  // A body is free text somebody may have pasted a customer's details into.
  it("audits the send without recording the message text", async () => {
    const { service, audit } = makeService(staff);

    await service.sendMessage(principal, THREAD_A, {
      body: "call 01000000000",
      attachmentIds: [],
      orderIds: [],
    });

    const record = audit.record.mock.calls[0]?.[0];
    expect(record).toMatchObject({ action: "message.sent", entityType: "message" });
    expect(JSON.stringify(record)).not.toContain("01000000000");
  });
});

describe("MessagingService — list queries", () => {
  it("turns a malformed cursor into a 400 rather than a 500", async () => {
    const { service, repo } = makeService(staff);
    repo.listThreads.mockRejectedValue(new InvalidCursorError());

    await expect(service.listThreads(principal, { cursor: "nope" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("moves only the caller's own read cursor", async () => {
    const { service, repo } = makeService(staff);

    await service.markRead(principal, THREAD_A);

    expect(repo.markRead).toHaveBeenCalledWith({ companyId: COMPANY, actorId: USER }, THREAD_A);
  });
});
