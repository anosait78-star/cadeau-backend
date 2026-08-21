import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@cadeau/database";
import { AuditLogAdapter } from "../../../shared/database/audit-log-adapter";
import type { ReviewsAuditPort, ReviewsAuditRecord } from "../domain/reviews-audit.port";
import { REVIEWS_PRISMA_CLIENT } from "./prisma-client.provider";

/**
 * Writes review writes to the durable, append-only `audit_log` (EPIC-3), one
 * tenant-scoped row per change. Only ids and field *names* are recorded —
 * never the gift recipient's PII (docs/privacy-model.md §6).
 */
@Injectable()
export class ReviewsAuditLogAdapter
  extends AuditLogAdapter<ReviewsAuditRecord>
  implements ReviewsAuditPort
{
  constructor(@Inject(REVIEWS_PRISMA_CLIENT) prisma: PrismaClient) {
    super(prisma);
  }
}
