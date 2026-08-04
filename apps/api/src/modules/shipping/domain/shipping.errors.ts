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

/** The carrier rejected the presented API key (or none is connected). */
export class CarrierAuthError extends Error {
  constructor(readonly carrier: string) {
    super(`${carrier} rejected the connection's API key.`);
    this.name = "CarrierAuthError";
  }
}

/** The carrier's API could not be reached or errored (timeout, 5xx, network). */
export class CarrierUnavailableError extends Error {
  constructor(
    readonly carrier: string,
    message: string,
  ) {
    super(message);
    this.name = "CarrierUnavailableError";
  }
}

/**
 * The carrier's API reached us fine and rejected the request as invalid
 * (a non-401/403 4xx — e.g. "cannot cancel a delivered shipment"). Distinct
 * from {@link CarrierUnavailableError}: this is a client-actionable business
 * rejection, not an outage, and `message` is the carrier's own wording
 * verbatim — never replaced with a generic summary.
 */
export class CarrierRejectedError extends Error {
  constructor(
    readonly carrier: string,
    message: string,
  ) {
    super(message);
    this.name = "CarrierRejectedError";
  }
}

/** No active connection exists for the requested carrier. */
export class CarrierNotConnectedError extends Error {
  constructor(readonly carrier: string) {
    super(`No active connection to ${carrier} for this company.`);
    this.name = "CarrierNotConnectedError";
  }
}

/** The customer has no default address to ship to. */
export class CustomerAddressMissingError extends Error {
  constructor() {
    super("The customer has no default address to ship to.");
    this.name = "CustomerAddressMissingError";
  }
}

/**
 * The customer's default address is not mapped to the carrier's own
 * city/district (settings > customers) — refused rather than guessed
 * (no format guessing, matches the CSV importer's convention).
 */
export class CustomerAddressNotMappedError extends Error {
  constructor(readonly carrier: string) {
    super(`The customer's address is not mapped to a ${carrier} city/district yet.`);
    this.name = "CustomerAddressNotMappedError";
  }
}

/** The order's cash-on-delivery amount exceeds the carrier's documented cap. */
export class CodLimitExceededError extends Error {
  constructor(
    readonly carrier: string,
    readonly limitMinor: number,
  ) {
    super(`${carrier} caps cash-on-delivery at ${limitMinor / 100}.`);
    this.name = "CodLimitExceededError";
  }
}
