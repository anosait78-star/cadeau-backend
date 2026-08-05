import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AppLogger } from "../logging/app-logger";
import { runWithRequestContext } from "../logging/request-context";

const REQUEST_ID_HEADER = "x-request-id";
// Accept a client-supplied id only if it is a sane, bounded token; otherwise
// generate our own. This prevents header-injection / unbounded-length abuse.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Assigns every request a correlation id (honouring a safe inbound
 * `x-request-id`, else generating one), echoes it back on the response, binds
 * it into the async-local request context so all logs carry it, and logs a
 * single structured line when the response finishes.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLogger) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header(REQUEST_ID_HEADER);
    const requestId =
      inbound !== undefined && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`;
      // Server errors are logged as errors; everything else as info.
      if (res.statusCode >= 500) {
        this.logger.error(line, "HTTP");
      } else {
        this.logger.log(line, "HTTP");
      }
    });

    runWithRequestContext({ requestId }, () => next());
  }
}
