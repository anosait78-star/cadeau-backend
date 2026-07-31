import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { CustomersService } from "./application/customers.service";
import { CUSTOMERS_AUDIT } from "./domain/customers-audit.port";
import { CUSTOMERS_REPOSITORY } from "./domain/customers-repository.port";
import { CustomersAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { CustomersRepository } from "./infrastructure/customers.repository";
import { customersPrismaClientProvider } from "./infrastructure/prisma-client.provider";

/**
 * Customers feature module (composition root, EPIC-10). Wires the service to the
 * Prisma repository (which owns the PII round-trip) and the durable audit
 * adapter. The three-layer resolver + guards come from the global
 * {@link AccessCoreModule}; the event bus from {@link EventBusModule} — both
 * injected without an explicit import here.
 *
 * **No controllers yet.** M10.2 delivers domain + application + infrastructure;
 * the `/v1/customers` surface and this module's registration in the app module
 * land in M10.3.
 */
@Module({
  providers: [
    CustomersService,
    systemClockProvider,
    customersPrismaClientProvider,
    { provide: CUSTOMERS_REPOSITORY, useClass: CustomersRepository },
    { provide: CUSTOMERS_AUDIT, useClass: CustomersAuditLogAdapter },
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
