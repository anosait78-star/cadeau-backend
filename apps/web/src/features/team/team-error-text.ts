import type { TranslationKey } from "@/i18n/dictionaries";
import { ApiError } from "@/lib/api-client";

type Translate = (key: TranslationKey) => string;

/**
 * The message a Team/Invitations action's failure should surface to the user.
 * Every `AppException` the server throws (403 forbidden — including the
 * access.manage gate and the Owner-invite rule; 404 invalid/expired
 * invitation or missing member; 409 duplicate/last-Owner protection; 400
 * validation — including an unavailable or unknown custom permission) already
 * carries a specific, client-safe, user-actionable message (mirrors
 * `shipmentErrorText`'s convention) — show it instead of a one-size-fits-all
 * fallback that hides the real reason. Only a stale/expired session and
 * genuinely unexpected failures (network, 5xx) fall back to a generic,
 * translated message.
 */
export function teamErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 401) return t("team.error.unauthorized");
    if (error.statusCode >= 400 && error.message.length > 0) {
      return error.message;
    }
  }
  return t("team.error.generic");
}
