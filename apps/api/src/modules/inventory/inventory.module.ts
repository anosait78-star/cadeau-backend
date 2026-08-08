import { Global, Module } from "@nestjs/common";
import { INVENTORY_ADJUSTMENT } from "../../shared/contracts/inventory-adjustment.port";
import { systemClockProvider } from "../../shared/time/clock";
import { InventoryService } from "./application/inventory.service";
import { INVENTORY_AUDIT } from "./domain/inventory-audit.port";
import { INVENTORY_REPOSITORY } from "./domain/inventory-repository.port";
import { InventoryAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { InventoryRepository } from "./infrastructure/inventory.repository";
import { inventoryPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { InventoryController } from "./presentation/inventory.controller";
import { WarehousesController } from "./presentation/warehouses.controller";

/**
 * Inventory feature module (composition root, EPIC-9). Wires the
 * `/v1/warehouses` and `/v1/inventory` controllers to their service, the Prisma
 * repository (which owns the atomic stock writes), and the durable audit
 * adapter. The three-layer resolver + guards come from the global
 * {@link AccessCoreModule}; the event bus from {@link EventBusModule} — both
 * injected without an explicit import here.
 *
 * Marked `@Global` so the {@link INVENTORY_ADJUSTMENT} contract it implements
 * is available to sibling features (storefront-integration) without a direct
 * module import — features couple only through `shared/contracts`.
 */
@Global()
@Module({
  controllers: [WarehousesController, InventoryController],
  providers: [
    InventoryService,
    systemClockProvider,
    inventoryPrismaClientProvider,
    { provide: INVENTORY_REPOSITORY, useClass: InventoryRepository },
    { provide: INVENTORY_AUDIT, useClass: InventoryAuditLogAdapter },
    { provide: INVENTORY_ADJUSTMENT, useExisting: InventoryService },
  ],
  exports: [InventoryService, INVENTORY_ADJUSTMENT],
})
export class InventoryModule {}
