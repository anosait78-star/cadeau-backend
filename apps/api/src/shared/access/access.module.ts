import { Global, Module } from "@nestjs/common";
import { systemClockProvider } from "../time/clock";
import { accessPrismaClientProvider } from "./access-prisma-client.provider";
import { AccessRepository, PlatformAdminRepository } from "./access.repository";
import { ACCESS_REPOSITORY, PLATFORM_ADMIN_REPOSITORY } from "./access-repository.port";
import { AccessResolverService } from "./access-resolver.service";
import { AccessGuard } from "./access.guard";
import { CapabilityCache } from "./capability-cache";
import { SuperAdminGuard } from "./super-admin.guard";

/**
 * Global access module (ADR-0003). Provides the central Access Resolver, its
 * cache, the read repositories, and the API guards, so any feature module can
 * `@UseGuards(JwtAuthGuard, AccessGuard)` with `@RequireCapability(...)` and the
 * admin surface can `@UseGuards(JwtAuthGuard, SuperAdminGuard)` without
 * importing this module explicitly. The resolver is the single server-side
 * authority for the three-layer check. The `access` feature module builds the
 * public endpoints on top of it.
 */
@Global()
@Module({
  providers: [
    systemClockProvider,
    accessPrismaClientProvider,
    CapabilityCache,
    AccessResolverService,
    AccessGuard,
    SuperAdminGuard,
    { provide: ACCESS_REPOSITORY, useClass: AccessRepository },
    { provide: PLATFORM_ADMIN_REPOSITORY, useClass: PlatformAdminRepository },
  ],
  exports: [
    CapabilityCache,
    AccessResolverService,
    AccessGuard,
    SuperAdminGuard,
    ACCESS_REPOSITORY,
    PLATFORM_ADMIN_REPOSITORY,
  ],
})
export class AccessCoreModule {}
