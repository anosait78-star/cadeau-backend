import type { TranslationKey } from "@/i18n/dictionaries";
import { ApiError } from "@/lib/api-client";

type Translate = (key: TranslationKey) => string;

/** The message a shipment action's failure should surface to the user. */
export function shipmentErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    // Every AppException the server throws (4xx business errors like
    // order-not-shippable/illegal-transition/duplicate-active-shipment, and
    // 5xx SERVICE_UNAVAILABLE when the carrier itself times out or is
    // unreachable) carries a specific, client-safe, user-actionable message
    // — show it instead of a one-size-fits-all fallback that hides the real
    // reason (e.g. the exact reason Bosta refused a cancellation).
    if (error.statusCode >= 400 && error.message.length > 0) {
      return error.message;
    }
  }
  return t("shipping.saveFailed");
}
