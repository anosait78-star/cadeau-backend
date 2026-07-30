import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { TenancyService } from "./application/tenancy.service";
import { TENANCY_AUDIT } from "./domain/tenancy-audit.port";
import { TENANCY_REPOSITORY } from "./domain/tenancy-repository.port";
import { LoggerTenancyAuditAdapter } from "./infrastructure/logger-tenancy-audit.adapter";
import { tenancyPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { TenancyRepository } from "./infrastructure/tenancy.repository";
import { TenancyController } from "./presentation/tenancy.controller";

/**
 * Tenancy feature module (composition root). Wires the controller → service →
 * ports and binds each port to its adapter. Token re-issue on create/switch is
 * consumed through the global `SESSION_REISSUE` contract (implemented by auth),
 * so there is no direct dependency on the auth feature module.
 */
@Module({
  controllers: [TenancyController],
  providers: [
    TenancyService,
    systemClockProvider,
    tenancyPrismaClientProvider,
    { provide: TENANCY_REPOSITORY, useClass: TenancyRepository },
    { provide: TENANCY_AUDIT, useClass: LoggerTenancyAuditAdapter },
  ],
})
export class TenancyModule {}
