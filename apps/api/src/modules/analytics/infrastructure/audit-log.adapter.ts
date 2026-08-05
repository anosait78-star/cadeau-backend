import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext } from "@cadeau/database";
import type { AnalyticsAuditPort, AnalyticsAuditRecord } from "../domain/analytics-audit.port";
import { ANALYTICS_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes analytics exports to the durable, append-only `audit_log` (EPIC-3),
 * one tenant-scoped row per export. The company is bound as the active
 * tenant so the row passes the audit_log tenant INSERT policy. Only
 * non-sensitive identifiers and snapshots are recorded — never secrets.
 * Mirrors `FinanceAuditLogAdapter` exactly.
 */
@Injectable()
export class AnalyticsAuditLogAdapter implements AnalyticsAuditPort {
  constructor(@Inject(ANALYTICS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async record(record: AnalyticsAuditRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, record.companyId);
      await tx.auditLog.create({
        data: {
          companyId: record.companyId,
          actorId: record.actorId,
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
