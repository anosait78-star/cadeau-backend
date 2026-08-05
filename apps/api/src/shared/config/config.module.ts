import { Global, Module } from "@nestjs/common";
import { getConfig } from "@cadeau/config";
import { APP_CONFIG } from "./config.tokens";

/**
 * Global configuration module. Provides the validated {@link AppConfig} under
 * the {@link APP_CONFIG} token so any provider can inject it. Loading is
 * delegated to `@cadeau/config` (schema-validated, cached singleton); if the
 * environment is invalid the process fails fast here, at startup.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => getConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
