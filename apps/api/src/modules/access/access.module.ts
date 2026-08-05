import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { AccessService } from "./application/access.service";
import { AdminService } from "./application/admin.service";
import { ACCESS_AUDIT } from "./domain/access-audit.port";
import { ACCESS_MANAGEMENT_REPOSITORY } from "./domain/access-management.port";
import { AccessManagementRepository } from "./infrastructure/access-management.repository";
import { AuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { accessModulePrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { AccessController } from "./presentation/access.controller";
import { AdminController } from "./presentation/admin.controller";

/**
 * Access feature module (composition root). Wires the caller-facing `/v1/access`
 * and Super-Admin `/v1/admin` controllers to their services, the management
 * repository, and the durable audit adapter. The central resolver, cache, and
 * guards come from the global {@link AccessCoreModule}, so they are injected
 * here without an explicit import.
 */
@Module({
  controllers: [AccessController, AdminController],
  providers: [
    AccessService,
    AdminService,
    systemClockProvider,
    accessModulePrismaClientProvider,
    { provide: ACCESS_MANAGEMENT_REPOSITORY, useClass: AccessManagementRepository },
    { provide: ACCESS_AUDIT, useClass: AuditLogAdapter },
  ],
})
export class AccessModule {}
