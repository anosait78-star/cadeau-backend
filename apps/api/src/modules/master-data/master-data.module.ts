import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { MasterDataCache } from "./application/master-data-cache";
import { MasterDataService } from "./application/master-data.service";
import { MASTER_DATA_AUDIT } from "./domain/master-data-audit.port";
import { MASTER_DATA_REPOSITORY } from "./domain/master-data-repository.port";
import { MasterDataAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { MasterDataRepository } from "./infrastructure/master-data.repository";
import { masterDataPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { MasterDataController } from "./presentation/master-data.controller";

/**
 * Master-data feature module (composition root, EPIC-7). Wires the generic
 * `/v1/master-data` controller to its service, the reference cache, the generic
 * Prisma repository, and the durable audit adapter. The three-layer resolver +
 * guards come from the global {@link AccessCoreModule}; the event bus from
 * {@link EventBusModule} — both injected without an explicit import here.
 */
@Module({
  controllers: [MasterDataController],
  providers: [
    MasterDataService,
    MasterDataCache,
    systemClockProvider,
    masterDataPrismaClientProvider,
    { provide: MASTER_DATA_REPOSITORY, useClass: MasterDataRepository },
    { provide: MASTER_DATA_AUDIT, useClass: MasterDataAuditLogAdapter },
  ],
})
export class MasterDataModule {}
