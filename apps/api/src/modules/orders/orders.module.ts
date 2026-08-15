import { Global, Module } from "@nestjs/common";
import { ORDERS_INGESTION } from "../../shared/contracts/orders-ingestion.port";
import { systemClockProvider } from "../../shared/time/clock";
import { OrdersService } from "./application/orders.service";
import { ORDERS_AUDIT } from "./domain/orders-audit.port";
import { ORDERS_REPOSITORY } from "./domain/orders-repository.port";
import { OrdersAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { OrdersRepository } from "./infrastructure/orders.repository";
import { ordersPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { OrdersController } from "./presentation/orders.controller";
import { VendorOrderGroupsController } from "./presentation/vendor-order-groups.controller";

/**
 * Orders feature module (composition root, EPIC-11). Wires the service to the
 * Prisma repository (which owns order-number issuance, the feature-gated stock
 * side effects and the in-transaction customer-KPI recompute) and the durable
 * audit adapter. The three-layer resolver + guards come from the global
 * {@link AccessCoreModule}; the event bus from {@link EventBusModule}; the
 * {@link AccessResolverService} the service uses to feature-gate stock coupling
 * is likewise provided globally.
 *
 * Marked `@Global` so the {@link ORDERS_INGESTION} contract it implements is
 * available to sibling features (storefront-integration) without a direct
 * module import — features couple only through `shared/contracts`, same
 * pattern as {@link SessionReissuePort}/`AuthModule`.
 */
@Global()
@Module({
  controllers: [OrdersController, VendorOrderGroupsController],
  providers: [
    OrdersService,
    systemClockProvider,
    ordersPrismaClientProvider,
    { provide: ORDERS_REPOSITORY, useClass: OrdersRepository },
    { provide: ORDERS_AUDIT, useClass: OrdersAuditLogAdapter },
    { provide: ORDERS_INGESTION, useExisting: OrdersService },
  ],
  exports: [OrdersService, ORDERS_INGESTION],
})
export class OrdersModule {}
