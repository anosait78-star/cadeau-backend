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
