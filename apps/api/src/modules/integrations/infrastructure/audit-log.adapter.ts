import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@cadeau/database";
import { AuditLogAdapter } from "../../../shared/database/audit-log-adapter";
import type { StorefrontAuditPort, StorefrontAuditRecord } from "../domain/storefront-audit.port";
import { INTEGRATIONS_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes storefront-integration changes to the durable, append-only
 * `audit_log` (EPIC-3). Mirrors `ShippingAuditLogAdapter` exactly.
 */
@Injectable()
export class StorefrontAuditLogAdapter
  extends AuditLogAdapter<StorefrontAuditRecord>
  implements StorefrontAuditPort
{
  constructor(@Inject(INTEGRATIONS_PRISMA_CLIENT) prisma: PrismaClient) {
    super(prisma);
  }
}
