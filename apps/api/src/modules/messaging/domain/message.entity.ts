/**
 * Read models for the messaging module (EPIC-17). Views, not Prisma rows: the
 * repository maps rows to these and nothing above it sees a `Date` or a
 * database column name.
 */

/** Which side of a vendor conversation a message came from. */
export const SENDER_KINDS = ["vendor", "staff"] as const;

export type SenderKind = (typeof SENDER_KINDS)[number];

/** Whether a thread still accepts messages. */
export const THREAD_STATUSES = ["open", "archived"] as const;

export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/**
 * A member's standing in this module: which membership row they are, and the
 * warehouse they are confined to. `warehouseId` is `null` for ordinary staff,
 * who see every thread in the company — the same "scoped iff
 * `CompanyMember.warehouseId` is set" rule `InventoryService` follows, keyed
 * off the column rather than off `role === "vendor"` literally.
 */
export interface Participant {
  readonly memberId: string;
  readonly warehouseId: string | null;
}

/** One vendor conversation, as the thread list and thread header show it. */
export interface MessageThreadView {
  readonly id: string;
  readonly warehouseId: string;
  /** The warehouse's name — what staff actually read in the list. */
  readonly warehouseName: string;
  readonly vendorMemberId: string;
  readonly status: ThreadStatus;
  readonly lastMessageAt: string | null;
  readonly lastMessagePreview: string | null;
  /**
   * Messages from the *other* side that arrived after the caller's read
   * cursor. Always the caller's own count — two members looking at the same
   * thread see different numbers.
   */
  readonly unreadCount: number;
  readonly createdAt: string;
}

/** One message in a thread. */
export interface MessageView {
  readonly id: string;
  readonly threadId: string;
  readonly senderProfileId: string;
  /** The sender's display name, or `null` if their profile has none set. */
  readonly senderName: string | null;
  readonly senderKind: SenderKind;
  /** `null` once the message is deleted, or for an image-only message (M17.3). */
  readonly body: string | null;
  readonly deletedAt: string | null;
  readonly createdAt: string;
}
