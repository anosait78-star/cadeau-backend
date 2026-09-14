import { apiFetch } from "@/lib/api-client";

/** The closed set of notification types EPIC-15 produces (matches the backend whitelist). */
export type NotificationType =
  /** A new order landed in the company (owners, `orders.manage` holders, assignee). */
  | "order.created"
  | "order.status_changed"
  | "payment.collected"
  /** Vendor Accounts, Phase 5 — sent to a vendor when their group is assigned. */
  | "order_vendor_group.assigned";

export interface NotificationItem {
  readonly id: string;
  readonly type: NotificationType;
  /**
   * The server-written fallback line. Single-language by construction (it is
   * what Web Push shows) — render notifications with `notificationText()`
   * instead of reading these two directly, so the reader sees their own
   * language.
   */
  readonly title: string;
  readonly body: string;
  /** Structured facts (customer, order number, amounts) the client renders from. */
  readonly payload: unknown;
  readonly readAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A keyset page of notifications (api-conventions §5). */
export interface NotificationListPage {
  readonly data: readonly NotificationItem[];
  readonly page: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

export interface NotificationListOptions {
  readonly limit?: number;
  readonly cursor?: string;
  readonly type?: NotificationType;
  readonly read?: boolean;
}

function buildQuery(options: NotificationListOptions): string {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  if (options.type !== undefined) params.set("type", options.type);
  if (options.read !== undefined) params.set("read", String(options.read));
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

/** `GET /v1/notifications` — the caller's own notifications, keyset-paged. */
export function listNotifications(
  options: NotificationListOptions = {},
): Promise<NotificationListPage> {
  return apiFetch<NotificationListPage>(`/notifications${buildQuery(options)}`);
}

/** `POST /v1/notifications/read` — mark one or many of the caller's own notifications read. */
export function markNotificationsRead(ids: readonly string[]): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>("/notifications/read", { method: "POST", body: { ids } });
}

export interface NotificationPreference {
  readonly type: NotificationType;
  readonly inAppEnabled: boolean;
  readonly webPushEnabled: boolean;
}

/** `GET /v1/notifications/preferences` — the caller's own channel preferences. */
export function getNotificationPreferences(): Promise<{ data: readonly NotificationPreference[] }> {
  return apiFetch<{ data: readonly NotificationPreference[] }>("/notifications/preferences");
}

/** `PUT /v1/notifications/preferences` — update the caller's own channel preferences. */
export function updateNotificationPreferences(
  preferences: readonly NotificationPreference[],
): Promise<{ data: readonly NotificationPreference[] }> {
  return apiFetch<{ data: readonly NotificationPreference[] }>("/notifications/preferences", {
    method: "PUT",
    body: { preferences },
  });
}

/** A registered Web Push endpoint, as the server stores it. */
export interface PushSubscriptionRecord {
  readonly id: string;
  readonly endpoint: string;
  readonly userAgent: string | null;
  readonly createdAt: string;
}

/** The body `POST /v1/notifications/push/subscriptions` expects. */
export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly userAgent?: string;
}

/**
 * `GET /v1/notifications/push/key` — the server's VAPID public key.
 *
 * Public by design: RFC 8292 has the browser embed this key in the
 * subscription it creates. Only the private half, which stays on the server,
 * can sign a message.
 */
export function getVapidPublicKey(): Promise<{ publicKey: string }> {
  return apiFetch<{ publicKey: string }>("/notifications/push/key");
}

/** `POST /v1/notifications/push/subscriptions` — register this device's endpoint. */
export function registerPushSubscription(
  input: PushSubscriptionInput,
): Promise<PushSubscriptionRecord> {
  return apiFetch<PushSubscriptionRecord>("/notifications/push/subscriptions", {
    method: "POST",
    body: input,
  });
}

/** `DELETE /v1/notifications/push/subscriptions/{id}` — forget one device's endpoint. */
export function removePushSubscription(id: string): Promise<void> {
  return apiFetch<void>(`/notifications/push/subscriptions/${id}`, { method: "DELETE" });
}
