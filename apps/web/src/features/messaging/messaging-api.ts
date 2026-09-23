import { apiFetch, apiFetchMultipart } from "@/lib/api-client";

/**
 * Client for `/v1/messaging` (EPIC-17). One conversation per vendor, between
 * that vendor and the company's staff. A vendor reaches only their own
 * thread; staff reach every thread — the same split the API enforces
 * server-side (RLS + the service layer), never just hidden here.
 */

export const SENDER_KINDS = ["vendor", "staff"] as const;
export type SenderKind = (typeof SENDER_KINDS)[number];

export const THREAD_STATUSES = ["open", "archived"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export interface MessageThread {
  readonly id: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly vendorMemberId: string;
  readonly status: ThreadStatus;
  readonly lastMessageAt: string | null;
  readonly lastMessagePreview: string | null;
  /** The caller's own unread count — two members looking at the same thread see different numbers. */
  readonly unreadCount: number;
  readonly createdAt: string;
}

export interface Attachment {
  readonly id: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  /** Expires shortly (15 min) — re-fetch the message for a fresh one, never cache this. */
  readonly url: string;
}

/**
 * An order a message points at. Number and status only — a vendor sees an
 * order solely through their own group in it, so the total (sums every
 * vendor's items) and the customer never travel with a mention.
 */
export interface OrderReference {
  readonly orderId: string;
  readonly orderNumber: string;
  /** `null` if the order no longer exists — the mention still renders, just with no status. */
  readonly status: string | null;
}

export interface MentionableOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface Message {
  readonly id: string;
  readonly threadId: string;
  readonly senderProfileId: string;
  readonly senderName: string | null;
  readonly senderKind: SenderKind;
  /** `null` once deleted, or for an image-only message. */
  readonly body: string | null;
  readonly attachments: readonly Attachment[];
  readonly orderRefs: readonly OrderReference[];
  readonly deletedAt: string | null;
  readonly createdAt: string;
}

/** A vendor the caller could start (or continue) a conversation with — staff only. */
export interface VendorWarehouse {
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly vendorMemberId: string;
  /** `null` until someone writes the first message. */
  readonly threadId: string | null;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

export interface ListOptions {
  readonly limit?: number;
  readonly cursor?: string;
}

function buildQuery(options: ListOptions): string {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

/** `GET /v1/messaging/threads` — every conversation the caller can see (a vendor sees only their own). */
export function listThreads(options: ListOptions = {}): Promise<Page<MessageThread>> {
  return apiFetch<Page<MessageThread>>(`/messaging/threads${buildQuery(options)}`);
}

/** `GET /v1/messaging/threads/me` — the calling vendor's own conversation, created on first open. */
export function getOwnThread(): Promise<MessageThread> {
  return apiFetch<MessageThread>("/messaging/threads/me");
}

/** `GET /v1/messaging/vendors` — staff-only picker of vendors to start/continue a conversation with. */
export function listVendors(): Promise<{ data: readonly VendorWarehouse[] }> {
  return apiFetch<{ data: readonly VendorWarehouse[] }>("/messaging/vendors");
}

/** `POST /v1/messaging/threads` — staff-only: open (get-or-create) the conversation with one vendor. */
export function openThread(warehouseId: string): Promise<MessageThread> {
  return apiFetch<MessageThread>("/messaging/threads", { method: "POST", body: { warehouseId } });
}

/** `GET /v1/messaging/threads/{id}/messages` — one page of a conversation, newest first. */
export function listMessages(threadId: string, options: ListOptions = {}): Promise<Page<Message>> {
  return apiFetch<Page<Message>>(`/messaging/threads/${threadId}/messages${buildQuery(options)}`);
}

/** What the composer submits when posting a message. */
export interface SendMessageInput {
  readonly body?: string;
  /** Ids from {@link uploadAttachment}. */
  readonly attachmentIds?: readonly string[];
  /** Orders this message points at — the `@` chips the composer collected. */
  readonly orderIds?: readonly string[];
}

/** `POST /v1/messaging/threads/{id}/messages` — post a message. */
export function sendMessage(threadId: string, input: SendMessageInput): Promise<Message> {
  return apiFetch<Message>(`/messaging/threads/${threadId}/messages`, {
    method: "POST",
    body: input,
  });
}

/** `GET /v1/messaging/threads/{id}/mentionable-orders` — the `@` picker's results. */
export function searchMentionableOrders(
  threadId: string,
  q: string | undefined,
): Promise<{ data: readonly MentionableOrder[] }> {
  const query = q !== undefined && q.length > 0 ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<{ data: readonly MentionableOrder[] }>(
    `/messaging/threads/${threadId}/mentionable-orders${query}`,
  );
}

/**
 * `POST /v1/messaging/attachments` — upload one image, to be attached to a
 * message afterwards by id. Multipart, field name `file` (matches the API's
 * `FileInterceptor("file")`).
 */
export function uploadAttachment(file: File): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  return apiFetchMultipart<Attachment>("/messaging/attachments", form);
}

/** `POST /v1/messaging/threads/{id}/read` — move the caller's own read cursor to now. */
export function markThreadRead(threadId: string): Promise<{ lastReadAt: string }> {
  return apiFetch<{ lastReadAt: string }>(`/messaging/threads/${threadId}/read`, {
    method: "POST",
  });
}
