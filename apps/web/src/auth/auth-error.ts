import { ApiError } from "@/lib/api-client";
import type { TranslationKey } from "@/i18n/dictionaries";

/** Where the error was raised, so the same code can read differently per screen. */
type AuthErrorContext = "login" | "register" | "twoFactor";

/**
 * Map a thrown error to a client-safe, localized message key. Switches on the
 * stable `error.code` (never the HTTP status or human message), so wording is
 * consistent and never leaks server internals.
 */
export function authErrorKey(error: unknown, context: AuthErrorContext): TranslationKey {
  if (!(error instanceof ApiError)) {
    return "auth.error.generic";
  }
  switch (error.code) {
    case "UNAUTHORIZED":
      return context === "twoFactor" ? "auth.error.invalidCode" : "auth.error.invalidCredentials";
    case "CONFLICT":
      return "auth.error.emailTaken";
    case "VALIDATION_FAILED":
    case "BAD_REQUEST":
    case "UNPROCESSABLE_ENTITY":
      return "auth.error.validation";
    case "TOO_MANY_REQUESTS":
      return "auth.error.rateLimited";
    default:
      return "auth.error.generic";
  }
}
