/**
 * Product domain views (EPIC-8). The shapes the application layer returns and
 * the presentation layer renders — decoupled from the Prisma row. Money
 * (`averageCost`) is an integer count of minor units (api-conventions §money).
 */

/** A catalog item, without its variants. */
export interface ProductView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string | null;
  readonly unitId: string | null;
  /** A display image URL — hosted elsewhere; this is never file bytes. */
  readonly imageUrl: string | null;
  /** Oversell policy (EPIC-9): when true, reservations may exceed available stock. */
  readonly allowOversell: boolean;
  /** Soft-delete flag; `false` means archived. */
  readonly active: boolean;
  /**
   * Names of every warehouse holding stock for one of this product's variants
   * (EPIC-9 `InventoryStock`) — there is no direct product→warehouse column;
   * this is derived and can be empty (no stock rows yet) or hold more than
   * one name (variants split across warehouses). Sorted, deduplicated.
   */
  readonly warehouseNames: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A concrete sellable unit under a product. */
export interface ProductVariantView {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly sku: string | null;
  readonly barcode: string | null;
  /** Moving-average cost in integer minor units; derived (EPIC-13), read-only. */
  readonly averageCost: number;
  /** Sellable price in integer minor units; client/storefront-writable (storefront-integration §8). */
  readonly sellingPriceMinor: number;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A product together with its variants (the detail view). */
export interface ProductWithVariants extends ProductView {
  readonly variants: readonly ProductVariantView[];
}
