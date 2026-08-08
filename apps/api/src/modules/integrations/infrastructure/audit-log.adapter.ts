import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext } from "@cadeau/database";
import type { StorefrontAuditPort, StorefrontAuditRecord } from "../domain/storefront-audit.port";
import { INTEGRATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes storefront-integration changes to the durable, append-only
 * `audit_log` (EPIC-3). Mirrors `ShippingAuditLogAdapter` exactly.
 */
@Injectable()
export class StorefrontAuditLogAdapter implements StorefrontAuditPort {
  constructor(@Inject(INTEGRATIONS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async record(record: StorefrontAuditRecord): Promise<void> {
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
