import type { KeysetPage } from "@cadeau/database";
import type { ParsedNotificationListQuery } from "./list-query";
import type {
  NotificationPreferenceView,
  NotificationView,
  PushSubscriptionView,
} from "./notification.entity";
import type { NotificationType } from "./notification-types";

/** Input to create one in-app notification for a recipient (system-generated only). */
export interface CreateNotificationInput {
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly payload?: unknown;
}

export interface UpsertPreferenceInput {
  readonly type: NotificationType;
  readonly inAppEnabled: boolean;
  readonly webPushEnabled: boolean;
}

export interface RegisterSubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly userAgent?: string;
}

/**
 * Port for the notifications repository (EPIC-15). Every method is scoped to
 * one (company, recipient) pair — this is exclusively personal data; there is
 * no cross-user read in this module (D1).
 */
export interface NotificationsRepositoryPort {
  list(
    companyId: string,
    profileId: string,
    query: ParsedNotificationListQuery,
  ): Promise<KeysetPage<NotificationView>>;

  /** Marks the given ids read for this recipient. Foreign/already-read ids are silently skipped (D8). */
  markRead(
    companyId: string,
    profileId: string,
    ids: readonly string[],
  ): Promise<{ updated: number }>;

  create(
    companyId: string,
    profileId: string,
    input: CreateNotificationInput,
  ): Promise<NotificationView>;

  /** One row per {@link NOTIFICATION_TYPES} entry — defaults fill any missing row. */
  getPreferences(
    companyId: string,
    profileId: string,
  ): Promise<readonly NotificationPreferenceView[]>;

  /** Whether `channel` is enabled for `type` (defaults to enabled with no row). */
  isChannelEnabled(
    companyId: string,
    profileId: string,
    type: NotificationType,
    channel: "inApp" | "webPush",
  ): Promise<boolean>;

  upsertPreferences(
    companyId: string,
    profileId: string,
    updates: readonly UpsertPreferenceInput[],
  ): Promise<readonly NotificationPreferenceView[]>;

  listActiveSubscriptions(
    companyId: string,
    profileId: string,
  ): Promise<
    readonly {
      readonly id: string;
      readonly endpoint: string;
      readonly p256dh: string;
      readonly auth: string;
    }[]
  >;

  registerSubscription(
    companyId: string,
    profileId: string,
    input: RegisterSubscriptionInput,
  ): Promise<PushSubscriptionView>;

  /** Returns whether a row owned by this recipient was deleted. */
  deleteSubscription(companyId: string, profileId: string, id: string): Promise<boolean>;

  /** Deletes a subscription by id regardless of owner — used when a push endpoint reports itself gone. */
  deleteSubscriptionById(companyId: string, id: string): Promise<void>;
}

/** DI token for {@link NotificationsRepositoryPort}. */
export const NOTIFICATIONS_REPOSITORY = Symbol("NOTIFICATIONS_REPOSITORY");
