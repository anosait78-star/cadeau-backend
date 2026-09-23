import type { KeysetPage } from "@cadeau/database";
import type {
  AttachmentRecord,
  MessageRecord,
  MessageThreadView,
  Participant,
  SenderKind,
} from "./message.entity";

/** The company + acting user a write is attributed to. */
export interface WriteActor {
  readonly companyId: string;
  readonly actorId: string;
}

/** A validated, normalized list query for either list endpoint. */
export interface ListQuery {
  readonly limit?: number;
  readonly cursor?: string;
}

/** What creating a thread needs beyond the actor. */
export interface CreateThreadInput {
  readonly warehouseId: string;
  readonly vendorMemberId: string;
}

/** What posting a message needs beyond the actor and the thread. */
export interface CreateMessageInput {
  readonly threadId: string;
  readonly senderKind: SenderKind;
  readonly body: string | null;
  /** Stored on the thread so the list needs no per-row subquery. */
  readonly preview: string | null;
  /**
   * Already-uploaded attachments to attach to this message. Linked in the same
   * transaction as the insert, so a message is never briefly visible without
   * the images it was sent with.
   */
  readonly attachmentIds: readonly string[];
}

/** What recording an upload needs beyond the actor. */
export interface CreateAttachmentInput {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

/** A warehouse that could hold a conversation, for the "start a thread" picker. */
export interface VendorWarehouseView {
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly vendorMemberId: string;
  /** The existing thread's id, or `null` when nobody has written yet. */
  readonly threadId: string | null;
}

export interface MessagingRepositoryPort {
  /**
   * The caller's membership in this company — the id to attribute a thread to
   * and the warehouse that confines them. `null` when they are not a member,
   * which the service treats as no access rather than as unscoped staff.
   */
  findParticipant(companyId: string, userId: string): Promise<Participant | null>;

  /** Every vendor membership in the company, with its thread if one exists. */
  listVendorWarehouses(companyId: string): Promise<readonly VendorWarehouseView[]>;

  /**
   * One page of threads, newest activity first. `viewerProfileId` is whose
   * unread counts are computed — never a shared number.
   */
  listThreads(
    companyId: string,
    viewerProfileId: string,
    query: ListQuery,
  ): Promise<KeysetPage<MessageThreadView>>;

  findThreadById(
    companyId: string,
    viewerProfileId: string,
    threadId: string,
  ): Promise<MessageThreadView | null>;

  findThreadByWarehouse(
    companyId: string,
    viewerProfileId: string,
    warehouseId: string,
  ): Promise<MessageThreadView | null>;

  /** Throws {@link ThreadAlreadyExistsError} when one already exists for the warehouse. */
  createThread(actor: WriteActor, input: CreateThreadInput): Promise<MessageThreadView>;

  /** One page of a thread's messages, newest first. Deleted messages are included. */
  listMessages(
    companyId: string,
    threadId: string,
    query: ListQuery,
  ): Promise<KeysetPage<MessageRecord>>;

  /**
   * Appends the message and refreshes the thread's `lastMessageAt`/preview in
   * the same transaction, so the list can never show a stale last line.
   */
  createMessage(actor: WriteActor, input: CreateMessageInput): Promise<MessageRecord>;

  /**
   * Moves the caller's read cursor to now, creating it on first read. Returns
   * the cursor's new value.
   */
  markRead(actor: WriteActor, threadId: string): Promise<{ lastReadAt: string }>;

  // ---- attachments (M17.3) ---------------------------------------------------

  /**
   * Records an upload that is not yet on a message. The row is what makes the
   * stored object reachable at all, and until a message claims it the row is
   * visible only to its uploader.
   */
  createAttachment(actor: WriteActor, input: CreateAttachmentInput): Promise<AttachmentRecord>;

  /**
   * The uploader's own attachments among `ids` that are still unclaimed.
   *
   * Scoped to the caller deliberately: an attachment id is the only thing
   * standing between an upload and a message, so one member must not be able
   * to attach another member's image by guessing at ids.
   */
  findUnclaimedAttachments(
    actor: WriteActor,
    ids: readonly string[],
  ): Promise<readonly AttachmentRecord[]>;

  /** Storage keys of attachments uploaded before `cutoff` and never sent. */
  findOrphanedAttachments(cutoff: Date, limit: number): Promise<readonly AttachmentRecord[]>;

  /** Drops the rows for attachments whose objects have been deleted. */
  deleteAttachments(ids: readonly string[]): Promise<number>;
}

/** DI token for {@link MessagingRepositoryPort}. */
export const MESSAGING_REPOSITORY = Symbol("MESSAGING_REPOSITORY");
