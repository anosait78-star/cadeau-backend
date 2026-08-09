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

/** Thrown when a connection's `platform` has no registered {@link StorefrontAdapterPort}. */
export class UnsupportedPlatformError extends Error {
  constructor(readonly platform: string) {
    super(`No adapter is registered for storefront platform "${platform}".`);
    this.name = "UnsupportedPlatformError";
  }
}

/**
 * Thrown by a platform adapter when a raw webhook payload is missing a field
 * required to build a {@link NormalizedOrder}/{@link NormalizedProduct} (e.g.
 * a WooCommerce order with no `billing.phone`). Distinct from
 * {@link UnknownSkuError} — this is a shape/content problem in the raw
 * payload itself, not a lookup miss against existing catalog data. Always
 * carries a human-readable reason so it lands verbatim in the webhook
 * event's `error` column.
 */
export class StorefrontPayloadMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorefrontPayloadMappingError";
  }
}
