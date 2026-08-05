import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext } from "@cadeau/database";
import type { AccessAuditPort, AccessAuditRecord } from "../domain/access-audit.port";
import { ACCESS_MODULE_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes access changes to the durable, append-only `audit_log` (EPIC-3), one
 * tenant-scoped row per change. The target company is bound as the active tenant
 * so the row passes the audit_log tenant INSERT policy. Only non-sensitive
 * identifiers and before/after snapshots are recorded — never secrets.
 */
@Injectable()
export class AuditLogAdapter implements AccessAuditPort {
  constructor(@Inject(ACCESS_MODULE_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async record(record: AccessAuditRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, record.companyId);
      await tx.auditLog.create({
        data: {
          companyId: record.companyId,
          actorId: record.actorId,
          action: record.action,
          entityType: record.entityType,
          entityId: record.entityId ?? null,
          ...(record.changes === undefined
            ? {}
            : { changes: record.changes as Prisma.InputJsonValue }),
        },
      });
    });
  }
}
