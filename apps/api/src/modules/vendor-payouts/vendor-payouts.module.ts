import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { VENDOR_PAYOUTS_AUDIT } from "./domain/vendor-payouts-audit.port";
import { VENDOR_PAYOUTS_REPOSITORY } from "./domain/vendor-payouts-repository.port";
import { VendorPayoutsService } from "./application/vendor-payouts.service";
import { VendorPayoutsAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { vendorPayoutsPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { VendorPayoutsRepository } from "./infrastructure/vendor-payouts.repository";
import { VendorAccountController } from "./presentation/vendor-account.controller";
import { VendorPayoutsController } from "./presentation/vendor-payouts.controller";

/**
 * Vendor payouts (composition root, 2026-11-17): each vendor's ledger, payout
 * requests, and their confirmation. Reads the shared `warehouses` /
 * `company_members` tables and owns `vendor_ledger_entries` /
 * `vendor_payouts` under its own Prisma client — never an import from another
 * module. Accruals themselves are written by the orders module inside the
 * order's own status transition (so a delivered order and what it owes commit
 * together). Access guards come from the global `AccessCoreModule`; the event
 * bus from the global `EventBusModule`.
 */
@Module({
  controllers: [VendorPayoutsController, VendorAccountController],
  providers: [
    VendorPayoutsService,
    // `JwtAuthGuard` and `RateLimitGuard` inject CLOCK, so the module provides it.
    systemClockProvider,
    vendorPayoutsPrismaClientProvider,
    { provide: VENDOR_PAYOUTS_REPOSITORY, useClass: VendorPayoutsRepository },
    { provide: VENDOR_PAYOUTS_AUDIT, useClass: VendorPayoutsAuditLogAdapter },
  ],
})
export class VendorPayoutsModule {}
