import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@cadeau/database";
import { AuditLogAdapter } from "../../../shared/database/audit-log-adapter";
import type {
  VendorPayoutsAuditPort,
  VendorPayoutsAuditRecord,
} from "../domain/vendor-payouts-audit.port";
import { VENDOR_PAYOUTS_PRISMA_CLIENT } from "./prisma-client.provider";

/** Writes vendor-payouts writes to the durable, append-only `audit_log`. */
@Injectable()
export class VendorPayoutsAuditLogAdapter
  extends AuditLogAdapter<VendorPayoutsAuditRecord>
  implements VendorPayoutsAuditPort
{
  constructor(@Inject(VENDOR_PAYOUTS_PRISMA_CLIENT) prisma: PrismaClient) {
    super(prisma);
  }
}
