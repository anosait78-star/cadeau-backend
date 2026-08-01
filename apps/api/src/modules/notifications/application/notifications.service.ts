import { Inject, Injectable } from "@nestjs/common";
import type { KeysetPage } from "@cadeau/database";
import { InvalidCursorError } from "@cadeau/database";
import type { RequestPrincipal } from "../../../shared/auth/authenticated-request";
import { AppErrors } from "../../../shared/errors/app-exception";
import { parseNotificationListQuery, type RawNotificationListQuery } from "../domain/list-query";
import { isNotificationType, NOTIFICATION_TYPES } from "../domain/notification-types";
import type {
  NotificationPreferenceView,
  NotificationView,
  PushSubscriptionView,
} from "../domain/notification.entity";
import {
  NOTIFICATIONS_REPOSITORY,
  type NotificationsRepositoryPort,
  type RegisterSubscriptionInput,
  type UpsertPreferenceInput,
} from "../domain/notifications-repository.port";

/** The caller's own list of notifications, keyset-paged. */
export type NotificationsListResult = KeysetPage<NotificationView>;

/**
 * Application service for the personal `/v1/notifications/*` endpoints
 * (EPIC-15 M15.2). Every method operates on the caller's own data only — the
 * `notifications` feature flag is the only gate (D1); there is no permission
 * check here, and no method takes a target user id.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATIONS_REPOSITORY) private readonly repo: NotificationsRepositoryPort,
  ) {}

  async list(
    principal: RequestPrincipal,
    raw: RawNotificationListQuery,
  ): Promise<NotificationsListResult> {
    const companyId = this.requireTenant(principal);
    const { query, errors } = parseNotificationListQuery(raw);
    if (query === undefined) throw AppErrors.validation("Invalid list query.", errors);
    try {
      return await this.repo.list(companyId, principal.userId, query);
    } catch (error) {
      if (error instanceof InvalidCursorError) throw AppErrors.badRequest("Invalid cursor.");
      throw error;
    }
  }

  async markRead(
    principal: RequestPrincipal,
    ids: readonly string[],
  ): Promise<{ updated: number }> {
    const companyId = this.requireTenant(principal);
    return this.repo.markRead(companyId, principal.userId, ids);
  }

  async getPreferences(
    principal: RequestPrincipal,
  ): Promise<readonly NotificationPreferenceView[]> {
    const companyId = this.requireTenant(principal);
    return this.repo.getPreferences(companyId, principal.userId);
  }

  async updatePreferences(
    principal: RequestPrincipal,
    updates: readonly { type: string; inAppEnabled: boolean; webPushEnabled: boolean }[],
  ): Promise<readonly NotificationPreferenceView[]> {
    const companyId = this.requireTenant(principal);
    const invalid = updates.filter((u) => !isNotificationType(u.type));
    if (invalid.length > 0) {
      throw AppErrors.validation("Invalid notification type.", [
        {
          field: "preferences",
          messages: [`type must be one of: ${NOTIFICATION_TYPES.join(", ")}`],
        },
      ]);
    }
    const parsed: UpsertPreferenceInput[] = updates.map((u) => ({
      type: u.type as UpsertPreferenceInput["type"],
      inAppEnabled: u.inAppEnabled,
      webPushEnabled: u.webPushEnabled,
    }));
    return this.repo.upsertPreferences(companyId, principal.userId, parsed);
  }

  async registerSubscription(
    principal: RequestPrincipal,
    input: RegisterSubscriptionInput,
  ): Promise<PushSubscriptionView> {
    const companyId = this.requireTenant(principal);
    return this.repo.registerSubscription(companyId, principal.userId, input);
  }

  async removeSubscription(principal: RequestPrincipal, id: string): Promise<void> {
    const companyId = this.requireTenant(principal);
    const deleted = await this.repo.deleteSubscription(companyId, principal.userId, id);
    if (!deleted) throw AppErrors.notFound("Push subscription not found.");
  }

  private requireTenant(principal: RequestPrincipal): string {
    if (principal.companyId === null) {
      throw AppErrors.forbidden("Select an active company first.");
    }
    return principal.companyId;
  }
}
