/**
 * Orders domain errors (EPIC-11). Thrown by the domain/repository and mapped to
 * the api-conventions error envelope by the application service — so the domain
 * never depends on HTTP.
 */

/** A create carried a duplicate `Idempotency-Key` that is not a replay. */
export class DuplicateOrderError extends Error {
  constructor(readonly field: "idempotencyKey" = "idempotencyKey") {
    super("An order with this idempotency key already exists.");
    this.name = "DuplicateOrderError";
  }
}

/** A referenced row (customer, variant, label, reason, governorate, assignee) is absent. */
export class ReferenceNotFoundError extends Error {
  constructor(readonly field: string) {
    super(`Referenced ${field} does not exist.`);
    this.name = "ReferenceNotFoundError";
  }
}

/** An attempted status transition is not legal in the state machine. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal status transition: ${from} → ${to}.`);
    this.name = "IllegalTransitionError";
  }
}

/** A transition that requires a reason (cancel) was attempted without a valid one. */
export class ReasonRequiredError extends Error {
  constructor(readonly field: "reasonId" = "reasonId") {
    super("This transition requires a reason of the matching kind.");
    this.name = "ReasonRequiredError";
  }
}

/** The order has no items and cannot be created / cannot reserve stock. */
export class EmptyOrderError extends Error {
  constructor() {
    super("An order must have at least one item.");
    this.name = "EmptyOrderError";
  }
}

/** One variant that could not be fully reserved for an order. */
export interface StockShortage {
  variantId: string;
  variantName: string;
  productName: string;
  requested: number;
  available: number;
}

/** Reserving stock for an order failed because one or more variants have insufficient stock. */
export class InsufficientStockError extends Error {
  constructor(
    readonly shortages: StockShortage[],
    readonly field: string = "items",
  ) {
    super(InsufficientStockError.buildMessage(shortages));
    this.name = "InsufficientStockError";
  }

  private static buildMessage(shortages: StockShortage[]): string {
    if (shortages.length === 1) {
      const s = shortages[0]!;
      return s.available <= 0
        ? `لا يمكن تغيير حالة الطلب لأن الكمية المتوفرة من "${s.productName} - ${s.variantName}" في المخزون = 0.`
        : `لا يمكن نقل الطلب لأن المخزون غير كافٍ لـ "${s.productName} - ${s.variantName}" (المطلوب ${s.requested}، المتاح ${s.available}).`;
    }
    return `لا يمكن نقل الطلب إلى الحالة التالية لأن المخزون غير كافٍ لـ ${shortages.length} أصناف.`;
  }
}

/** An amount is invalid (e.g. discount exceeds subtotal + shipping, so total < 0). */
export class InvalidAmountError extends Error {
  constructor(readonly field: string) {
    super(`Invalid amount for ${field}.`);
    this.name = "InvalidAmountError";
  }
}

/** The supplied `paymentStatus` is inconsistent with `collectedAmount` vs the order total. */
export class PaymentStatusMismatchError extends Error {
  constructor(readonly field: "paymentStatus" = "paymentStatus") {
    super("paymentStatus does not match collectedAmount for this order's total.");
    this.name = "PaymentStatusMismatchError";
  }
}

/** A supplied keyset cursor was malformed. */
export class InvalidListCursorError extends Error {
  constructor() {
    super("The provided cursor is invalid.");
    this.name = "InvalidListCursorError";
  }
}

/** Merge was asked to fold a customer into itself. */
export class InvalidMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMergeError";
  }
}
