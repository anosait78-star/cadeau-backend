/** A unique constraint was violated on a create/update (maps to `409 CONFLICT`). */
export class DuplicateResourceError extends Error {
  constructor(message = "A record with the same unique value already exists.") {
    super(message);
    this.name = "DuplicateResourceError";
  }
}

/**
 * A referenced row (e.g. a category parent) does not exist within the tenant
 * (maps to `422 UNPROCESSABLE_ENTITY`). `field` is the offending attribute.
 */
export class ReferenceNotFoundError extends Error {
  constructor(readonly field: string) {
    super(`${field} does not reference an existing record.`);
    this.name = "ReferenceNotFoundError";
  }
}

/** A list cursor could not be decoded/validated (maps to `400 BAD_REQUEST`). */
export class InvalidListCursorError extends Error {
  constructor() {
    super("Invalid pagination cursor.");
    this.name = "InvalidListCursorError";
  }
}
