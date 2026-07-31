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
