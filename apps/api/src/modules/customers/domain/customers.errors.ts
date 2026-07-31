/**
 * Domain errors for the customers module (EPIC-10). Infrastructure raises these
 * so the application layer can render stable HTTP responses without leaking
 * Prisma specifics; the service maps each to the unified error envelope.
 */

/**
 * A unique constraint was violated. For `phone` this is the E.164 uniqueness
 * rule, enforced by the unique index on `(company_id, phone_hash)`.
 *
 * The message names the **field**, never the id of the row it collided with:
 * telling the caller "customer 3f2a… already has this number" would confirm the
 * existence of a record they may have no right to read.
 */
export class DuplicateCustomerError extends Error {
  constructor(
    /** The logical field that collided (`phone`). */
    readonly field: string,
    message?: string,
  ) {
    super(message ?? `A customer with this ${field} already exists.`);
    this.name = "DuplicateCustomerError";
  }
}

/** A referenced tenant/reference row (e.g. `governorateId`) does not exist. */
export class ReferenceNotFoundError extends Error {
  constructor(readonly field: string) {
    super(`Referenced ${field} was not found.`);
    this.name = "ReferenceNotFoundError";
  }
}

/**
 * The supplied phone could not be normalized to E.164. Raised before anything is
 * hashed or stored — an un-normalized value must never reach the blind index.
 */
export class InvalidPhoneError extends Error {
  constructor(readonly field = "phone") {
    super("Phone must be in international format, e.g. +201001234567.");
    this.name = "InvalidPhoneError";
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
 * A merge request was invalid — the surviving and merged ids are the same
 * (EPIC-11, `POST /v1/customers/merge`). "Not found" is reported separately by
 * the service when either customer is absent.
 */
export class InvalidMergeError extends Error {
  constructor(readonly field = "mergedCustomerId") {
    super("A customer cannot be merged into itself.");
    this.name = "InvalidMergeError";
  }
}
