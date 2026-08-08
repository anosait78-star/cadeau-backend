/** Thrown when a `(companyId, label)` pair already exists (storefront_connections). */
export class DuplicateConnectionLabelError extends Error {
  constructor() {
    super("A connection with this label already exists.");
    this.name = "DuplicateConnectionLabelError";
  }
}

/** Thrown when `defaultWarehouseId` does not resolve inside the tenant. */
export class WarehouseNotFoundError extends Error {
  constructor() {
    super("Warehouse not found.");
    this.name = "WarehouseNotFoundError";
  }
}

/** Thrown when a webhook event's `sku` does not resolve to any variant in the tenant. */
export class UnknownSkuError extends Error {
  constructor(readonly sku: string) {
    super(`No variant found for sku "${sku}".`);
    this.name = "UnknownSkuError";
  }
}

/** Thrown when a webhook event id is not `pending`/`failed` (already processed). */
export class NotReprocessableError extends Error {
  constructor() {
    super("Only a failed event can be reprocessed.");
    this.name = "NotReprocessableError";
  }
}

/** Thrown when a keyset cursor cannot be decoded. */
export class InvalidListCursorError extends Error {
  constructor() {
    super("Invalid cursor.");
    this.name = "InvalidListCursorError";
  }
}
