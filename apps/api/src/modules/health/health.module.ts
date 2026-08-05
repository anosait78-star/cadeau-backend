import { Module } from "@nestjs/common";
import { HealthService } from "./application/health.service";
import { DATABASE_HEALTH_PORT } from "./domain/database-health.port";
import { DatabaseHealthAdapter } from "./infrastructure/database-health.adapter";
import { prismaHealthProbeProvider } from "./infrastructure/prisma-health-probe.provider";
import { HealthController } from "./presentation/health.controller";

/**
 * Health feature module (composition root). Wires the presentation controller to
 * the application service, and binds the {@link DATABASE_HEALTH_PORT} to its
 * infrastructure adapter.
 */
@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    prismaHealthProbeProvider,
    { provide: DATABASE_HEALTH_PORT, useClass: DatabaseHealthAdapter },
  ],
})
export class HealthModule {}
