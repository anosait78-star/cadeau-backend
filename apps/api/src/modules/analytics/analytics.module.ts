import { Module } from "@nestjs/common";
import { systemClockProvider } from "../../shared/time/clock";
import { AnalyticsCache } from "./application/analytics-cache";
import { AnalyticsService } from "./application/analytics.service";
import { ANALYTICS_AUDIT } from "./domain/analytics-audit.port";
import { ANALYTICS_REPOSITORY } from "./domain/analytics-repository.port";
import { AnalyticsAuditLogAdapter } from "./infrastructure/audit-log.adapter";
import { AnalyticsRepository } from "./infrastructure/analytics.repository";
import { analyticsPrismaClientProvider } from "./infrastructure/prisma-client.provider";
import { AnalyticsController } from "./presentation/analytics.controller";

/**
 * Analytics feature module (composition root, EPIC-14). Wires the
 * `/v1/analytics` controller (five read-only axes + the audited CSV export)
 * to the shared service, the Prisma repository (read-only across
 * products/inventory/orders/finance tables), the in-process TTL cache
 * (`AnalyticsCache`, D2), and the durable audit adapter (D7). The
 * three-layer resolver + guards come from the global `AccessCoreModule`,
 * injected without an explicit import here, same as every other module.
 * Analytics emits no domain event, so `EventBusModule` is not needed.
 */
@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsCache,
    systemClockProvider,
    analyticsPrismaClientProvider,
    { provide: ANALYTICS_REPOSITORY, useClass: AnalyticsRepository },
    { provide: ANALYTICS_AUDIT, useClass: AnalyticsAuditLogAdapter },
  ],
})
export class AnalyticsModule {}
