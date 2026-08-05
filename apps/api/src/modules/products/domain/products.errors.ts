/**
 * Domain errors for the products module (EPIC-8). Infrastructure raises these
 * so the application layer can render stable HTTP responses without leaking
 * Prisma specifics; the service maps each to the unified error envelope.
 */

/** A unique constraint was violated (duplicate product name, or variant sku/barcode/name). */
export class DuplicateProductError extends Error {
  constructor(
    /** The logical field that collided (`name`, `sku`, `barcode`). */
    readonly field: string,
    message?: string,
  ) {
    super(message ?? `A record with this ${field} already exists.`);
    this.name = "DuplicateProductError";
  }
}

/** A referenced tenant row (category or unit) does not exist in this company. */
export class ReferenceNotFoundError extends Error {
  constructor(readonly field: string) {
    super(`Referenced ${field} was not found.`);
    this.name = "ReferenceNotFoundError";
  }
}

/** The list cursor could not be decoded (tampered or stale). */
export class InvalidListCursorError extends Error {
  constructor() {
    super("Invalid pagination cursor.");
    this.name = "InvalidListCursorError";
  }
}
