import { HttpException, HttpStatus } from "@nestjs/common";
import type { ErrorCode } from "./error-codes";

/** The payload an {@link AppException} carries inside the Nest HttpException. */
export interface AppExceptionPayload {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

/**
 * Base application exception. Every domain/HTTP error we raise deliberately
 * should be (a subclass of) this, so it carries a stable {@link ErrorCode} and
 * a client-safe message. The global exception filter renders it into the unified
 * error envelope. Throwing raw `HttpException`s still works — the filter maps
 * their status to a default code — but prefer this for intentional errors.
 */
export class AppException extends HttpException {
  constructor(status: HttpStatus, code: ErrorCode, message: string, details?: unknown) {
    const payload: AppExceptionPayload =
      details !== undefined ? { code, message, details } : { code, message };
    super(payload, status);
  }
}

/** Convenience factories for the common cases. */
export const AppErrors = {
  badRequest: (message: string, details?: unknown) =>
    new AppException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", message, details),
  validation: (message: string, details?: unknown) =>
    new AppException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, details),
  unauthorized: (message = "Unauthorized") =>
    new AppException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message),
  forbidden: (message = "Forbidden") =>
    new AppException(HttpStatus.FORBIDDEN, "FORBIDDEN", message),
  notFound: (message = "Not found") => new AppException(HttpStatus.NOT_FOUND, "NOT_FOUND", message),
  conflict: (message: string, details?: unknown) =>
    new AppException(HttpStatus.CONFLICT, "CONFLICT", message, details),
  unprocessable: (message: string, details?: unknown) =>
    new AppException(HttpStatus.UNPROCESSABLE_ENTITY, "UNPROCESSABLE_ENTITY", message, details),
  serviceUnavailable: (message = "Service temporarily unavailable") =>
    new AppException(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", message),
} as const;
