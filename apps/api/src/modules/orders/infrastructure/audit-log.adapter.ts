import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@cadeau/database";
import { AuditLogAdapter } from "../../../shared/database/audit-log-adapter";
import type { OrdersAuditPort, OrdersAuditRecord } from "../domain/orders-audit.port";
import { ORDERS_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes order changes to the durable, append-only `audit_log` (EPIC-3), one
 * tenant-scoped row per change. The company is bound as the active tenant so the
 * row passes the audit_log tenant INSERT policy. Only ids and field *names* are
 * recorded — never customer PII (docs/privacy-model.md §6).
 */
@Injectable()
export class OrdersAuditLogAdapter
  extends AuditLogAdapter<OrdersAuditRecord>
  implements OrdersAuditPort
{
  constructor(@Inject(ORDERS_PRISMA_CLIENT) prisma: PrismaClient) {
    super(prisma);
  }
}
