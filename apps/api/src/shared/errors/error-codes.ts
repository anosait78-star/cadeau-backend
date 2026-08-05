import { HttpStatus } from "@nestjs/common";

/**
 * Stable, machine-readable error codes. Clients switch on `error.code` (never on
 * HTTP status alone or on human messages). New codes are added here; existing
 * ones are never repurposed.
 */
export const ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "CONFLICT",
  "UNPROCESSABLE_ENTITY",
  "TOO_MANY_REQUESTS",
  "INTERNAL",
  "SERVICE_UNAVAILABLE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Default code for an HTTP status that an exception did not label itself. */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "BAD_REQUEST";
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.METHOD_NOT_ALLOWED:
      return "METHOD_NOT_ALLOWED";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return "UNPROCESSABLE_ENTITY";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "TOO_MANY_REQUESTS";
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "SERVICE_UNAVAILABLE";
    default:
      return status >= 500 ? "INTERNAL" : "BAD_REQUEST";
  }
}
