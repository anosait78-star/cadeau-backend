/**
 * The generic normalized contract (storefront-integration §7/D8). This IS the
 * expected v1 wire shape — {@link GenericJsonAdapter} is an identity mapping.
 * When a real platform (Salla/Zid/Shopify/WooCommerce) is added, its adapter
 * translates that platform's own shape into these same types and calls the
 * same ingestion handler — zero change to `OrdersService`/`ProductsService`/
 * `InventoryService`/`CustomersService`.
 */

export interface NormalizedOrderItem {
  readonly sku: string;
  readonly quantity: number;
  /** Integer minor units. */
  readonly unitPriceMinor: number;
}

export interface NormalizedCustomer {
  readonly name: string;
  /** As typed by the storefront — normalized to E.164 by the customers module. */
  readonly phone: string;
  readonly email?: string | null;
}

export interface NormalizedOrder {
  readonly externalId: string;
  readonly placedAt: string;
  readonly customer: NormalizedCustomer;
  readonly items: readonly NormalizedOrderItem[];
  readonly currency?: string;
  readonly notes?: string | null;
}

export interface NormalizedProduct {
  readonly externalId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly sku: string;
  readonly barcode?: string | null;
  /** Integer minor units — maps to `ProductVariant.sellingPriceMinor` (§8). */
  readonly priceMinor: number;
  /** Absolute on-hand quantity, applied via an inventory adjustment (D5). */
  readonly stockQuantity: number;
  readonly active?: boolean;
}

/**
 * Translates one platform's raw webhook payload into the generic contract
 * (D8). `GenericJsonAdapter` is the only implementation in v1 (the raw
 * payload already IS the generic contract); a per-platform adapter is a
 * later, additive implementation of this same interface.
 */
export interface StorefrontAdapterPort {
  parseOrder(raw: unknown): NormalizedOrder;
  parseProduct(raw: unknown): NormalizedProduct;
}

/** DI token for {@link StorefrontAdapterPort}. */
export const STOREFRONT_ADAPTER = Symbol("STOREFRONT_ADAPTER");
