import { Global, Module } from "@nestjs/common";
import { AppLogger } from "./app-logger";

/**
 * Global logging module. Exposes the structured {@link AppLogger} for injection
 * and as the application-wide Nest logger (wired in `main.ts` via `useLogger`).
 */
@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggingModule {}
