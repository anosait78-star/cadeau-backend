import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@cadeau/database";
import { AuditLogAdapter } from "../../../shared/database/audit-log-adapter";
import type { FinanceAuditPort, FinanceAuditRecord } from "../domain/finance-audit.port";
import { FINANCE_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes finance changes to the durable, append-only `audit_log` (EPIC-3), one
 * tenant-scoped row per change. The company is bound as the active tenant so
 * the row passes the audit_log tenant INSERT policy. Only non-sensitive
 * identifiers and snapshots are recorded — never secrets.
 */
@Injectable()
export class FinanceAuditLogAdapter
  extends AuditLogAdapter<FinanceAuditRecord>
  implements FinanceAuditPort
{
  constructor(@Inject(FINANCE_PRISMA_CLIENT) prisma: PrismaClient) {
    super(prisma);
  }
}
