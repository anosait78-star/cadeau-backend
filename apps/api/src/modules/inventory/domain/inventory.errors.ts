/**
 * Domain errors for the inventory module (EPIC-9). Infrastructure raises these
 * so the application layer can render stable HTTP responses without leaking
 * Prisma specifics; the service maps each to the unified error envelope.
 */

/** A unique constraint was violated (duplicate warehouse name or code). */
export class DuplicateWarehouseError extends Error {
  constructor(
    /** The logical field that collided (`name`, `code`, `isDefault`). */
    readonly field: string,
    message?: string,
  ) {
    super(message ?? `A warehouse with this ${field} already exists.`);
    this.name = "DuplicateWarehouseError";
  }
}

/** A referenced tenant row (warehouse or variant) does not exist in this company. */
export class ReferenceNotFoundError extends Error {
  constructor(readonly field: string) {
    super(`Referenced ${field} was not found.`);
    this.name = "ReferenceNotFoundError";
  }
}

/**
 * The write would have driven stock negative. Raised when a reservation exceeds
 * `available` (and the product does not allow overselling), or when a transfer
 * or downward adjustment exceeds `onHand`.
 */
export class InsufficientStockError extends Error {
  constructor(
    /** The units the caller asked for. */
    readonly requested: number,
    /** The units actually there. */
    readonly availableUnits: number,
    /** The quantity field the caller sent. */
    readonly field = "quantity",
  ) {
    super(`Insufficient stock: requested ${requested}, available ${availableUnits}.`);
    this.name = "InsufficientStockError";
  }
}

/** The list cursor could not be decoded (tampered or stale). */
export class InvalidListCursorError extends Error {
  constructor() {
    super("Invalid pagination cursor.");
    this.name = "InvalidListCursorError";
  }
}
