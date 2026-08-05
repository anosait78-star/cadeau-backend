import { Inject, Injectable } from "@nestjs/common";
import {
  buildKeysetPage,
  clampLimit,
  decodeCursor,
  InvalidCursorError,
  Prisma,
  type CursorValues,
  type KeysetPage,
  type PrismaClient,
  setTenantContext,
} from "@cadeau/database";
import type { ParsedNotificationListQuery } from "../domain/list-query";
import { NOTIFICATION_TYPES, type NotificationType } from "../domain/notification-types";
import type {
  NotificationPreferenceView,
  NotificationView,
  PushSubscriptionView,
} from "../domain/notification.entity";
import type {
  CreateNotificationInput,
  NotificationsRepositoryPort,
  RegisterSubscriptionInput,
  UpsertPreferenceInput,
} from "../domain/notifications-repository.port";
import { NOTIFICATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

type Tx = Prisma.TransactionClient;

interface DecodedCursor {
  readonly p: string;
  readonly t: string;
}

/**
 * Prisma-backed notifications repository (EPIC-15). Every method is
 * tenant-bound (`setTenantContext`) **and** scoped to the caller's own
 * `profileId` — personal data has no cross-user read in this module (D1).
 */
@Injectable()
export class NotificationsRepository implements NotificationsRepositoryPort {
  constructor(@Inject(NOTIFICATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async list(
    companyId: string,
    profileId: string,
    query: ParsedNotificationListQuery,
  ): Promise<KeysetPage<NotificationView>> {
    const limit = clampLimit(query.limit);
    const cursor = this.decode(query.cursor);
    const where: Prisma.NotificationWhereInput = { companyId, profileId };
    if (query.type !== undefined) where.type = query.type;
    if (query.read !== undefined) where.readAt = query.read ? { not: null } : null;
    if (query.createdAtFrom !== undefined || query.createdAtTo !== undefined) {
      where.createdAt = {
        ...(query.createdAtFrom !== undefined ? { gte: new Date(query.createdAtFrom) } : {}),
        ...(query.createdAtTo !== undefined ? { lte: new Date(query.createdAtTo) } : {}),
      };
    }
    if (cursor !== null) {
      where.AND = [
        {
          OR: [
            { createdAt: { lt: new Date(cursor.p) } },
            { AND: [{ createdAt: new Date(cursor.p) }, { id: { lt: cursor.t } }] },
          ],
        },
      ];
    }

    const rows = await this.tenantTx(companyId, (tx) =>
      tx.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      }),
    );
    const views = rows.map((r) => this.toView(r));
    return buildKeysetPage(
      views,
      limit,
      (view): CursorValues => ({ p: view.createdAt, t: view.id }),
    );
  }

  async markRead(
    companyId: string,
    profileId: string,
    ids: readonly string[],
  ): Promise<{ updated: number }> {
    if (ids.length === 0) return { updated: 0 };
    const result = await this.tenantTx(companyId, (tx) =>
      tx.notification.updateMany({
        where: { companyId, profileId, id: { in: [...ids] }, readAt: null },
        data: { readAt: new Date() },
      }),
    );
    return { updated: result.count };
  }

  async create(
    companyId: string,
    profileId: string,
    input: CreateNotificationInput,
  ): Promise<NotificationView> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.notification.create({
        data: {
          companyId,
          profileId,
          type: input.type,
          title: input.title,
          body: input.body,
          ...(input.payload !== undefined
            ? { payload: input.payload as Prisma.InputJsonValue }
            : {}),
        } as Prisma.NotificationUncheckedCreateInput,
      }),
    );
    return this.toView(row);
  }

  async getPreferences(
    companyId: string,
    profileId: string,
  ): Promise<readonly NotificationPreferenceView[]> {
    const rows = await this.tenantTx(companyId, (tx) =>
      tx.notificationPreference.findMany({ where: { companyId, profileId } }),
    );
    const byType = new Map(rows.map((r) => [r.type, r]));
    return NOTIFICATION_TYPES.map((type) => {
      const row = byType.get(type);
      return {
        type,
        inAppEnabled: row?.inAppEnabled ?? true,
        webPushEnabled: row?.webPushEnabled ?? true,
      };
    });
  }

  async isChannelEnabled(
    companyId: string,
    profileId: string,
    type: NotificationType,
    channel: "inApp" | "webPush",
  ): Promise<boolean> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.notificationPreference.findFirst({ where: { companyId, profileId, type } }),
    );
    if (row === null) return true;
    return channel === "inApp" ? row.inAppEnabled : row.webPushEnabled;
  }

  async upsertPreferences(
    companyId: string,
    profileId: string,
    updates: readonly UpsertPreferenceInput[],
  ): Promise<readonly NotificationPreferenceView[]> {
    await this.tenantTx(companyId, async (tx) => {
      for (const update of updates) {
        await tx.notificationPreference.upsert({
          where: {
            companyId_profileId_type: { companyId, profileId, type: update.type },
          },
          create: {
            companyId,
            profileId,
            type: update.type,
            inAppEnabled: update.inAppEnabled,
            webPushEnabled: update.webPushEnabled,
            createdBy: profileId,
            updatedBy: profileId,
          },
          update: {
            inAppEnabled: update.inAppEnabled,
            webPushEnabled: update.webPushEnabled,
            updatedBy: profileId,
          },
        });
      }
    });
    return this.getPreferences(companyId, profileId);
  }

  async listActiveSubscriptions(
    companyId: string,
    profileId: string,
  ): Promise<
    readonly {
      readonly id: string;
      readonly endpoint: string;
      readonly p256dh: string;
      readonly auth: string;
    }[]
  > {
    return this.tenantTx(companyId, (tx) =>
      tx.pushSubscription.findMany({
        where: { companyId, profileId },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      }),
    );
  }

  async registerSubscription(
    companyId: string,
    profileId: string,
    input: RegisterSubscriptionInput,
  ): Promise<PushSubscriptionView> {
    const row = await this.tenantTx(companyId, (tx) =>
      tx.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          companyId,
          profileId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
        },
        update: {
          companyId,
          profileId,
          p256dh: input.p256dh,
          auth: input.auth,
          ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
        },
      }),
    );
    return {
      id: row.id,
      endpoint: row.endpoint,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async deleteSubscription(companyId: string, profileId: string, id: string): Promise<boolean> {
    const result = await this.tenantTx(companyId, (tx) =>
      tx.pushSubscription.deleteMany({ where: { companyId, profileId, id } }),
    );
    return result.count > 0;
  }

  async deleteSubscriptionById(companyId: string, id: string): Promise<void> {
    await this.tenantTx(companyId, (tx) =>
      tx.pushSubscription.deleteMany({ where: { companyId, id } }),
    );
  }

  private toView(row: {
    id: string;
    type: string;
    title: string;
    body: string;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): NotificationView {
    return {
      id: row.id,
      type: row.type as NotificationType,
      title: row.title,
      body: row.body,
      payload: row.payload,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private decode(raw: string | undefined): DecodedCursor | null {
    if (raw === undefined) return null;
    const decoded = decodeCursor(raw);
    const p = decoded["p"];
    const t = decoded["t"];
    if (typeof p !== "string" || typeof t !== "string" || Number.isNaN(Date.parse(p))) {
      throw new InvalidCursorError();
    }
    return { p, t };
  }

  private tenantTx<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }
}
