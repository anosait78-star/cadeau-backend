import { Global, Module } from "@nestjs/common";
import { CUSTOMERS_DIRECTORY } from "../../shared/contracts/customers-directory.port";
import { systemClockProvider } from "../../shared/time/clock";
import { CustomersService } from "./application/customers.service";
import { CUSTOMERS_AUDIT } from "./domain/customers-audit.port";
import { CUSTOMERS_REPOSITORY } from "./domain/customers-repository.port";
import { CustomersAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { CustomersRepository } from "./infrastructure/customers.repository";
import { customersPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { CustomersController } from "./presentation/customers.controller";

/**
 * Customers feature module (composition root, EPIC-10). Wires the service to the
 * Prisma repository (which owns the PII round-trip) and the durable audit
 * adapter. The three-layer resolver + guards come from the global
 * {@link AccessCoreModule}; the event bus from {@link EventBusModule} — both
 * injected without an explicit import here.
 *
 * M10.3 adds the `/v1/customers` presentation surface: six customer routes plus
 * the three nested address routes, all three-layer gated.
 *
 * Marked `@Global` so the {@link CUSTOMERS_DIRECTORY} contract it implements
 * is available to sibling features (storefront-integration) without a direct
 * module import — features couple only through `shared/contracts`.
 */
@Global()
@Module({
  controllers: [CustomersController],
  providers: [
    CustomersService,
    systemClockProvider,
    customersPrismaClientProvider,
    { provide: CUSTOMERS_REPOSITORY, useClass: CustomersRepository },
    { provide: CUSTOMERS_AUDIT, useClass: CustomersAuditLogAdapter },
    { provide: CUSTOMERS_DIRECTORY, useExisting: CustomersService },
  ],
  exports: [CustomersService, CUSTOMERS_DIRECTORY],
})
export class CustomersModule {}
