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

/** Map a thrown error from the change-password form to a localized message key. */
export function changePasswordErrorKey(error: unknown): TranslationKey {
  if (error instanceof ApiError && error.code === "BAD_REQUEST") {
    return "settings.security.wrongPassword";
  }
  return "settings.security.changeFailed";
}

/**
 * Map a thrown error from company creation/joining to a client-safe, localized
 * message key. NOT_FOUND covers both "no invitation with this code" and
 * "expired/revoked" (the API deliberately does not distinguish these).
 */
export function onboardingErrorKey(error: unknown): TranslationKey {
  if (!(error instanceof ApiError)) {
    return "onboarding.error.generic";
  }
  switch (error.code) {
    case "NOT_FOUND":
      return "onboarding.error.invalidInvitation";
    default:
      return "onboarding.error.generic";
  }
}
