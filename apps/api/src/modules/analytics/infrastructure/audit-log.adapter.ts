import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@cadeau/database";
import { AuditLogAdapter } from "../../../shared/database/audit-log-adapter";
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
export class AnalyticsAuditLogAdapter
  extends AuditLogAdapter<AnalyticsAuditRecord>
  implements AnalyticsAuditPort
{
  constructor(@Inject(ANALYTICS_PRISMA_CLIENT) prisma: PrismaClient) {
    super(prisma);
  }
}
