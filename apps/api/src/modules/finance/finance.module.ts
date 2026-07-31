import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { FinanceService } from "./application/finance.service";
import { FINANCE_AUDIT } from "./domain/finance-audit.port";
import { FINANCE_REPOSITORY } from "./domain/finance-repository.port";
import { FinanceAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { FinanceRepository } from "./infrastructure/finance.repository";
import { financePrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { PurchaseOrdersController } from "./presentation/purchase-orders.controller";
import { SuppliersController } from "./presentation/suppliers.controller";

/**
 * Finance feature module (composition root, EPIC-13, M13.2). Wires the
 * `/v1/finance/suppliers` and `/v1/finance/purchase-orders` controllers to
 * their shared service, the Prisma repository (which owns PO-number issuance
 * and the atomic receipt), and the durable audit adapter. The three-layer
 * resolver + guards come from the global {@link AccessCoreModule}; the event
 * bus from {@link EventBusModule} — both injected without an explicit import
 * here.
 */
@Module({
  controllers: [SuppliersController, PurchaseOrdersController],
  providers: [
    FinanceService,
    systemClockProvider,
    financePrismaClientProvider,
    { provide: FINANCE_REPOSITORY, useClass: FinanceRepository },
    { provide: FINANCE_AUDIT, useClass: FinanceAuditLogAdapter },
  ],
})
export class FinanceModule {}
