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
 * (D8). `GenericJsonAdapter` (the identity mapping) and `WooCommerceAdapter`
 * both implement this; `StorefrontAdapterResolverPort` picks the right one
 * per connection at request time — a new platform is one more implementation
 * of this same interface, registered in the resolver.
 */
export interface StorefrontAdapterPort {
  parseOrder(raw: unknown): NormalizedOrder;
  parseProduct(raw: unknown): NormalizedProduct;
}

/**
 * DI tokens for the two concrete v1 adapters. `StorefrontAdapterResolver`
 * (application layer) depends on these — never on the concrete
 * `GenericJsonAdapter`/`WooCommerceAdapter` classes, which live in
 * `infrastructure/` and would violate the `layer-application-no-outer`
 * architecture rule. `integrations.module.ts` (composition root, exempt from
 * that rule) binds each token to its concrete class.
 */
export const GENERIC_STOREFRONT_ADAPTER = Symbol("GENERIC_STOREFRONT_ADAPTER");
export const WOOCOMMERCE_STOREFRONT_ADAPTER = Symbol("WOOCOMMERCE_STOREFRONT_ADAPTER");
