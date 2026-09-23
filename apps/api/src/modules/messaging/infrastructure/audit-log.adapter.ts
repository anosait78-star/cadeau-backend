import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@cadeau/database";
import { AuditLogAdapter } from "../../../shared/database/audit-log-adapter";
import type { MessagingAuditPort, MessagingAuditRecord } from "../domain/messaging-audit.port";
import { MESSAGING_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes messaging writes to the durable, append-only `audit_log` (EPIC-3),
 * one tenant-scoped row per change. Only ids, counts and lengths are recorded
 * — never a message body, which is free text a sender may have pasted customer
 * details into (docs/privacy-model.md §6).
 */
@Injectable()
export class MessagingAuditLogAdapter
  extends AuditLogAdapter<MessagingAuditRecord>
  implements MessagingAuditPort
{
  constructor(@Inject(MESSAGING_PRISMA_CLIENT) prisma: PrismaClient) {
    super(prisma);
  }
}
