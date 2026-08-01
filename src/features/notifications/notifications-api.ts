import { apiFetch } from "@/lib/api-client";

/** The closed set of notification types EPIC-15 produces (matches the backend whitelist). */
export type NotificationType = "order.status_changed" | "payment.collected";

export interface NotificationItem {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
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
