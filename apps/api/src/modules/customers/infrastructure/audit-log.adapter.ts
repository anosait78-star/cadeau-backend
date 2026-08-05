import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, setTenantContext } from "@cadeau/database";
import type { CustomersAuditPort, CustomersAuditRecord } from "../domain/customers-audit.port";
import { CUSTOMERS_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes customer changes to the durable, append-only `audit_log` (EPIC-3), one
 * tenant-scoped row per change. The company is bound as the active tenant so the
 * row passes the audit_log tenant INSERT policy.
 *
 * Only identifiers and field *names* are recorded — never a phone, an email, a
 * name or an address line. `audit_log` is the one table platform admins read
 * across tenants, so personal data must not reach it (docs/privacy-model.md §6).
 */
@Injectable()
export class CustomersAuditLogAdapter implements CustomersAuditPort {
  constructor(@Inject(CUSTOMERS_PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async record(record: CustomersAuditRecord): Promise<void> {
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
