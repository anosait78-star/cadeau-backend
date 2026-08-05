import type { NotificationType } from "./notification-types";

/** One in-app notification, as returned to its recipient. */
export interface NotificationView {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly payload: unknown;
  readonly readAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A recipient's per-type channel preference (defaults apply when no row exists). */
export interface NotificationPreferenceView {
  readonly type: NotificationType;
  readonly inAppEnabled: boolean;
  readonly webPushEnabled: boolean;
}

/** A registered Web Push endpoint, as returned to its owner. */
export interface PushSubscriptionView {
  readonly id: string;
  readonly endpoint: string;
  readonly userAgent: string | null;
  readonly createdAt: string;
}
