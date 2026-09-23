import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { clampLimit, InvalidCursorError, type KeysetPage } from "@cadeau/database";
import { FileStorageError, type FileStoragePort } from "@cadeau/storage";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors } from "../../../shared/errors/app-exception";
import { withErrorMapping } from "../../../shared/errors/with-error-mapping";
import { EVENT_BUS, type EventBusPort } from "../../../shared/events/event-bus.port";
import { CLOCK, type Clock } from "../../../shared/time/clock";
import {
  IMAGE_PROCESSOR,
  ImageProcessingError,
  type ImageProcessorPort,
} from "../domain/image-processor.port";
import {
  attachmentStorageKey,
  describeRejection,
  MAX_ATTACHMENTS_PER_MESSAGE,
  validateUpload,
} from "../domain/image-rules";
import {
  MAX_ORDER_REFS_PER_MESSAGE,
  MENTION_SEARCH_LIMIT,
  parseMentionQuery,
  rejectedOrderIds,
} from "../domain/mention-rules";
import type {
  AttachmentRecord,
  AttachmentView,
  MentionableOrderView,
  MessageRecord,
  MessageThreadView,
  MessageView,
  Participant,
} from "../domain/message.entity";
import { ATTACHMENT_URL_TTL_SECONDS, FILE_STORAGE } from "../domain/file-storage.token";
import { MESSAGING_AUDIT, type MessagingAuditPort } from "../domain/messaging-audit.port";
import {
  MESSAGING_REPOSITORY,
  type ListQuery,
  type MessagingRepositoryPort,
  type OrderReferenceInput,
  type VendorWarehouseView,
  type WriteActor,
} from "../domain/messaging-repository.port";
import { ThreadAlreadyExistsError } from "../domain/messaging.errors";
import { buildPreview, canAccessThread, isVendor, senderKindOf } from "../domain/participation";

/** What the caller submits when posting a message. */
export interface SendMessageCommand {
  readonly body: string;
  /** Ids from `uploadAttachment`; empty for a text-only message. */
  readonly attachmentIds: readonly string[];
  /** Orders the message points at — the `@` mentions the composer collected. */
  readonly orderIds: readonly string[];
}

/**
 * Orchestrates vendor conversations (EPIC-17).
 *
 * Two kinds of caller share these routes. Staff (`messaging.manage`) reach
 * every thread in the company; a vendor reaches only the thread of the
 * warehouse their membership is confined to. The controller's
 * `@RequireCapability` decides *whether* a caller may use messaging at all;
 * deciding *which* conversation is this service's job, and the database
 * enforces the same split again through the `message_threads` RLS policy.
 *
 * A thread is created lazily. Nothing exists until someone opens the
 * conversation, so the tables stay empty for companies that never use the
 * feature, and a newly joined vendor needs no provisioning step.
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepositoryPort,
    @Inject(MESSAGING_AUDIT) private readonly audit: MessagingAuditPort,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    @Inject(IMAGE_PROCESSOR) private readonly images: ImageProcessorPort,
    @Inject(EVENT_BUS) private readonly events: EventBusPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The threads the caller may see. A vendor is given their own thread and
   * nothing else, so the same route serves both sides of the conversation.
   */
  async listThreads(
    principal: RequestPrincipal,
    rawQuery: ListQuery,
  ): Promise<KeysetPage<MessageThreadView>> {
    const { companyId, participant } = await this.resolve(principal);

    // A vendor has at most one conversation, so the list degenerates to it.
    // Serving them from the same route keeps the client identical on both
    // sides, and there is nothing to paginate through.
    if (isVendor(participant)) {
      const thread = await this.repo.findThreadByWarehouse(
        companyId,
        principal.userId,
        participant.warehouseId,
      );
      return {
        data: thread === null ? [] : [thread],
        page: { limit: clampLimit(rawQuery.limit), nextCursor: null, hasMore: false },
      };
    }

    return withErrorMapping(
      () => this.repo.listThreads(companyId, principal.userId, rawQuery),
      (error) => this.mapError(error),
    );
  }

  /**
   * Every vendor in the company and the thread they have, if any — what the
   * staff "start a conversation" picker lists. Staff-only: to a vendor this
   * would be a directory of the other vendors.
   */
  async listVendorWarehouses(principal: RequestPrincipal): Promise<readonly VendorWarehouseView[]> {
    const { companyId, participant } = await this.resolve(principal);
    if (isVendor(participant)) {
      throw AppErrors.forbidden("Only company staff can list vendor conversations.");
    }
    return this.repo.listVendorWarehouses(companyId);
  }

  /**
   * The caller's own conversation, created on first open. Vendors only — for
   * staff there is no single "my thread", so they use {@link openThread}.
   */
  async getOwnThread(principal: RequestPrincipal): Promise<MessageThreadView> {
    const { companyId, participant } = await this.resolve(principal);
    if (!isVendor(participant)) {
      throw AppErrors.notFound("Only a vendor account has a conversation of its own.");
    }
    return this.getOrCreateThread(
      { companyId, actorId: principal.userId },
      principal.userId,
      participant.warehouseId,
      participant.memberId,
    );
  }

  /**
   * Opens the conversation with one vendor, creating it if this is the first
   * time anyone has written. Staff-only; a vendor uses {@link getOwnThread}.
   */
  async openThread(principal: RequestPrincipal, warehouseId: string): Promise<MessageThreadView> {
    const { companyId, participant } = await this.resolve(principal);
    if (isVendor(participant)) {
      throw AppErrors.forbidden("A vendor can only open their own conversation.");
    }

    const vendors = await this.repo.listVendorWarehouses(companyId);
    const vendor = vendors.find((v) => v.warehouseId === warehouseId);
    if (vendor === undefined) {
      throw AppErrors.notFound("No vendor account is attached to this warehouse.");
    }

    return this.getOrCreateThread(
      { companyId, actorId: principal.userId },
      principal.userId,
      warehouseId,
      vendor.vendorMemberId,
    );
  }

  async listMessages(
    principal: RequestPrincipal,
    threadId: string,
    rawQuery: ListQuery,
  ): Promise<KeysetPage<MessageView>> {
    const { companyId } = await this.requireThreadAccess(principal, threadId);
    const page = await withErrorMapping(
      () => this.repo.listMessages(companyId, threadId, rawQuery),
      (error) => this.mapError(error),
    );
    return { ...page, data: await Promise.all(page.data.map((m) => this.withUrls(m))) };
  }

  /**
   * Accepts an image and hands back the id to attach it with.
   *
   * The bytes are validated, re-encoded and stored *before* the row exists, so
   * a failure anywhere leaves no row pointing at an object that was never
   * written. The opposite order would leave a broken attachment behind.
   */
  async uploadAttachment(principal: RequestPrincipal, source: Buffer): Promise<AttachmentView> {
    const { companyId, participant } = await this.resolve(principal);
    // Resolving the participant is the access check: a caller with the
    // permission but no membership in this tenant has nothing to upload to.
    void participant;

    const rejection = validateUpload(source);
    if (rejection !== null) {
      throw AppErrors.validation("Request validation failed", [
        { field: "file", messages: [describeRejection(rejection)] },
      ]);
    }

    let processed;
    try {
      processed = await this.images.toStorableImage(source);
    } catch (error) {
      if (error instanceof ImageProcessingError) {
        throw AppErrors.validation("Request validation failed", [
          { field: "file", messages: ["The image could not be read."] },
        ]);
      }
      throw error;
    }

    const id = randomUUID();
    const storageKey = attachmentStorageKey(companyId, id);
    try {
      await this.storage.put(storageKey, processed.body, processed.contentType);
    } catch (error) {
      // `DisabledFileStorage` (object storage not yet configured for this
      // deploy) or a real S3 failure both land here — either way the caller
      // gets an honest "try again later" instead of a raw 500, and nothing
      // was written, so there is no row to clean up.
      if (error instanceof FileStorageError) {
        throw AppErrors.serviceUnavailable(error.message);
      }
      throw error;
    }

    const record = await this.repo.createAttachment(
      { companyId, actorId: principal.userId },
      {
        id,
        storageKey,
        mimeType: processed.contentType,
        sizeBytes: processed.body.byteLength,
        width: processed.width,
        height: processed.height,
      },
    );

    return this.toAttachmentView(record);
  }

  /**
   * The orders the `@` picker may offer in this conversation.
   *
   * Scoped to the thread's own warehouse for staff as well as for vendors: the
   * mention is rendered into the vendor's conversation, so an unscoped picker
   * would let a mistyped selection disclose another vendor's order number.
   */
  async searchMentionableOrders(
    principal: RequestPrincipal,
    threadId: string,
    rawQuery: string | undefined,
  ): Promise<readonly MentionableOrderView[]> {
    const { companyId, participant, thread } = await this.requireThreadAccess(principal, threadId);
    return this.repo.searchMentionableOrders(
      companyId,
      thread.warehouseId,
      parseMentionQuery(rawQuery),
      MENTION_SEARCH_LIMIT,
      // Staff may search their own company's customers by name; a vendor may
      // not, because their view of an order does not include who placed it.
      !isVendor(participant),
    );
  }

  async sendMessage(
    principal: RequestPrincipal,
    threadId: string,
    command: SendMessageCommand,
  ): Promise<MessageView> {
    const { companyId, participant, thread } = await this.requireThreadAccess(principal, threadId);

    if (thread.status === "archived") {
      throw AppErrors.conflict("This conversation is archived.");
    }

    const body = command.body.trim();
    const attachmentIds = [...new Set(command.attachmentIds)];
    const orderIds = [...new Set(command.orderIds)];

    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw AppErrors.validation("Request validation failed", [
        {
          field: "attachmentIds",
          messages: [`A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} images.`],
        },
      ]);
    }

    if (orderIds.length > MAX_ORDER_REFS_PER_MESSAGE) {
      throw AppErrors.validation("Request validation failed", [
        {
          field: "orderIds",
          messages: [`A message can reference at most ${MAX_ORDER_REFS_PER_MESSAGE} orders.`],
        },
      ]);
    }

    // An image on its own is a perfectly good message; nothing at all is not.
    // A mention alone is not enough either — it says which order, not what
    // about it.
    if (body.length === 0 && attachmentIds.length === 0) {
      throw AppErrors.validation("Request validation failed", [
        { field: "body", messages: ["A message needs text or at least one image."] },
      ]);
    }

    const actor: WriteActor = { companyId, actorId: principal.userId };

    if (attachmentIds.length > 0) {
      const found = await this.repo.findUnclaimedAttachments(actor, attachmentIds);
      // Not found means: never uploaded, uploaded by someone else, or already
      // on another message. All three are the same answer to the sender, and
      // saying which would confirm that an id they guessed exists.
      if (found.length !== attachmentIds.length) {
        throw AppErrors.validation("Request validation failed", [
          {
            field: "attachmentIds",
            messages: ["One or more images are unknown or already attached."],
          },
        ]);
      }
    }

    // The authority behind an `@`. The client sends order ids; they are only
    // written after the database confirms each one belongs to *this thread's*
    // warehouse. Without this a crafted request could paste any order in the
    // company into a vendor's conversation — and for staff, so could an
    // ordinary mistake.
    const orderRefs: OrderReferenceInput[] = [];
    if (orderIds.length > 0) {
      const mentionable = await this.repo.findMentionableOrdersByIds(
        companyId,
        thread.warehouseId,
        orderIds,
      );
      const rejected = rejectedOrderIds(
        orderIds,
        mentionable.map((order) => order.orderId),
      );
      if (rejected.length > 0) {
        // Which ids were rejected is not named: to a vendor, "this one exists
        // but is not yours" and "this one does not exist" must look the same.
        throw AppErrors.validation("Request validation failed", [
          {
            field: "orderIds",
            messages: ["One or more orders cannot be referenced in this conversation."],
          },
        ]);
      }
      orderRefs.push(
        ...mentionable.map((order) => ({
          orderId: order.orderId,
          orderNumber: order.orderNumber,
        })),
      );
    }

    const senderKind = senderKindOf(participant);
    const preview = buildPreview(body.length === 0 ? null : body);

    const message = await this.repo.createMessage(actor, {
      threadId,
      senderKind,
      body: body.length === 0 ? null : body,
      preview,
      attachmentIds,
      orderRefs,
    });

    // Ids, counts and a length only — a message body is free text the sender
    // may have pasted a customer's details into (docs/privacy-model.md §6).
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "message.sent",
      entityType: "message",
      entityId: message.id,
      changes: {
        threadId,
        senderKind: message.senderKind,
        bodyLength: body.length,
        attachmentCount: attachmentIds.length,
        orderIds: orderRefs.map((ref) => ref.orderId),
      },
    });

    // `preview` is the same capped, already-committed string just written to
    // the thread row — not the raw body — so this stays inside the
    // `message.created` payload doc's privacy bound (EPIC-17 M17.5).
    await this.events.publish({
      type: "message.created",
      companyId,
      actorId: principal.userId,
      occurredAt: this.clock.now(),
      payload: { threadId, warehouseId: thread.warehouseId, senderKind, preview },
    });

    return this.withUrls(message);
  }

  /** Moves the caller's own read cursor to now. */
  async markRead(principal: RequestPrincipal, threadId: string): Promise<{ lastReadAt: string }> {
    const { companyId } = await this.requireThreadAccess(principal, threadId);
    return this.repo.markRead({ companyId, actorId: principal.userId }, threadId);
  }

  // ---- internals -------------------------------------------------------------

  /**
   * Attaches a freshly minted signed URL to each of a message's images.
   *
   * Minted per response rather than stored, so a link cannot outlive the
   * permission check that produced it: the caller proved access to the thread
   * moments ago, and the URL expires shortly after.
   */
  private async withUrls(message: MessageRecord): Promise<MessageView> {
    return {
      ...message,
      attachments: await Promise.all(
        message.attachments.map((attachment) => this.toAttachmentView(attachment)),
      ),
    };
  }

  private async toAttachmentView(record: AttachmentRecord): Promise<AttachmentView> {
    return {
      id: record.id,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      width: record.width,
      height: record.height,
      url: await this.storage.getSignedUrl(record.storageKey, ATTACHMENT_URL_TTL_SECONDS),
    };
  }

  /**
   * Resolves the thread and proves the caller belongs in it.
   *
   * A thread the caller may not see is reported as *not found*, never as
   * forbidden: telling one vendor that another vendor's conversation exists
   * would leak the company's vendor list one probe at a time.
   */
  private async requireThreadAccess(
    principal: RequestPrincipal,
    threadId: string,
  ): Promise<{ companyId: string; participant: Participant; thread: MessageThreadView }> {
    const { companyId, participant } = await this.resolve(principal);
    const thread = await this.repo.findThreadById(companyId, principal.userId, threadId);
    if (thread === null || !canAccessThread(participant, thread)) {
      throw AppErrors.notFound("Conversation not found.");
    }
    return { companyId, participant, thread };
  }

  /**
   * Reads the thread for a warehouse, creating it if absent. Two callers
   * opening the same conversation at once is ordinary, not an error: the one
   * that loses the unique-constraint race re-reads the winner's row.
   */
  private async getOrCreateThread(
    actor: WriteActor,
    viewerProfileId: string,
    warehouseId: string,
    vendorMemberId: string,
  ): Promise<MessageThreadView> {
    const existing = await this.repo.findThreadByWarehouse(
      actor.companyId,
      viewerProfileId,
      warehouseId,
    );
    if (existing !== null) return existing;

    try {
      const created = await this.repo.createThread(actor, { warehouseId, vendorMemberId });
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.actorId,
        action: "message_thread.created",
        entityType: "message_thread",
        entityId: created.id,
        changes: { warehouseId },
      });
      return created;
    } catch (error) {
      if (!(error instanceof ThreadAlreadyExistsError)) throw error;
      const raced = await this.repo.findThreadByWarehouse(
        actor.companyId,
        viewerProfileId,
        warehouseId,
      );
      if (raced === null) throw error;
      return raced;
    }
  }

  /** The active tenant plus the caller's standing in it. */
  private async resolve(
    principal: RequestPrincipal,
  ): Promise<{ companyId: string; participant: Participant }> {
    const companyId = this.requireTenant(principal);
    const participant = await this.repo.findParticipant(companyId, principal.userId);
    if (participant === null) {
      throw AppErrors.forbidden("You are not a member of this company.");
    }
    return { companyId, participant };
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }

  private mapError(error: unknown): unknown {
    if (error instanceof InvalidCursorError) {
      return AppErrors.badRequest("Invalid cursor.");
    }
    return error;
  }
}
