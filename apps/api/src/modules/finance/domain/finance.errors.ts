/**
 * Domain errors for the finance module (EPIC-13, M13.2). Infrastructure raises
 * these so the application layer can render stable HTTP responses without
 * leaking Prisma specifics; the service maps each to the unified error
 * envelope.
 */

/** A referenced tenant row (supplier, variant, warehouse, PO, PO line) does not exist. */
export class ReferenceNotFoundError extends Error {
  constructor(readonly field: string) {
    super(`Referenced ${field} was not found.`);
    this.name = "ReferenceNotFoundError";
  }
}

/** The purchase order has no lines, or a receipt/payment carries no lines/amount. */
export class EmptyPurchaseOrderError extends Error {
  constructor(message = "A purchase order must have at least one line.") {
    super(message);
    this.name = "EmptyPurchaseOrderError";
  }
}

/** A quantity or money amount was zero/negative where a positive value is required. */
export class InvalidAmountError extends Error {
  constructor(readonly field: string) {
    super(`${field} must be a positive amount.`);
    this.name = "InvalidAmountError";
  }
}

/**
 * A receipt line's quantity would push `quantityReceived` above
 * `quantityOrdered` for its PO line.
 */
export class OverReceiptError extends Error {
  constructor(
    readonly poLineId: string,
    readonly requested: number,
    readonly remaining: number,
  ) {
    super(
      `Receipt quantity ${requested} exceeds the ${remaining} unit(s) remaining on line ${poLineId}.`,
    );
    this.name = "OverReceiptError";
  }
}

/** The purchase order is not in a state that accepts receipts or payments (e.g. cancelled). */
export class IllegalPurchaseOrderStateError extends Error {
  constructor(
    readonly status: string,
    message?: string,
  ) {
    super(message ?? `Purchase order in status '${status}' cannot be modified this way.`);
    this.name = "IllegalPurchaseOrderStateError";
  }
}

/** The list cursor could not be decoded (tampered or stale). */
export class InvalidListCursorError extends Error {
  constructor() {
    super("Invalid pagination cursor.");
    this.name = "InvalidListCursorError";
  }
}

/**
 * A money-moving write was dated inside an already-closed
 * `accounting_periods` row (D4). Reusable across every later money-moving
 * milestone (invoices, refunds, PO payments) — not just expenses.
 */
export class PeriodClosedError extends Error {
  constructor(readonly periodKey: string) {
    super(`Accounting period ${periodKey} is closed; this date cannot be written to.`);
    this.name = "PeriodClosedError";
  }
}

/** `tax_settings.vatRateBps` was outside the valid 0-10000 (0%-100%) range. */
export class InvalidVatRateError extends Error {
  constructor() {
    super("vatRateBps must be between 0 and 10000.");
    this.name = "InvalidVatRateError";
  }
}

/**
 * A refund was requested without an `Idempotency-Key`. Unlike every other
 * finance write (where the header is optional and replay is a convenience),
 * `refunds.idempotency_key` is `NOT NULL` — the contract makes it mandatory
 * because a refund is money-out and irreversible (D2 rationale).
 */
export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super("Idempotency-Key is required for this operation.");
    this.name = "MissingIdempotencyKeyError";
  }
}

/**
 * An invoice must be issued from exactly one source: either `orderId` or a
 * manual `lines[]` array — never both, never neither.
 */
export class InvalidInvoiceSourceError extends Error {
  constructor() {
    super("Provide exactly one of orderId or lines.");
    this.name = "InvalidInvoiceSourceError";
  }
}

/** A refund must reference at least one of `invoiceId` or `orderId`. */
export class RefundTargetRequiredError extends Error {
  constructor() {
    super("A refund requires at least one of invoiceId or orderId.");
    this.name = "RefundTargetRequiredError";
  }
}

/** An invoice would be issued with zero lines (no order items, or an empty manual `lines[]`). */
export class EmptyInvoiceError extends Error {
  constructor(message = "An invoice must have at least one line.") {
    super(message);
    this.name = "EmptyInvoiceError";
  }
}

/** A `{period}` path param did not match `^\d{4}-\d{2}$`. */
export class InvalidPeriodKeyError extends Error {
  constructor() {
    super("period must be formatted YYYY-MM.");
    this.name = "InvalidPeriodKeyError";
  }
}

/**
 * Closing period _N_ was rejected because an earlier period for this company
 * is still open (D4 — sequential, gap-free close). Simplification: any
 * `accounting_periods` row with `periodKey < N` and `status = 'open'` blocks
 * the close, full stop — a row only exists for a month once something dated
 * inside it was written (`assertPeriodOpen`'s upsert-into-existence), so "has
 * an open earlier period" and "has unclosed earlier activity" collapse to the
 * same check.
 */
export class PeriodSequenceGapError extends Error {
  constructor(
    readonly periodKey: string,
    readonly blockingPeriodKey: string,
  ) {
    super(`Cannot close ${periodKey}: an earlier period (${blockingPeriodKey}) is still open.`);
    this.name = "PeriodSequenceGapError";
  }
}

/** A reconciliation would be created with zero lines. */
export class EmptyReconciliationError extends Error {
  constructor(message = "A reconciliation must have at least one line.") {
    super(message);
    this.name = "EmptyReconciliationError";
  }
}

/**
 * A reconciliation line's `trackingNumber` did not match any shipment for
 * this tenant + carrier. The whole batch is rejected (D5 rationale: same
 * all-or-nothing discipline as other bulk finance/shipping writes).
 */
export class ShipmentNotFoundForReconciliationError extends Error {
  constructor(readonly trackingNumber: string) {
    super(`No shipment found for tracking number '${trackingNumber}'.`);
    this.name = "ShipmentNotFoundForReconciliationError";
  }
}
