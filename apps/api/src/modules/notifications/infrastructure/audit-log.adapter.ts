import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext } from "@cadeau/database";
import type {
  NotificationsAuditPort,
  NotificationsAuditRecord,
} from "../domain/notifications-audit.port";
import { NOTIFICATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes notification creations to the durable, append-only `audit_log`
 * (EPIC-3), one tenant-scoped row per notification. System-originated
 * (`actorId` is always `null`). Only ids and field names are recorded — never
 * customer PII (docs/privacy-model.md §6).
 */
@Injectable()
export class NotificationsAuditLogAdapter implements NotificationsAuditPort {
  constructor(@Inject(NOTIFICATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async record(record: NotificationsAuditRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, record.companyId);
      await tx.auditLog.create({
        data: {
          companyId: record.companyId,
          actorId: null,
          action: record.action,
          entityType: record.entityType,
          entityId: record.entityId,
          ...(record.changes === undefined
            ? {}
            : { changes: record.changes as Prisma.InputJsonValue }),
        },
      });
    });
  }
}
