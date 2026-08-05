/** A durable, tenant-scoped audit record for a product/variant change. */
export interface ProductsAuditRecord {
  readonly companyId: string;
  readonly actorId: string;
  readonly action:
    | "product.created"
    | "product.updated"
    | "product.archived"
    | "product.variant_created"
    | "product.variant_updated";
  /** `product` or `product_variant`. */
  readonly entityType: "product" | "product_variant";
  /** The affected row's id. */
  readonly entityId: string;
  /** A secret-free snapshot of what changed. */
  readonly changes?: unknown;
}

/**
 * Port for recording product changes to the durable, append-only `audit_log`
 * (EPIC-3). This durable write is the source of truth; the additive
 * `product.*` event-bus emission rides alongside it (never replaces it).
 * Implementations MUST NOT record secrets.
 */
export interface ProductsAuditPort {
  record(record: ProductsAuditRecord): Promise<void>;
}

/** DI token for {@link ProductsAuditPort}. */
export const PRODUCTS_AUDIT = Symbol("PRODUCTS_AUDIT");
