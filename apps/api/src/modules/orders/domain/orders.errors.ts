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

/** Reserving stock for an order failed because a variant has insufficient stock. */
export class InsufficientStockError extends Error {
  constructor(readonly field: string = "items") {
    super("Insufficient stock to reserve for this order.");
    this.name = "InsufficientStockError";
  }
}

/** An amount is invalid (e.g. discount exceeds subtotal + shipping, so total < 0). */
export class InvalidAmountError extends Error {
  constructor(readonly field: string) {
    super(`Invalid amount for ${field}.`);
    this.name = "InvalidAmountError";
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
