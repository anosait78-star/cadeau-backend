import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { FinanceService } from "./application/finance.service";
import { FINANCE_AUDIT } from "./domain/finance-audit.port";
import { FINANCE_REPOSITORY } from "./domain/finance-repository.port";
import { FinanceAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { FinanceRepository } from "./infrastructure/finance.repository";
import { financePrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { ExpensesController } from "./presentation/expenses.controller";
import { InvoicesController } from "./presentation/invoices.controller";
import { PurchaseOrdersController } from "./presentation/purchase-orders.controller";
import { RefundsController } from "./presentation/refunds.controller";
import { SuppliersController } from "./presentation/suppliers.controller";
import { TaxSettingsController } from "./presentation/tax-settings.controller";

/**
 * Finance feature module (composition root, EPIC-13 — M13.2 suppliers +
 * purchase orders, M13.3 expenses + tax settings, M13.4 invoices + refunds).
 * Wires the `/v1/finance/suppliers`, `/v1/finance/purchase-orders`,
 * `/v1/finance/expenses`, `/v1/finance/tax-settings`, `/v1/finance/invoices`,
 * and `/v1/finance/refunds` controllers to their shared service, the Prisma
 * repository (which owns PO/invoice-number issuance, the atomic receipt, and
 * the D4 period-close write guard), and the durable audit adapter. The
 * three-layer resolver + guards come from the global {@link AccessCoreModule};
 * the event bus from {@link EventBusModule} — both injected without an
 * explicit import here.
 */
@Module({
  controllers: [
    SuppliersController,
    PurchaseOrdersController,
    ExpensesController,
    TaxSettingsController,
    InvoicesController,
    RefundsController,
  ],
  providers: [
    FinanceService,
    systemClockProvider,
    financePrismaClientProvider,
    { provide: FINANCE_REPOSITORY, useClass: FinanceRepository },
    { provide: FINANCE_AUDIT, useClass: FinanceAuditLogAdapter },
  ],
})
export class FinanceModule {}
