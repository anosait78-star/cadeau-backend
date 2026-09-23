/**
 * Who may see and write to a vendor conversation (EPIC-17 · M17.2).
 *
 * Pure decisions, kept out of the service so the rules that decide one
 * vendor's isolation from another can be tested exhaustively with no database
 * and no Nest wiring. The database enforces the same split independently (the
 * `message_threads_tenant` RLS policy in the M17.1 migration) — this layer
 * exists so a caller gets an honest 404 instead of a silently empty result.
 */
import type { Participant, SenderKind } from "./message.entity";

/** The thread facts a decision needs — deliberately not the whole view. */
export interface ThreadIdentity {
  readonly id: string;
  readonly warehouseId: string;
}

/**
 * Which side of the conversation this member writes as.
 *
 * Keyed off the warehouse scope rather than the role string: a membership is
 * confined to one warehouse exactly when `warehouseId` is set, and that column
 * is what both the RLS policy and `InventoryService` already read.
 */
export function senderKindOf(participant: Participant): SenderKind {
  return participant.warehouseId === null ? "staff" : "vendor";
}

/** A participant already known to be confined to a warehouse. */
export interface VendorParticipant extends Participant {
  readonly warehouseId: string;
}

/**
 * True for a member confined to a single warehouse — i.e. a vendor. Narrows
 * the type as well, so callers reach `warehouseId` without a cast.
 */
export function isVendor(participant: Participant): participant is VendorParticipant {
  return participant.warehouseId !== null;
}

/**
 * Whether this member may read and write the given thread.
 *
 * Staff (unscoped) reach every thread in their company; a vendor reaches only
 * the thread of the warehouse they belong to. Tenancy is *not* re-checked
 * here: the caller has already resolved both the participant and the thread
 * inside one tenant transaction, so a thread from another company cannot
 * reach this function.
 */
export function canAccessThread(participant: Participant, thread: ThreadIdentity): boolean {
  if (participant.warehouseId === null) return true;
  return thread.warehouseId === participant.warehouseId;
}

/**
 * The preview stored on the thread after a message is posted — what the thread
 * list shows under the vendor's name.
 *
 * An image-only message has no text to preview, so it yields `null` and the
 * list falls back to its own placeholder rather than showing an empty line.
 * The cap matches `message_threads_preview_check` (200 characters); the ellipsis
 * is part of the budget, so a truncated preview never overflows the constraint.
 */
export function buildPreview(body: string | null): string | null {
  if (body === null) return null;
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length <= PREVIEW_MAX) return collapsed;
  return `${collapsed.slice(0, PREVIEW_MAX - 1)}…`;
}

/** Longest preview the `message_threads` CHECK constraint accepts. */
export const PREVIEW_MAX = 200;
