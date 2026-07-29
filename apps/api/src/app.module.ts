import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { HealthModule } from "./modules/health/health.module";
import { ConfigModule } from "./shared/config/config.module";
import { AllExceptionsFilter } from "./shared/errors/all-exceptions.filter";
import { LoggingModule } from "./shared/logging/logging.module";

/**
 * Root application module. Wires the global cross-cutting modules (config,
 * logging) and feature modules, and registers the unified exception filter
 * app-wide (as a provider so it can inject the logger).
 */
@Module({
  imports: [ConfigModule, LoggingModule, HealthModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
