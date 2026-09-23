import { Inject, Injectable } from "@nestjs/common";
import { clampLimit, InvalidCursorError, type KeysetPage } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors } from "../../../shared/errors/app-exception";
import { withErrorMapping } from "../../../shared/errors/with-error-mapping";
import type { MessageThreadView, MessageView, Participant } from "../domain/message.entity";
import { MESSAGING_AUDIT, type MessagingAuditPort } from "../domain/messaging-audit.port";
import {
  MESSAGING_REPOSITORY,
  type ListQuery,
  type MessagingRepositoryPort,
  type VendorWarehouseView,
  type WriteActor,
} from "../domain/messaging-repository.port";
import { ThreadAlreadyExistsError } from "../domain/messaging.errors";
import { buildPreview, canAccessThread, isVendor, senderKindOf } from "../domain/participation";

/** What the caller submits when posting a message. */
export interface SendMessageCommand {
  readonly body: string;
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
    return withErrorMapping(
      () => this.repo.listMessages(companyId, threadId, rawQuery),
      (error) => this.mapError(error),
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
    if (body.length === 0) {
      throw AppErrors.validation("Request validation failed", [
        { field: "body", messages: ["body must not be empty"] },
      ]);
    }

    const actor: WriteActor = { companyId, actorId: principal.userId };
    const message = await this.repo.createMessage(actor, {
      threadId,
      senderKind: senderKindOf(participant),
      body,
      preview: buildPreview(body),
    });

    // Ids and a length only — a message body is free text the sender may have
    // pasted a customer's details into (docs/privacy-model.md §6).
    await this.audit.record({
      companyId,
      actorId: principal.userId,
      action: "message.sent",
      entityType: "message",
      entityId: message.id,
      changes: { threadId, senderKind: message.senderKind, bodyLength: body.length },
    });

    return message;
  }

  /** Moves the caller's own read cursor to now. */
  async markRead(principal: RequestPrincipal, threadId: string): Promise<{ lastReadAt: string }> {
    const { companyId } = await this.requireThreadAccess(principal, threadId);
    return this.repo.markRead({ companyId, actorId: principal.userId }, threadId);
  }

  // ---- internals -------------------------------------------------------------

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
