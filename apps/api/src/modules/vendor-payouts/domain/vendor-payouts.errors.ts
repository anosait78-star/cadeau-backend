/**
 * Vendor payouts domain errors. Thrown by the repository and mapped to the
 * api-conventions error envelope by the application service, so the domain
 * never depends on HTTP.
 */

/** The warehouse is not one of this company's vendor warehouses. */
export class VendorNotFoundError extends Error {
  constructor() {
    super("Vendor not found.");
    this.name = "VendorNotFoundError";
  }
}

/** No payout with this id in the caller's reach. */
export class PayoutNotFoundError extends Error {
  constructor() {
    super("Payout not found.");
    this.name = "PayoutNotFoundError";
  }
}

/** Nothing is owed right now (open priced rows sum to zero or less). */
export class NothingToPayError extends Error {
  constructor(readonly owedMinor: number) {
    super(
      owedMinor < 0
        ? "لا يوجد مبلغ مستحق — رصيد التاجر بالسالب وسيُخصم من مستحقاته القادمة."
        : "لا يوجد مبلغ مستحق لهذا التاجر حاليًا.",
    );
    this.name = "NothingToPayError";
  }
}

/** The vendor already has a payout waiting for confirmation (decision 13). */
export class PayoutAlreadyPendingError extends Error {
  constructor() {
    super("يوجد طلب دفع معلّق لهذا التاجر — أكّده أو ألغه أولًا.");
    this.name = "PayoutAlreadyPendingError";
  }
}

/** The payout is no longer pending: already confirmed or cancelled. */
export class PayoutNotPendingError extends Error {
  constructor(readonly status: string) {
    super(`طلب الدفع لم يعد معلّقًا (الحالة الحالية: ${status}).`);
    this.name = "PayoutNotPendingError";
  }
}

/** The current accounting period is closed, so no money may move inside it. */
export class PayoutPeriodClosedError extends Error {
  constructor(readonly periodKey: string) {
    super(`الفترة المحاسبية ${periodKey} مقفولة — لا يمكن تسجيل دفع داخلها.`);
    this.name = "PayoutPeriodClosedError";
  }
}

/** The idempotency key was already used for a different vendor. */
export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super("This Idempotency-Key was already used for a different request.");
    this.name = "IdempotencyKeyReusedError";
  }
}
