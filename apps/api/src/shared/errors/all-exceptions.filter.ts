import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AppLogger } from "../logging/app-logger";
import { getRequestId } from "../logging/request-context";
import { codeForStatus, ERROR_CODES, type ErrorCode } from "./error-codes";

interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly statusCode: number;
    readonly requestId: string;
    readonly timestamp: string;
    readonly path: string;
    readonly details?: unknown;
  };
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Global exception filter: renders every thrown error into the one unified
 * envelope `{ error: { code, message, statusCode, requestId, timestamp, path,
 * details? } }`. It maps our {@link AppException}s and Nest's built-in HTTP
 * exceptions to stable codes, and collapses any unexpected error into a generic
 * 500 without leaking internals (the real error is logged, not returned).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const { status, code, message, details } = this.resolve(exception);

    const envelope: ErrorEnvelope = {
      error: {
        code,
        message,
        statusCode: status,
        requestId: getRequestId() ?? this.headerRequestId(res) ?? "unknown",
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
        ...(details !== undefined ? { details } : {}),
      },
    };

    this.logException(status, message, exception);
    res.status(status).json(envelope);
  }

  private resolve(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === "object" && response !== null) {
        const body = response as Record<string, unknown>;
        const code = isErrorCode(body["code"]) ? body["code"] : codeForStatus(status);
        const message = this.pickMessage(body["message"]) ?? exception.message;
        return resolved(status, code, message, body["details"]);
      }

      const message = typeof response === "string" ? response : exception.message;
      return resolved(status, codeForStatus(status), message, undefined);
    }

    // Unknown / non-HTTP error: never leak internals to the client.
    return resolved(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "INTERNAL",
      "Internal server error",
      undefined,
    );
  }

  private pickMessage(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(String).join("; ");
    return undefined;
  }

  private headerRequestId(res: Response): string | undefined {
    const value = res.getHeader("x-request-id");
    return typeof value === "string" ? value : undefined;
  }

  private logException(status: number, message: string, exception: unknown): void {
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Log the real error (with stack) for 5xx; the client only sees the generic envelope.
      this.logger.error(exception instanceof Error ? exception : message, undefined, "Exception");
    } else {
      this.logger.warn(`${status} ${message}`, "Exception");
    }
  }
}

/** Small helper to build the resolved-error tuple, omitting `details` when absent. */
function resolved(
  status: number,
  code: ErrorCode,
  message: string,
  detailsValue: unknown,
): { status: number; code: ErrorCode; message: string; details?: unknown } {
  return detailsValue !== undefined
    ? { status, code, message, details: detailsValue }
    : { status, code, message };
}
