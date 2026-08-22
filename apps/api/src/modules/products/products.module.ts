import { Global, Module } from "@nestjs/common";
import { PRODUCTS_CATALOG } from "../../shared/contracts/products-catalog.port";
import { systemClockProvider } from "../../shared/time/clock";
import { ProductsService } from "./application/products.service";
import { PRODUCTS_AUDIT } from "./domain/products-audit.port";
import { PRODUCTS_REPOSITORY } from "./domain/products-repository.port";
import { ProductsAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { productsPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { ProductsRepository } from "./infrastructure/products.repository";
import { ProductsController } from "./presentation/products.controller";
import { VendorProductsController } from "./presentation/vendor-products.controller";

/**
 * Products feature module (composition root, EPIC-8). Wires the `/v1/products`
 * controller to its service, the Prisma repository, and the durable audit
 * adapter. The three-layer resolver + guards come from the global
 * {@link AccessCoreModule}; the event bus from {@link EventBusModule} — both
 * injected without an explicit import here.
 *
 * Marked `@Global` so the {@link PRODUCTS_CATALOG} contract it implements is
 * available to sibling features (storefront-integration) without a direct
 * module import — features couple only through `shared/contracts`.
 */
@Global()
@Module({
  controllers: [ProductsController, VendorProductsController],
  providers: [
    ProductsService,
    systemClockProvider,
    productsPrismaClientProvider,
    { provide: PRODUCTS_REPOSITORY, useClass: ProductsRepository },
    { provide: PRODUCTS_AUDIT, useClass: ProductsAuditLogAdapter },
    { provide: PRODUCTS_CATALOG, useExisting: ProductsService },
  ],
  exports: [ProductsService, PRODUCTS_CATALOG],
})
export class ProductsModule {}
