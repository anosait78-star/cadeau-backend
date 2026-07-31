import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { getConfig } from "@cadeau/config";
import { AppModule } from "./app.module";
import { validationExceptionFactory } from "./shared/errors/validation";
import { RequestContextMiddleware } from "./shared/http/request-context.middleware";
import { AppLogger } from "./shared/logging/app-logger";
import { setupOpenApi } from "./shared/openapi/setup-openapi";

/**
 * Application entry point. Boots NestJS with the structured logger, correlation
 * middleware, global validation pipe (unified error envelope), CORS from config,
 * the `/v1` prefix, and OpenAPI. Configuration comes exclusively from
 * `@cadeau/config` (validated at startup; the process fails fast if invalid).
 */
async function bootstrap(): Promise<void> {
  // Buffer logs until our structured logger is installed, so early framework
  // logs are emitted through it too. `rawBody: true` additionally makes Nest
  // populate `req.rawBody` (a Buffer) alongside the normal parsed JSON body,
  // needed to verify an inbound carrier-webhook HMAC signature against the
  // exact bytes received (EPIC-12 M12.4) — a re-serialization of the parsed
  // body can byte-differ from what was actually signed.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const logger = app.get(AppLogger);
  app.useLogger(logger);

  const config = getConfig();

  // Correlation id + request context + access log, as global Express middleware.
  const requestContext = new RequestContextMiddleware(logger);
  app.use(requestContext.use.bind(requestContext));

  app.setGlobalPrefix("v1");

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.enableCors({
    origin: [...config.http.cors.allowedOrigins],
    credentials: config.http.cors.credentials,
  });

  app.enableShutdownHooks();
  setupOpenApi(app);

  await app.listen(config.http.port);
  logger.log(`API listening on ${config.http.url} (env=${config.env})`, "Bootstrap");
}

void bootstrap();
