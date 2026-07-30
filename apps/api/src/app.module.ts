import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { TenancyModule } from "./modules/tenancy/tenancy.module";
import { AccessModule } from "./modules/access/access.module";
import { MasterDataModule } from "./modules/master-data/master-data.module";
import { ProductsModule } from "./modules/products/products.module";
import { AccessCoreModule } from "./shared/access/access.module";
import { ConfigModule } from "./shared/config/config.module";
import { AllExceptionsFilter } from "./shared/errors/all-exceptions.filter";
import { EventBusModule } from "./shared/events/event-bus.module";
import { LoggingModule } from "./shared/logging/logging.module";

/**
 * Root application module. Wires the global cross-cutting modules (config,
 * logging) and feature modules, and registers the unified exception filter
 * app-wide (as a provider so it can inject the logger).
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    EventBusModule,
    AccessCoreModule,
    HealthModule,
    AuthModule,
    TenancyModule,
    AccessModule,
    MasterDataModule,
    ProductsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
