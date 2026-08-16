import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@cadeau/database";
import { AuditLogAdapter } from "../../../shared/database/audit-log-adapter";
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
export class CustomersAuditLogAdapter
  extends AuditLogAdapter<CustomersAuditRecord>
  implements CustomersAuditPort
{
  constructor(@Inject(CUSTOMERS_PRISMA_CLIENT) prisma: PrismaClient) {
    super(prisma);
  }
}
