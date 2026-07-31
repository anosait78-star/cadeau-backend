/**
 * Shipping domain errors (EPIC-12). Thrown by the domain/repository and mapped
 * to the api-conventions error envelope by the application service — so the
 * domain never depends on HTTP.
 */

/** A create carried a duplicate `Idempotency-Key` that is not a replay. */
export class DuplicateShipmentError extends Error {
  constructor(readonly field: "idempotencyKey" = "idempotencyKey") {
    super("A shipment with this idempotency key already exists.");
    this.name = "DuplicateShipmentError";
  }
}

/** A referenced order does not exist. */
export class ReferenceNotFoundError extends Error {
  constructor(readonly field: string) {
    super(`Referenced ${field} does not exist.`);
    this.name = "ReferenceNotFoundError";
  }
}

/** The order is not in a shippable status (docs/epic-12-design.md §1). */
export class OrderNotShippableError extends Error {
  constructor(readonly orderStatus: string) {
    super(`Order status '${orderStatus}' is not shippable.`);
    this.name = "OrderNotShippableError";
  }
}

/** The order already has an active (non-terminal) shipment. */
export class DuplicateActiveShipmentError extends Error {
  constructor() {
    super("The order already has an active shipment.");
    this.name = "DuplicateActiveShipmentError";
  }
}

/** An attempted status transition is not legal in the state machine. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal shipment status transition: ${from} → ${to}.`);
    this.name = "IllegalTransitionError";
  }
}
